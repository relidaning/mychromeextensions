# CLAUDE.md — findmy-proximity

Not a Chrome extension. A standalone Python watcher that notifies you when a
Find My friend comes close. Lives in this repo for convenience only.

## Files

- `proximity_alert.py` — the whole program (single file, stdlib + `pyicloud`)
- `config.json` — runtime config; `DEFAULT_CONFIG` in the script is the schema
  and default values, `load_config` deep-merges the file over it
- `requirements.txt` — `pyicloud`, `keyring`
- `README.md` — setup, caveats, a launchd plist for background running

## How it works

`connect()` logs into iCloud (interactive 2FA on first run, session cached in
`~/.pyicloud/`). Each poll: read the friend's shared location from `api.friends`
(`friend_location`), read "me" from either the latest Find My device fix or a
fixed lat/lon (`my_location`, config `my_location.mode` = `device`/`fixed`),
`haversine_m` the gap, then `notify()` via macOS `osascript` / `ntfy.sh` / print.

Alert state machine in `do_run()`: `near_armed` fires once when `d <=
threshold`, re-arms only after `d >= threshold + hysteresis` (anti-chatter).
Optional `approach_armed` fires when the friend closes `approach_drop_meters`
across the `approach_window`-sample history deque while still outside threshold.

## Key constraints

- **No official Find My API.** `pyicloud` hits the same private endpoints as the
  Find My web app; Apple can break them anytime.
- **Auth is the real Apple ID password + interactive 2FA.** App-specific
  passwords do NOT cover the Find My endpoints. 2FA session expires every few
  weeks — a background run then just starts erroring until re-run interactively.
  Optional throwaway second Apple ID isolates a `~/.pyicloud` / keyring leak.
- **`api.friends` is retired on some accounts.** `--list` confirms in seconds;
  `friend_service()` prints the `icloudpy` drop-in fallback on failure.
- **Find My data is laggy** — a friend fix can be 10–30 min stale (`stale_after_seconds`
  drops fixes older than that). Proximity detection is coarse by nature.
- `pyicloud` import is soft (`PyiCloudService = None`) so `--help` works without
  the dependency installed; the real check is in `connect()`.
- Apple returns timestamps in ms; `_norm_ts()` normalises to seconds.

## Testing

Cannot be tested without a live Apple account. Smoke test order: `--store-password`
→ `--list` (copy friend id into config) → `--once` → full run.
