/**
 * Content script for LinkedIn Extension Detector (MV3-A)
 *
 * Receives script URLs from the background service worker,
 * fetches the script body (leveraging browser cache), and scans
 * it for extension-fingerprinting patterns.
 */

// The same regex from the original index.js
const EXTENSION_PATTERN =
  /['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]\s*,\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/g;

// Track URLs we've already scanned to avoid duplicates
const scannedUrls = new Set();

async function scanUrl(url) {
  if (scannedUrls.has(url)) return;
  scannedUrls.add(url);

  let body;
  try {
    const res = await fetch(url);
    body = await res.text();
  } catch {
    return;
  }

  // Defer CPU work — don't block the current task
  setTimeout(() => {
    const found = [];
    EXTENSION_PATTERN.lastIndex = 0;
    let match;
    while ((match = EXTENSION_PATTERN.exec(body)) !== null) {
      found.push({ extensionId: match[1], resourceFile: match[2], sourceUrl: url });
    }
    if (found.length > 0) {
      console.log('[Extension Detector] Fingerprinting script found at: ' + url);
      console.table(found);
      chrome.runtime.sendMessage({ type: 'SCAN_RESULTS', results: found });
    }
  }, 0);
}

// Listen for messages from the background service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SCAN_SCRIPT' && message.url) scanUrl(message.url);
});
