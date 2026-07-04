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

The `customizekeys` extension is a skeleton with only a manifest (no logic yet).

## Extension Summaries

| Directory | What it does |
|---|---|
| `hello` | Popup demo |
| `autofocus` | Focuses the search input on Baidu / Google / ChatGPT / DeepSeek when the tab is activated or the window gains focus |
| `searchingingoogle` | `Ctrl+X` searches selected text (falls back to clipboard) on Google appending " meaning"; `Ctrl+Z` does the same appending " 中文" for Chinese explanation |
| `rmmaskinrarbg` | Removes the `<ab-detector>` element injected by rarbg's anti-adblock overlay |
| `customizekeys` | Stub for custom keyboard shortcuts |

## Key Concepts

### Chrome PDF Viewer Limitation
Chrome's built-in PDF viewer runs at `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/...`. Because it is itself a Chrome extension page, `chrome.scripting.executeScript` **cannot inject content scripts into it** — this is a hard security boundary, not a configuration issue. Extensions like `searchingingoogle` therefore have no effect when the active tab is a PDF.

**Workaround:** The `chrome.contextMenus` API (with `selectionText`) *does* work on PDF pages. Registering a context-menu item is the correct approach for any feature that needs to act on selected text inside the PDF viewer.

## Adding a New Extension

1. Create a new directory with `manifest.json` (set `"manifest_version": 3`)
2. If you need page interaction: add a `background.js` service worker that injects `content.js`, and a `content.js` that manipulates the DOM
3. If you need a keyboard shortcut: declare it under `"commands"` in the manifest and listen with `chrome.commands.onCommand` in `background.js`
4. Load the directory as an unpacked extension to test
