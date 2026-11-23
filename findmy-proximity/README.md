# findmy-proximity

A small background watcher that notifies you when a **Find My friend** comes
within a set distance of you — and, optionally, the moment they start closing
the gap.

> Not a Chrome extension — it just lives in this repo. It's a standalone Python
> script.

## How it works

Every couple of minutes it logs into iCloud (via [`pyicloud`](https://github.com/picklepete/pyicloud),
which uses the same private endpoints as the Find My web app), reads:

- your friend's shared location (from **People** in Find My), and
- your own location (your most recent Find My device fix, or a fixed point),

computes the great-circle distance, and fires a notification when it drops to
your threshold. Hysteresis stops it re-alerting until they leave and come back.

## Reality check before you rely on this

- **No official API.** Apple can change or kill these endpoints anytime.
- **2FA expires.** Every few weeks the session goes stale; the script starts
  erroring and you re-run it once interactively to approve a new code.
- **Find My data is laggy.** A friend's location can be 10–30 minutes old, and
  updates only when their phone decides to. Proximity detection is coarse.
- **The friends service isn't available on every account** — Apple folded
  "Find My Friends" into Find My and dropped the standalone service for some.
  `--list` tells you in 5 seconds whether it works for you. If it doesn't, try
  `pip install icloudpy` and change the import at the top of
  `proximity_alert.py` to `from icloudpy import ICloudPyService as PyiCloudService`.

## Setup

```sh
cd findmy-proximity
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. store your Apple ID password in the system keyring (so background runs
#    don't prompt). Session tokens are cached in ~/.pyicloud after this.
python proximity_alert.py --store-password

# 2. see your devices + the friends sharing with you, and copy the friend's id
python proximity_alert.py --list

# 3. edit config.json (at least apple_id + friend), then dry-run once
python proximity_alert.py --once

# 4. run it
python proximity_alert.py
```

## config.json

| key | meaning |
|---|---|
| `apple_id` | your Apple ID email |
| `friend` | the friend's `id` from `--list` (an email / phone / name that shows up there also works) |
| `my_location.mode` | `"device"` = your latest Find My device fix; `"fixed"` = use `lat`/`lon` below (e.g. home) |
| `my_location.device_name` | with mode `device`, restrict to a device whose name contains this (else newest fix wins) |
| `threshold_meters` | fire "is near" at/below this gap |
| `hysteresis_meters` | re-arm only after they pass back beyond `threshold + hysteresis` |
| `approach_drop_meters` | optional early warning: fire when they've closed this many metres over the trend window while still outside the threshold. `0` = off |
| `approach_window` | number of polls in that trend window |
| `poll_seconds` | seconds between polls (120 is plenty) |
| `stale_after_seconds` | ignore a friend fix older than this |
| `notifier` | `"macos"` (osascript banner + sound), `"ntfy"` (POST to `ntfy.sh/<topic>` — install the ntfy app to receive), or `"print"` |
| `ntfy_topic` | required when `notifier` is `"ntfy"` |

## Run it in the background (macOS launchd)

`~/Library/LaunchAgents/com.local.findmy-proximity.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.local.findmy-proximity</string>
  <key>ProgramArguments</key>
  <array>
    <string>/ABSOLUTE/PATH/findmy-proximity/.venv/bin/python</string>
    <string>/ABSOLUTE/PATH/findmy-proximity/proximity_alert.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/findmy-proximity.log</string>
  <key>StandardErrorPath</key><string>/tmp/findmy-proximity.err</string>
</dict></plist>
```

```sh
launchctl load ~/Library/LaunchAgents/com.local.findmy-proximity.plist
# ...and when 2FA expires: check /tmp/findmy-proximity.err, then
python proximity_alert.py --once   # approve the new code, launchd recovers
```

For an always-on box (Pi/server) instead: set `notifier` to `"ntfy"` and run it
under systemd or `tmux`. The first login still needs an interactive 2FA approval
on that machine.
