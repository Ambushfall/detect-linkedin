interface ScanResult {
  extensionId: string;
  resourceFile: string;
  sourceUrl: string;
}

export default defineBackground(() => {
  // --- Startup: restore badge from persistent storage ---
  InitBadgeWithStorage()
  

  // --- webRequest listener: detect when script resources finish loading ---
  browser.webRequest.onCompleted.addListener(
    (details) => {
      if (details.tabId < 0) return;

      browser.tabs.sendMessage(
        details.tabId,
        { type: 'SCAN_SCRIPT', url: details.url }
      ).catch(() => {
        // Content script not injected in this tab — ignore
      });
    },
    { urls: ['<all_urls>'], types: ['script'] }
  );

  // --- Message listener: receive results from content script ---
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'SCAN_RESULTS') {
      handleScanResults(message as { type: string; results: ScanResult[] });
    }
  });

  

  console.log('[Extension Detector] Service worker loaded (WXT MV3-A)');
});

async function InitBadgeWithStorage() {
  const data = await browser.storage.local.get('linkedin');
  const results = (data.linkedin as ScanResult[]) || [];
  const count = results.length;
  if (count > 0) {
    await browser.action.setBadgeText({ text: String(count) });
    await browser.action.setBadgeBackgroundColor({ color: '#FF4444' });
  }
}

async function handleScanResults(message: { type: string; results: ScanResult[] }) {
    const data = await browser.storage.local.get('linkedin');
    const existing = (data.linkedin as ScanResult[]) || [];
    const existingIds = new Set(existing.map((r) => r.extensionId));

    const delta = message.results.filter((r) => !existingIds.has(r.extensionId));
    if (delta.length === 0) return;

    const updated = existing.concat(delta);
    await browser.storage.local.set({ linkedin: updated });

    await browser.action.setBadgeText({ text: String(updated.length) });
    await browser.action.setBadgeBackgroundColor({ color: '#FF4444' });

    console.log(`[Extension Detector] +${delta.length} new fingerprint(s), ${updated.length} total`);
  }
