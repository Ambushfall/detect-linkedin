const EXTENSION_PATTERN =
  /['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]\s*,\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/g;

const scannedUrls = new Set<string>();

async function scanUrl(url: string) {
  if (scannedUrls.has(url)) return;
  scannedUrls.add(url);

  let body: string;
  try {
    const res = await fetch(url);
    body = await res.text();
  } catch {
    return;
  }

  setTimeout(() => {
    const found: { extensionId: string; resourceFile: string; sourceUrl: string }[] = [];
    EXTENSION_PATTERN.lastIndex = 0;
    let match;
    while ((match = EXTENSION_PATTERN.exec(body)) !== null) {
      found.push({ extensionId: match[1], resourceFile: match[2], sourceUrl: url });
    }
    if (found.length > 0) {
      console.log('[Extension Detector] Fingerprinting script found at: ' + url);
      console.table(found);
      browser.runtime.sendMessage({ type: 'SCAN_RESULTS', results: found });
    }
  }, 0);
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (message.type === 'SCAN_SCRIPT' && message.url) scanUrl(message.url as string);
    });
  },
});
