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

The `customizekeys` extension is a skeleton with only a manifest (no logic yet). `videospeed`'s `background.js` is an exception to the usual pattern: its content script is registered statically via manifest `content_scripts` (not injected by the background worker), so `background.js` instead only relays `chrome.debugger` commands — see the Trusted Input Requires `chrome.debugger` note below.

## Extension Summaries

| Directory | What it does |
|---|---|
| `hello` | Popup demo |
| `autofocus` | Focuses the search input on Baidu / Google / ChatGPT / DeepSeek when the tab is activated or the window gains focus |
| `searchingingoogle` | `Ctrl+X` searches selected text (falls back to clipboard) on Google appending " meaning"; `Ctrl+Z` does the same appending " 中文" for Chinese explanation |
| `rmmaskinrarbg` | Removes the `<ab-detector>` element injected by rarbg's anti-adblock overlay |
| `customizekeys` | Stub for custom keyboard shortcuts |
| `videospeed` | `Alt+↑` speeds up the active `<video>` on the page by 0.25x, `Alt+↓` slows it down (0.25x–4x range), with a brief on-screen toast; works even when the video lives in a cross-origin iframe (embedded players) via the frame-relay pattern below; on YouTube it mutes/fast-forwards through ads and uses `chrome.debugger` (via `background.js`) to send a trusted click on the skip button once it's enabled; it also tears out YouTube's "ad blocker detected" enforcement dialog (`ytd-enforcement-message-view-model`) and its backdrop, then resumes playback, since that dialog has no dismiss button of its own |

## Key Concepts

### Chrome PDF Viewer Limitation
Chrome's built-in PDF viewer runs at `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/...`. Because it is itself a Chrome extension page, `chrome.scripting.executeScript` **cannot inject content scripts into it** — this is a hard security boundary, not a configuration issue. Extensions like `searchingingoogle` therefore have no effect when the active tab is a PDF.

**Workaround:** The `chrome.contextMenus` API (with `selectionText`) *does* work on PDF pages. Registering a context-menu item is the correct approach for any feature that needs to act on selected text inside the PDF viewer.

### Trusted Input Requires `chrome.debugger`
Synthetic events (`el.click()`, `dispatchEvent(new MouseEvent(...))`) always report `isTrusted: false`. Pages that gate real actions behind a trust check — e.g. YouTube's "Skip Ad" button — silently ignore synthetic clicks no matter how faithfully the event sequence is constructed. The only way for an extension to send a genuinely trusted click is `chrome.debugger` (Chrome DevTools Protocol) from the background service worker, dispatching `Input.dispatchMouseEvent` at the target's screen coordinates. This unavoidably shows Chrome's native "started debugging this browser" banner for the duration the debugger is attached — that banner is browser-chrome UI, not page or extension content, so it cannot be hidden, restyled, or suppressed by any API. Attach → dispatch → detach immediately to keep the flash as brief as possible. See `videospeed/background.js` for the reference implementation.

### Reaching the Real `<video>` Across Frames
A page's actual `<video>` element (e.g. an embedded YouTube player) often sits in a cross-origin iframe that never receives keyboard focus — a `keydown` listener on the top frame will fire, but `document.querySelectorAll('video')` in that same frame finds nothing real to act on. The fix is to register the content script with `"all_frames": true` (see `videospeed/manifest.json`) so a copy runs in every frame, then have whichever frame captures the keyboard event relay the action through `background.js` via `chrome.tabs.sendMessage(tabId, ...)` with no `frameId` — that broadcasts to every frame in the tab, letting the frame that actually owns the video pick it up and act. See `videospeed/content.js` and `background.js` for the reference implementation. Also filter candidate elements to those with non-zero `clientWidth`/`clientHeight`, since hidden/off-screen elements otherwise get selected over the real, visible one.

## Adding a New Extension

1. Create a new directory with `manifest.json` (set `"manifest_version": 3`)
2. If you need page interaction: add a `background.js` service worker that injects `content.js`, and a `content.js` that manipulates the DOM
3. If you need a keyboard shortcut: declare it under `"commands"` in the manifest and listen with `chrome.commands.onCommand` in `background.js`
4. Load the directory as an unpacked extension to test
