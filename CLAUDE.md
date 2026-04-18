# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies (Playwright)
npm start         # run the Node.js Playwright scanner (index.js)
```

The Playwright script requires Chrome with remote debugging already running:
```bash
google-chrome --remote-debugging-port=9222
```

For the WXT-based extension (`extensions/wxt-mv3-a/`):
```bash
cd extensions/wxt-mv3-a
bun install
bun run dev       # dev mode with HMR
bun run build     # production build
bun run compile   # TypeScript type-check without emitting
bun run zip       # package for distribution
```

To load the plain extensions, use Chrome's `chrome://extensions` (Developer Mode → Load unpacked → select `extensions/mv2`, `extensions/mv3-a`, or `extensions/mv3-b`).

## Architecture

This project detects LinkedIn's browser extension fingerprinting — LinkedIn embeds extension IDs and resource file paths inside JavaScript payloads to probe whether specific extensions are installed. The core detection uses a single regex across all implementations:

```js
/['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]\s*,\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/g
```

Each match produces `{ extensionId, resourceFile, sourceUrl }`.

There are **five implementations**:

### `index.js` — Node.js / Playwright scanner
Connects to Chrome via CDP on `localhost:9222`, navigates to `linkedin.com/feed/`, intercepts all script responses, and prints matches via `console.table`. One-shot research tool.

### `extensions/mv2/` — Manifest V2 extension
- Background page uses `chrome.webRequest.onCompleted` to capture script URLs, forwards them to the content script via `chrome.tabs.sendMessage`
- Content script fetches the URL (from browser cache) and scans the body
- Results stored in an **in-memory object keyed by `tabId`** — lost on service worker restart
- Badge is per-tab; cleared on navigation

### `extensions/mv3-a/` — Manifest V3, webRequest approach
- Service worker replaces the background page; same `webRequest` + content script fetch pattern as MV2
- Results stored in **`chrome.storage.local`** — persistent across browser restarts, global (not per-tab), deduplicated by `extensionId`
- Badge is global (no `tabId`); restored from storage on service worker startup

### `extensions/mv3-b/` — Manifest V3, main-world monkey-patching
- No `webRequest` — injects `main-world.js` into the page's **MAIN world** at `document_start`
- `main-world.js` monkey-patches `window.fetch`, `XMLHttpRequest`, and uses a `MutationObserver` on `<script src>` tags to intercept responses before they're processed
- Results passed MAIN world → isolated world via `window.postMessage` (channel: `__EXT_DETECTOR_RESULTS__`)
- `content.js` relays to the service worker via `chrome.runtime.sendMessage`
- Results stored in **`chrome.storage.session`** keyed by `tab_<tabId>` — cleared on browser restart; badge is per-tab

### `extensions/wxt-mv3-a/` — WXT + React/TypeScript port of MV3-A
- Built with [WXT](https://wxt.dev/) framework and React 19; TypeScript throughout; uses bun as package manager
- Same detection approach as `mv3-a`: `webRequest` listener in the background, content script fetches and scans script bodies, results in `browser.storage.local`
- WXT auto-imports `defineBackground`, `defineContentScript`, and `browser` in entrypoint files; React component files must explicitly `import { browser } from 'wxt/browser'`
- Popup re-renders live via `browser.storage.onChanged` listener mounted in a `useEffect`
- Entrypoints: `entrypoints/background.ts`, `entrypoints/content.ts`, `entrypoints/popup/` (React app)
- Manifest permissions and host_permissions are declared in `wxt.config.ts`, not in a `manifest.json`

### Key architectural differences

| | MV2 | MV3-A | MV3-B | WXT MV3-A |
|---|---|---|---|---|
| Detection trigger | `webRequest` | `webRequest` | MAIN world hooks | `webRequest` |
| Storage | In-memory (per tab) | `storage.local` (global) | `storage.session` (per tab) | `storage.local` (global) |
| Survives restart | No | Yes | No | Yes |
| Badge scope | Per-tab | Global | Per-tab | Global |
