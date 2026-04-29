# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies (playwright, mongoose, dotenv, tsx, typescript)
npm start         # run index.ts via tsx
npm test          # run testindex.ts via tsx (experimental scratch file)
```

Requires a `.env` file with MongoDB credentials:
```
MONGO_URI=mongodb://<host>:<port>/<db>
MONGO_USER=...
MONGO_PASS=...
MONGO_AUTH=<authSource>
```

The Playwright script requires Chrome with remote debugging already running:
```bash
google-chrome --remote-debugging-port=9222
```

For the WXT-based extension (`extensions/wxt-mv3-a/`):
```bash
cd extensions/wxt-mv3-a
bun install
bun run dev              # dev mode with HMR (Chrome)
bun run dev:firefox      # dev mode for Firefox
bun run build            # production build (Chrome)
bun run build:firefox    # production build for Firefox
bun run compile          # TypeScript type-check without emitting
bun run zip              # package for distribution
```

To load the plain extensions, use Chrome's `chrome://extensions` (Developer Mode → Load unpacked → select `extensions/mv2`, `extensions/mv3-a`, or `extensions/mv3-b`).

## Architecture

This project detects LinkedIn's browser extension fingerprinting — LinkedIn embeds extension IDs and resource file paths inside JavaScript payloads to probe whether specific extensions are installed. The core detection uses a single regex across all implementations:

```js
/['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]\s*,\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/g
```

Each match produces `{ extensionId, resourceFile, sourceUrl }`.

There are **five implementations**:

### `index.ts` — Node.js / Playwright scanner
Connects to Chrome via CDP on `localhost:9222`, finds an already-open LinkedIn tab, intercepts all script responses, and persists results to **MongoDB** (`mongoose`). Schema (`IExtension`): `extensionId`, `resourceFile`, `sourceScriptUrl`, `name`, `storeUrl`, `firstSeen`, `lastSeen`. On startup, pre-loads previously failed records (`name: '[error]'` or `'(fetch error)'`) and retries them.

**State machine**: `ExtensionRecord` instances go through `pending → fetching → complete | failed`. Ten parallel `runProcessor()` loops (controlled by `CONCURRENCY=10`) poll a shared `registry: Map<string, ExtensionRecord>`. JS single-threading makes the `find → state='fetching'` claim atomic. The `scanDone + activeHandlers === 0 + !hasInflight` triple condition guards processor exit.

**Fetch pipeline** (`fetchExtensionInfo`): retries up to `RETRY_COUNT=3` with `RETRY_DELAY=2000ms` backoff. Returns `terminal: true` for 404/HTTP-error/parse-fail (written to DB once, never retried) and `terminal: false` for network/timeout errors (retried up to `MAX_RETRY_ATTEMPTS=10`). `parseName` prefers `og:title` over `<title>`, strips the " - Chrome Web Store" suffix.

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
- **Content script** (`entrypoints/content.ts`) matches only `*://www.linkedin.com/*` (unlike the plain extensions). Runs at `document_end`, deduplicates via a `scannedUrls` Set, wraps the regex scan in `setTimeout(..., 0)`
- **Background** (`entrypoints/background.ts`): on startup calls `InitBadgeWithStorage()` to reload existing detections and re-fetch names for entries missing them
- **`App.tsx`** contains hardcoded test logic (hits a specific CWS URL, sends `test` message to background) with TODO comments about MV3 fetch tricks — experimental, not production logic
- **`tools/fetcher.ts`**: experimental utility with a `window.open()` fallback for redirect handling — not production-ready
- `ScanResult` is defined independently in `background.ts` and `components/ExtensionView.tsx`; `ExtensionView`'s version adds an optional `iconUrl` field — the two are out of sync
- WXT auto-imports `defineBackground`, `defineContentScript`, and `browser` in entrypoint files; React component files must explicitly `import { browser } from 'wxt/browser'`
- Popup re-renders live via `browser.storage.onChanged` listener mounted in a `useEffect`
- Manifest permissions and host_permissions are declared in `wxt.config.ts`, not in a `manifest.json`; several broad permissions (`cookies`, `userScripts`, `declarativeNetRequest`) are included for future experimentation but unused by current code
- Uses Tailwind CSS v4 via `@tailwindcss/vite` plugin (not v3)

### `python_official_version/newpy.py` — Offline batch tool
Async Python CLI (`asyncio` + `aiohttp`). Takes a saved LinkedIn JS bundle file, extracts `{id, file}` pairs (same regex + a fallback bare-32-char-ID sweep), fetches CWS pages concurrently (`CONCURRENCY=10`), and writes a CSV. Handles 404, 429 (backoff+retry), and timeouts. The repo includes pre-run output: `bundle.js` (2.7 MB input) and `bundle.csv` (~1 MB output). This is the reference implementation that informed `index.ts`'s fetch pipeline design.

### `react-components/` — Standalone UI prototype
- Separate git repository (own `.git`) used to iterate on popup UI design in isolation
- Contains `app.jsx` with hardcoded mock extension data, and two components: `ExtensionsList.jsx` and `ExtensionView.jsx`
- Uses an older prop shape (`{ id, name, resource }`) vs. the TypeScript `ScanResult` type (`extensionId`, `resourceFile`, `sourceUrl`, `name`) — light-themed earlier iteration of the dark `wxt-mv3-a` UI
- No build toolchain or `package.json` — intended for use in an external dev environment (e.g. StackBlitz, Vite with alias config)

### Key architectural differences

| | MV2 | MV3-A | MV3-B | WXT MV3-A | index.ts |
|---|---|---|---|---|---|
| Detection trigger | `webRequest` | `webRequest` | MAIN world hooks | `webRequest` | Playwright response |
| Storage | In-memory (per tab) | `storage.local` (global) | `storage.session` (per tab) | `storage.local` (global) | MongoDB |
| Survives restart | No | Yes | No | Yes | Yes |
| Badge scope | Per-tab | Global | Per-tab | Global | N/A |
