#!/usr/bin/env python3
"""Notify me when a Find My friend gets close.

Polls iCloud for a friend's shared location and for your own device
location, and fires a notification when the friend comes within a set
distance (and, optionally, as soon as they start heading your way).

There is NO official Find My API. This talks to the same private iCloud
endpoints the Find My web app uses, via pyicloud. Consequences:

  * You will need to re-approve 2FA every few weeks; when that happens a
    background run just starts failing and you re-run this by hand once.
  * A friend's location in Find My updates irregularly - a "fix" can be
    10-30 minutes stale - so proximity detection is coarse by nature.
  * Apple can change or remove these endpoints at any time. Run
    `--list` first to confirm the friends service works for your account.

Usage:
  pip install -r requirements.txt
  python proximity_alert.py --store-password      # once, for background runs
  python proximity_alert.py --list                # find your friend's id
  # edit config.json
  python proximity_alert.py                       # run the watcher
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from collections import deque
from datetime import datetime
from getpass import getpass
from pathlib import Path
from urllib import request as urlrequest

try:
    from pyicloud import PyiCloudService
except ImportError:
    PyiCloudService = None  # checked in connect(); keeps --help working

try:
    from pyicloud.exceptions import PyiCloudNoStoredPasswordAvailableException
except Exception:  # pragma: no cover - pyicloud missing, or older/newer layout
    class PyiCloudNoStoredPasswordAvailableException(Exception):
        pass


DEFAULT_CONFIG = {
    # Apple ID to log in as (yours). Leave "" to be prompted.
    "apple_id": "",
    # The friend to watch: their id token (from --list), or an email / phone /
    # name that appears in --list output.
    "friend": "",
    # Where "me" is. mode "device" pulls your most recent Find My device fix;
    # mode "fixed" uses the lat/lon below (e.g. your home).
    "my_location": {"mode": "device", "device_name": "", "lat": None, "lon": None},
    # Fire the "is near" alert when the gap is at or below this many metres.
    "threshold_meters": 1000,
    # Re-arm the "is near" alert only after they move back out past
    # threshold + this, so it doesn't chatter on the boundary.
    "hysteresis_meters": 500,
    # Optional early warning: fire when the friend has closed at least this many
    # metres across the trend window while still outside threshold. 0 disables.
    "approach_drop_meters": 0,
    "approach_window": 5,
    # Seconds between polls. Find My data rarely changes faster than ~1/min.
    "poll_seconds": 120,
    # Ignore a friend fix older than this (seconds).
    "stale_after_seconds": 1800,
    # "macos" (osascript), "ntfy" (ntfy.sh/<topic>), or "print".
    "notifier": "macos",
    "ntfy_topic": "",
}


# --------------------------------------------------------------------------- #
# config

def load_config(path: Path) -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
    if path.exists():
        user = json.loads(path.read_text())
        for k, v in user.items():
            if k == "my_location" and isinstance(v, dict):
                cfg["my_location"].update(v)
            else:
                cfg[k] = v
    return cfg


# --------------------------------------------------------------------------- #
# geo

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def fmt_dist(m: float) -> str:
    return f"{m:.0f} m" if m < 1000 else f"{m / 1000:.1f} km"


def _norm_ts(ts) -> float:
    """Apple hands timestamps back in ms; normalise to seconds."""
    if not ts:
        return 0.0
    ts = float(ts)
    return ts / 1000.0 if ts > 1e12 else ts


# --------------------------------------------------------------------------- #
# iCloud

def connect(apple_id: str) -> "PyiCloudService":
    if PyiCloudService is None:
        sys.exit("pyicloud is not installed. Run:  pip install -r requirements.txt")
    apple_id = apple_id or input("Apple ID: ").strip()
    try:
        api = PyiCloudService(apple_id)
    except PyiCloudNoStoredPasswordAvailableException:
        api = PyiCloudService(apple_id, getpass(f"iCloud password for {apple_id}: "))

    if getattr(api, "requires_2fa", False):
        code = input("Two-factor code (sent to your Apple devices): ").strip()
        if not api.validate_2fa_code(code):
            sys.exit("Could not verify the 2FA code.")
        if not api.is_trusted_session:
            api.trust_session()
    elif getattr(api, "requires_2sa", False):
        devices = api.trusted_devices
        for i, d in enumerate(devices):
            print(f"  {i}: {d.get('deviceName') or d.get('phoneNumber')}")
        dev = devices[int(input("Send code to which device? ").strip())]
        if not api.send_verification_code(dev):
            sys.exit("Could not send the verification code.")
        if not api.validate_verification_code(dev, input("Code: ").strip()):
            sys.exit("Could not verify the code.")
    return api


def friend_service(api: PyiCloudService):
    try:
        ff = api.friends
    except Exception as e:
        sys.exit(
            "The Find My Friends service is not available for this account "
            f"({e.__class__.__name__}: {e}).\n"
            "Apple has retired this endpoint for some accounts. Options: try the "
            "`icloudpy` fork as a drop-in replacement, or rely on Find My's own "
            "built-in 'Notify Me when <friend> arrives'."
        )
    try:
        ff.refresh_client()
    except Exception:
        pass
    return ff


def resolve_friend(ff, needle: str):
    """Return (friend_id, display_name) or (None, None)."""
    needle_l = str(needle).lower()
    details = list(getattr(ff, "contact_details", None) or [])

    def name_for(fid):
        for p in details:
            if p.get("id") == fid:
                nm = " ".join(x for x in (p.get("firstName"), p.get("lastName")) if x)
                if nm:
                    return nm
                for key in ("emails", "phones"):
                    if p.get(key):
                        return p[key][0]
        return fid

    for loc in getattr(ff, "locations", None) or []:
        if loc.get("id") == needle:
            return needle, name_for(needle)
    for p in details:
        if needle_l in json.dumps(p, default=str).lower():
            return p.get("id"), name_for(p.get("id"))
    return None, None


def friend_location(ff, friend_id: str):
    for loc in getattr(ff, "locations", None) or []:
        if loc.get("id") != friend_id:
            continue
        l = loc.get("location")
        if not l or l.get("latitude") is None:
            return None
        return float(l["latitude"]), float(l["longitude"]), _norm_ts(l.get("timestamp"))
    return None


def my_location(api: PyiCloudService, cfg: dict):
    ml = cfg["my_location"]
    if ml["mode"] == "fixed":
        if ml["lat"] is None or ml["lon"] is None:
            sys.exit("my_location.mode is 'fixed' but lat/lon are not set in config.json")
        return float(ml["lat"]), float(ml["lon"]), time.time()

    best = None
    for dev in api.devices:
        try:
            loc = dev.location()
        except Exception:
            loc = None
        if not loc or loc.get("latitude") is None:
            continue
        name = (dev.content or {}).get("name", "") or ""
        if ml["device_name"] and ml["device_name"].lower() not in name.lower():
            continue
        ts = _norm_ts(loc.get("timeStamp") or loc.get("timestamp")) or time.time()
        if best is None or ts > best[2]:
            best = (float(loc["latitude"]), float(loc["longitude"]), ts)
    if best is None:
        sys.exit("Could not read your own device location from Find My "
                 "(check my_location.device_name, or switch to mode 'fixed').")
    return best


# --------------------------------------------------------------------------- #
# notify

def notify(cfg: dict, title: str, message: str) -> None:
    stamp = datetime.now().strftime("%H:%M:%S")
    print(f"{stamp}  ALERT  {title} - {message}")
    kind = cfg["notifier"]
    if kind == "macos":
        script = (f'display notification {json.dumps(message)} '
                  f'with title {json.dumps(title)} sound name "Submarine"')
        subprocess.run(["osascript", "-e", script], check=False)
    elif kind == "ntfy":
        topic = cfg["ntfy_topic"].strip()
        if not topic:
            print("  notifier is 'ntfy' but ntfy_topic is empty", file=sys.stderr)
            return
        req = urlrequest.Request(
            f"https://ntfy.sh/{topic}",
            data=message.encode("utf-8"),
            headers={"Title": title, "Tags": "round_pushpin"},
        )
        try:
            urlrequest.urlopen(req, timeout=10)
        except Exception as e:
            print(f"  ntfy POST failed: {e}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# commands

def do_list(cfg: dict) -> None:
    api = connect(cfg["apple_id"])
    print("\n== Your devices (candidates for 'me') ==")
    for dev in api.devices:
        try:
            has = bool(dev.location())
        except Exception:
            has = False
        print(f"  {((dev.content or {}).get('name') or '?'):<28}  "
              f"{'location OK' if has else 'no location'}")

    ff = friend_service(api)
    print("\n== Friends sharing location with you ==")
    locs = getattr(ff, "locations", None) or []
    if not locs:
        print("  (none - is she actually sharing with THIS Apple ID?)")
    for loc in locs:
        l = loc.get("location") or {}
        _id, _name = resolve_friend(ff, loc.get("id", ""))
        age = (time.time() - _norm_ts(l.get("timestamp"))) / 60 if l else None
        print(f"  id={loc.get('id')}")
        print(f"     name : {_name}")
        print(f"     fix  : {'%.0f min old' % age if age is not None else 'no fix'}")
    details = getattr(ff, "contact_details", None)
    if details:
        print("\n-- raw contact_details --")
        print(json.dumps(details, indent=2, default=str)[:4000])


def do_run(cfg: dict, once: bool) -> None:
    api = connect(cfg["apple_id"])
    ff = friend_service(api)
    friend_id, friend_name = resolve_friend(ff, cfg["friend"])
    if not friend_id:
        sys.exit(f"Couldn't match friend {cfg['friend']!r}. Run --list and copy an id.")
    print(f"Watching {friend_name} (id {friend_id}); "
          f"near <= {fmt_dist(cfg['threshold_meters'])}, poll {cfg['poll_seconds']}s")

    threshold = float(cfg["threshold_meters"])
    hyst = float(cfg["hysteresis_meters"])
    drop = float(cfg["approach_drop_meters"])
    history: deque[float] = deque(maxlen=max(2, int(cfg["approach_window"])))
    near_armed = True
    approach_armed = True

    while True:
        try:
            ff.refresh_client()
            fl = friend_location(ff, friend_id)
            mlat, mlon, _ = my_location(api, cfg)
        except Exception as e:
            print(f"{datetime.now():%H:%M:%S}  poll error: {e.__class__.__name__}: {e}",
                  file=sys.stderr)
            if once:
                return
            time.sleep(cfg["poll_seconds"])
            continue

        stamp = datetime.now().strftime("%H:%M:%S")
        if not fl:
            print(f"{stamp}  friend location unavailable")
            if once:
                return
            time.sleep(cfg["poll_seconds"])
            continue

        flat, flon, fts = fl
        age = time.time() - fts if fts else 0.0
        d = haversine_m(mlat, mlon, flat, flon)

        trend = ""
        if history:
            diff = d - history[-1]
            trend = ("closer" if diff < -20 else "farther" if diff > 20 else "steady")
        print(f"{stamp}  {fmt_dist(d)} away  (friend fix {age / 60:.0f} min old)"
              f"{'  ' + trend if trend else ''}")

        if age > cfg["stale_after_seconds"]:
            if once:
                return
            time.sleep(cfg["poll_seconds"])
            continue

        history.append(d)

        # primary: within range
        if d <= threshold and near_armed:
            notify(cfg, f"{friend_name} is near",
                   f"{fmt_dist(d)} away{' and ' + trend if trend else ''}.")
            near_armed = False
            approach_armed = False
        elif d >= threshold + hyst:
            near_armed = True

        # optional: closing fast while still outside range
        if drop > 0 and d > threshold and len(history) == history.maxlen:
            closed = history[0] - d
            if closed >= drop and approach_armed:
                notify(cfg, f"{friend_name} is heading your way",
                       f"came {fmt_dist(closed)} closer, now {fmt_dist(d)} away.")
                approach_armed = False
            elif closed <= -drop:
                approach_armed = True

        if once:
            return
        time.sleep(cfg["poll_seconds"])


# --------------------------------------------------------------------------- #

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    ap.add_argument("--list", action="store_true",
                    help="show your devices and the friends sharing with you, then exit")
    ap.add_argument("--once", action="store_true", help="poll a single time and exit")
    ap.add_argument("--store-password", action="store_true",
                    help="save the iCloud password to the system keyring and exit")
    args = ap.parse_args()

    cfg = load_config(args.config)

    if args.store_password:
        from pyicloud.utils import store_password_in_keyring
        apple_id = cfg["apple_id"] or input("Apple ID: ").strip()
        store_password_in_keyring(apple_id, getpass("iCloud password: "))
        print(f"Stored. {apple_id} will authenticate without a prompt from now on.")
        return

    if args.list:
        do_list(cfg)
        return

    if not cfg["friend"]:
        sys.exit("Set \"friend\" in config.json first (run --list to find the id).")

    try:
        do_run(cfg, once=args.once)
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
