/**
 * Background service worker for LinkedIn Extension Detector (MV3-A)
 *
 * Listens for completed script requests via chrome.webRequest,
 * forwards URLs to the content script for scanning, and stores
 * results in chrome.storage.local (persistent, global, deduplicated by extensionId).
 */

// --- Startup: restore badge from persistent storage ---
(async () => {
  const data = await chrome.storage.local.get('linkedin');
  const count = (data.linkedin || []).length;
  if (count > 0) {
    await chrome.action.setBadgeText({ text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
  }
})();

// --- webRequest listener: detect when script resources finish loading ---
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;

    // Send the completed script URL to the content script for scanning
    chrome.tabs.sendMessage(
      details.tabId,
      { type: 'SCAN_SCRIPT', url: details.url }
    ).catch(() => {
      // Content script not injected in this tab — ignore
    });
  },
  { urls: ['<all_urls>'], types: ['script'] }
);

// --- Message listener: receive results from content script ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SCAN_RESULTS') {
    handleScanResults(message);
  }
});

async function handleScanResults(message) {
  const data = await chrome.storage.local.get('linkedin');
  const existing = data.linkedin || [];
  const existingIds = new Set(existing.map(r => r.extensionId));

  const delta = message.results.filter(r => !existingIds.has(r.extensionId));
  if (delta.length === 0) return;

  const updated = existing.concat(delta);
  await chrome.storage.local.set({ linkedin: updated });

  await chrome.action.setBadgeText({ text: String(updated.length) });
  await chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });

  console.log(`[Extension Detector] +${delta.length} new fingerprint(s), ${updated.length} total`);
}

console.log('[Extension Detector] Service worker loaded (MV3-A)');
