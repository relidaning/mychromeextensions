# CLAUDE.md (videospeed)

Extension-specific notes for `videospeed`. See the repo-root `CLAUDE.md` for concepts shared across extensions (trusted-input limits, cross-frame video access, etc.) and its "Skipping YouTube Ads" section for the original seek-to-duration approach.

## YouTube Ad Handling — Current State (Unverified)

The seek-to-duration approach documented at the repo root turned out to have side effects that are still under investigation, not confirmed:

- **Seeking on every poll tick restarts buffering.** The original loop re-ran `video.currentTime = video.duration` on each 300ms tick for as long as the ad showed, which can restart the ad's buffering each time — a plausible cause of a slow (~15s) "skip". Fix applied: seek at most once per ad (tracked via `video.currentSrc + duration` as a key), with a 2s retry window if the first seek didn't take, and polling tightened to 150ms.
- **Seeking straight to the end may look like tampering to YouTube.** After throttling the seek (above), the user reported ads got *more* frequent (~1/min, up from ~2/min). Working hypothesis: an ad that's jumped straight to its end without playing looks unwatched/tampered-with, and YouTube responds by serving ads more often. The seek-to-end was removed entirely; the extension now only mutes the ad and plays it at 16x (`AD_RATE`) through to completion, which still fires the ad's completion beacons without a seek.
- **Skip-button fallback.** When YouTube actually offers a Skip button (`.ytp-skip-ad-button`, `.ytp-ad-skip-button`, `.ytp-ad-skip-button-modern`), the extension now clicks it once per ad (`skippedThisAd` flag) — synthetic clicks are often ignored by YouTube, so it also seeks to the end as backup, but only once the button is already offered, so it reads as a normal skip rather than tampering.

None of these three changes have been confirmed against live YouTube — each was applied in response to the user's report of the *previous* change's outcome, and the loop of hypothesis → code change → next symptom report was still ongoing when the session ended. Before trusting this section, check `content.js`'s ad-handling block (`AD_RATE`, `skippedThisAd`, the `ad-showing`/`ad-interrupting` branch) against what's actually there — the frequency/tampering hypothesis in particular is a guess, not a measured result.

## Douyin: modifier combos are hidden from the page

Douyin's modal player (`douyin.com/jingxuan?modal_id=…`) calls `preventDefault()` on essentially every keydown while a video is open, whatever modifiers are held, and runs its single-letter hotkeys even with Alt/Ctrl down (Alt+C favourites the video). Any browser shortcut a page may cancel therefore dies there — Alt+1..9 tab switching (Linux-only, which is why it goes unnoticed upstream), Ctrl+F, Ctrl+L, Alt+Left. `content.js` has a `douyin.com`-only block that `stopImmediatePropagation()`s keydown/keypress/keyup when Alt, Ctrl or Meta is held or the key is F1–F12 (skipped in inputs), without `preventDefault()`, so Chrome handles the shortcut and plain keys still reach Douyin's hotkeys. A window-capture listener registered at `document_idle` from the isolated world is early enough to pre-empt Douyin's handler.

Measured 2026-10-05 in a headless Chrome over CDP (`Input.dispatchKeyEvent` + a capture listener reading `defaultPrevented` on the next tick), anonymous session. Caveat for re-measuring: without a login, action hotkeys (C, G, L, …) pop the login dialog, and while it is open Douyin's handler stops cancelling keys, which makes later results look clean.
