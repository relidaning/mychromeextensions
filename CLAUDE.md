# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Loading an Extension

There is no build step. To install or reload an extension:

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select the extension's directory (e.g. `autofocus/`)
4. After editing files, click the reload icon on the extension card

## Repository Structure

Each subdirectory is a self-contained Chrome extension (Manifest V3). All extensions follow the same two-file pattern:

- `manifest.json` — declares permissions, the service worker, and any keyboard commands
- `background.js` — service worker; listens for Chrome events (tab activation, window focus, keyboard commands) and calls `chrome.scripting.executeScript` to inject `content.js`
- `content.js` — runs in the page context and manipulates the DOM directly

The `customizekeys` extension is a skeleton with only a manifest (no logic yet). `videospeed`'s `background.js` is an exception to the usual pattern: its content script is registered statically via manifest `content_scripts` (not injected by the background worker), so `background.js` instead only relays messages between frames — see the Reaching the Real `<video>` Across Frames note below.

## Extension Summaries

| Directory | What it does |
|---|---|
| `hello` | Popup demo |
| `autofocus` | Focuses the search input on Baidu / Google / ChatGPT / DeepSeek when the tab is activated or the window gains focus |
| `searchingingoogle` | `Ctrl+X` searches selected text (falls back to clipboard) on Google appending " meaning"; `Ctrl+Z` does the same appending " 中文" for Chinese explanation |
| `rmmaskinrarbg` | Removes the `<ab-detector>` element injected by rarbg's anti-adblock overlay |
| `customizekeys` | Stub for custom keyboard shortcuts |
| `videospeed` | `Alt+↑` speeds up the active `<video>` on the page by 0.25x, `Alt+↓` slows it down (0.25x–4x range), `←`/`→` seek the active video by 15s (`SEEK_STEP`) (guarded on `getActiveVideo()` in the current frame so plain arrows are left alone on pages without a video; capture-phase `stopImmediatePropagation` on **both** keydown and the matching keyup fully pre-empts players that do their own arrow seeking — video.js's bundled hotkeys and some sites' hand-rolled handlers seek on keyUP, so swallowing only keydown still leaves a double-jump. `getActiveVideo()` also falls back to `readyState > 0 || currentSrc` when every `<video>` reports a 0×0 box, which video.js does when it's not in "fluid" mode), with a brief on-screen toast; works even when the video lives in a cross-origin iframe (embedded players) via the frame-relay pattern below; on YouTube it mutes ads and seeks them to their end (see Skipping YouTube Ads below); it also tears out YouTube's "ad blocker detected" enforcement dialog (`ytd-enforcement-message-view-model`) and its backdrop, then resumes playback — and reloads the page if the player stays dead, since by the time that dialog appears YouTube has usually already torn down the MediaSource |
| `regexfilter` | `Ctrl+Q` opens a small floating input box; the regex you type is scanned once against the page's text nodes and matches are wrapped in `<mark>` highlights. Enter jumps to the next match (or runs a fresh scan if the pattern changed), Shift+Enter to the previous, Esc clears all highlights and closes the box. No background worker — everything lives in a single statically-registered content script, since there's no cross-frame or event-relay need here (unlike `videospeed`) |

## Key Concepts

### Chrome PDF Viewer Limitation
Chrome's built-in PDF viewer runs at `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/...`. Because it is itself a Chrome extension page, `chrome.scripting.executeScript` **cannot inject content scripts into it** — this is a hard security boundary, not a configuration issue. Extensions like `searchingingoogle` therefore have no effect when the active tab is a PDF.

**Workaround:** The `chrome.contextMenus` API (with `selectionText`) *does* work on PDF pages. Registering a context-menu item is the correct approach for any feature that needs to act on selected text inside the PDF viewer.

### Trusted Input Requires `chrome.debugger` — and Is Usually the Wrong Tool
Synthetic events (`el.click()`, `dispatchEvent(new MouseEvent(...))`) always report `isTrusted: false`. Pages that gate real actions behind a trust check — e.g. YouTube's "Skip Ad" button — silently ignore synthetic clicks no matter how faithfully the event sequence is constructed. The only way for an extension to send a genuinely trusted click is `chrome.debugger` (Chrome DevTools Protocol) from the background service worker, dispatching `Input.dispatchMouseEvent` at the target's coordinates.

**Do not reach for this unless there is no alternative.** `videospeed` used it to click YouTube's Skip button and had to abandon the approach, because attaching the debugger shows Chrome's native "started debugging this browser" infobar — browser-chrome UI that no API can hide, restyle, or suppress. That infobar **resizes the page viewport**, so the page reflows and the coordinates captured before the attach no longer point at the button. The click lands somewhere else, which on YouTube tripped the ad-blocker enforcement wall and left the player permanently black. If a trusted click is genuinely unavoidable, re-measure the target *after* attaching, and attach → dispatch → detach immediately.

### Skipping YouTube Ads
Don't click the Skip button. Set `video.currentTime = video.duration` on the ad instead: it needs no trusted input (so no `chrome.debugger` and no infobar), and it works on non-skippable ads, which no Skip-button click ever could. Guard with `Number.isFinite(video.duration)` — YouTube reports `Infinity` while an ad is still loading — and only seek when `currentTime < duration - 0.15` so the polling loop doesn't thrash. Detect the ad via `movie_player`'s `ad-showing` / `ad-interrupting` classes. Ad and feature share one `<video>` element, so mute/restore around the ad and re-apply the user's `playbackRate` on the way out, since YouTube resets it when it swaps the source back. See `videospeed/content.js`.

### Browser-Reserved Keyboard Shortcuts Never Reach the Page
Some Ctrl/Alt key combos are handled by Chrome's own UI (the browser chrome), not the page — e.g. `Ctrl+E` and `Ctrl+K` focus the address bar for a search, and on Linux `Ctrl+Q` has historically quit the browser outright. When a shortcut is intercepted this way, a page-level `keydown` listener in `content.js` **never fires at all**; there is no event to catch or `preventDefault()`. This is indistinguishable, from the extension's point of view, from the listener simply not being registered — the symptom is "nothing happens." `videospeed` hit this first (`Ctrl+↑`/`Ctrl+↓` conflicted and were switched to `Alt+↑`/`Alt+↓`); `regexfilter` hit it with `Ctrl+E` and moved to `Ctrl+Q`.

**Before wiring up a shortcut, check whether it's in Chrome's own keyboard-shortcut list** (single Ctrl/Alt+letter combos are the most likely to collide). When in doubt, prefer combos Chrome doesn't already use, and verify by testing the actual key rather than assuming — reserved-shortcut behavior can vary by OS and Chrome version, so a combo that's risky on paper (like `Ctrl+Q` on Linux) may turn out to be free in practice, and vice versa.

### Reaching the Real `<video>` Across Frames
A page's actual `<video>` element (e.g. an embedded YouTube player) often sits in a cross-origin iframe that never receives keyboard focus — a `keydown` listener on the top frame will fire, but `document.querySelectorAll('video')` in that same frame finds nothing real to act on. The fix is to register the content script with `"all_frames": true` (see `videospeed/manifest.json`) so a copy runs in every frame, then have whichever frame captures the keyboard event relay the action through `background.js` via `chrome.tabs.sendMessage(tabId, ...)` with no `frameId` — that broadcasts to every frame in the tab, letting the frame that actually owns the video pick it up and act. See `videospeed/content.js` and `background.js` for the reference implementation. Also filter candidate elements to those with non-zero `clientWidth`/`clientHeight`, since hidden/off-screen elements otherwise get selected over the real, visible one.

## Adding a New Extension

1. Create a new directory with `manifest.json` (set `"manifest_version": 3`)
2. If you need page interaction: add a `background.js` service worker that injects `content.js`, and a `content.js` that manipulates the DOM
3. If you need a keyboard shortcut: declare it under `"commands"` in the manifest and listen with `chrome.commands.onCommand` in `background.js`
4. Load the directory as an unpacked extension to test
