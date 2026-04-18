# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies (Playwright)
npm start         # run the Node.js Playwright scanner (index.js)
```

To use the browser extensions, load them manually via Chrome's `chrome://extensions` page (enable Developer Mode → Load unpacked → select the desired `extensions/mv2`, `extensions/mv3-a`, or `extensions/mv3-b` directory).

The Playwright script (`npm start`) requires a Chrome instance already running with remote debugging enabled:
```bash
google-chrome --remote-debugging-port=9222
```

## Architecture

This project detects LinkedIn's browser extension fingerprinting — LinkedIn embeds extension IDs and resource file paths inside JavaScript payloads to probe whether specific extensions are installed. The core detection uses a single regex across all implementations:

```js
/['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]\s*,\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/g
```

There are **four implementations** of this detection:

### `index.js` — Node.js / Playwright scanner
Connects to a running Chrome instance via CDP on `localhost:9222`, navigates to LinkedIn, intercepts all script responses, and prints matches via `console.table`. One-shot research tool.

### `extensions/mv2/` — Manifest V2 extension
- Background page uses `chrome.webRequest.onCompleted` to capture script URLs, forwards them to the content script via `chrome.tabs.sendMessage`
- Content script fetches the URL (from browser cache) and scans the body
- Results stored in an in-memory object keyed by `tabId`

### `extensions/mv3-a/` — Manifest V3, webRequest approach
- Service worker (non-persistent) replaces the background page
- Same `webRequest` + content script fetch pattern as MV2
- Results persisted in `chrome.storage.session` to survive service worker restarts

### `extensions/mv3-b/` — Manifest V3, main-world monkey-patching
- No `webRequest` — instead injects `main-world.js` into the page's **MAIN world** at `document_start`
- `main-world.js` monkey-patches `window.fetch`, `XMLHttpRequest`, and a `MutationObserver` on `<script src>` tags to intercept responses before they're processed
- Results are passed from MAIN world → isolated world via `window.postMessage` (channel: `__EXT_DETECTOR_RESULTS__`)
- `content.js` relays messages from the page to the service worker via `chrome.runtime.sendMessage`
- Service worker stores results in `chrome.storage.session` and updates the badge

### Key architectural difference: MV3-A vs MV3-B
MV3-A relies on `webRequest` (requires `declarativeNetRequest` or the older `webRequest` permission) and fetches script bodies from cache in the content script. MV3-B avoids `webRequest` entirely by hooking into the page's own JS execution context, which is more reliable but requires careful MAIN-world isolation.
