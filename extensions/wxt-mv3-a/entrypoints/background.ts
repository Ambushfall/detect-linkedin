interface ScanResult {
  extensionId: string;
  resourceFile: string;
  sourceUrl: string;
  name?: string;
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

async function fetchExtensionNames(extensionIds: string[]): Promise<void> {
  if (extensionIds.length === 0) return;

  const nameResults = await Promise.all(
    extensionIds.map(async (id) => {
      try {
        const response = await fetch(
          `https://chromewebstore.google.com/detail/_/${id}`
        );
        if (!response.ok) return null;
        const html = await response.text();
        const match = html.match(/<title>([^<]*)<\/title>/i);
        if (!match) return null;
        const name = match[1].replace(/ - Chrome Web Store$/, '').trim();
        return { extensionId: id, name };
      } catch {
        return null;
      }
    })
  );

  const successful = nameResults.filter((r) => r !== null) as { extensionId: string; name: string }[];
  if (successful.length === 0) return;

  const data = await browser.storage.local.get('linkedin');
  const results: ScanResult[] = (data.linkedin as ScanResult[]) ?? [];
  for (const { extensionId, name } of successful) {
    const entry = results.find((r) => r.extensionId === extensionId);
    if (entry) entry.name = name;
  }
  await browser.storage.local.set({ linkedin: results });
}

async function InitBadgeWithStorage() {
  const data = await browser.storage.local.get('linkedin');
  const results = (data.linkedin as ScanResult[]) || [];
  const count = results.length;
  if (count > 0) {
    await browser.action.setBadgeText({ text: String(count) });
    await browser.action.setBadgeBackgroundColor({ color: '#FF4444' });
  }
  const unnamed = results.filter((r) => !r.name).map((r) => r.extensionId);
  fetchExtensionNames(unnamed);
}

async function handleScanResults(message: { type: string; results: ScanResult[] }) {
    const data = await browser.storage.local.get('linkedin');
    const existing = (data.linkedin as ScanResult[]) || [];
    const existingIds = new Set(existing.map((r) => r.extensionId));

    const delta = message.results.filter((r) => !existingIds.has(r.extensionId));
    if (delta.length === 0) return;

    const updated = existing.concat(delta);
    await browser.storage.local.set({ linkedin: updated });
    fetchExtensionNames(delta.map((r) => r.extensionId));

    await browser.action.setBadgeText({ text: String(updated.length) });
    await browser.action.setBadgeBackgroundColor({ color: '#FF4444' });

    console.log(`[Extension Detector] +${delta.length} new fingerprint(s), ${updated.length} total`);
  }
