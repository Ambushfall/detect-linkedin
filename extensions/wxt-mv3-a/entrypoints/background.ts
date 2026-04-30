import { type ScanResult } from '@/tools/scanresults'

export default defineBackground(() => {
  // --- Startup: restore badge from persistent storage ---
  InitBadgeWithStorage()

  // --- webRequest listener: detect when script resources finish loading ---
  browser.webRequest.onCompleted.addListener(
    details => {
      if (details.tabId < 0) return

      browser.tabs
        .sendMessage(details.tabId, { type: 'SCAN_SCRIPT', url: details.url })
        .catch(() => {
          // Content script not injected in this tab — ignore
        })
    },
    { urls: ['<all_urls>'], types: ['script'] }
  )

  // --- Message listener: receive results from content script ---
  browser.runtime.onMessage.addListener(
    (message: { type: string; results: ScanResult[] }) => {
      if (message.type === 'SCAN_RESULTS') {
        console.table(message.results)
        handleScanResults(message as { type: string; results: ScanResult[] })
      }
    }
  )

  console.log('[Extension Detector] Service worker loaded (WXT MV3-A)')
})

async function fetchExtensionNames (extensionIds: string[]): Promise<void> {
  if (extensionIds.length === 0) return

  const nameResults = await Promise.all(
    extensionIds.map(async id => {
      try {
        const response = await fetch(
          `https://api.cors.lol/?url=chromewebstore.google.com/detail/_/${id}`
        )
        if (!response.ok) return null
        const html = await response.text()
        const match = html.match(/<title>([^<]*)<\/title>/i)
        const parser = new DOMParser()
        const newHtml = parser.parseFromString(html, 'text/html')
        const xpath = '//img[contains(@alt, "Item logo image for")]'
        const xpathres = newHtml.evaluate(
          xpath,
          newHtml,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        )

        const element = xpathres.singleNodeValue as HTMLImageElement
        if (!match) return null
        const name = match[1].replace(/ - Chrome Web Store$/, '').trim()
        return { extensionId: id, name, iconUrl: element!.src }
      } catch {
        return null
      }
    })
  )

  const successful = nameResults.filter(r => r !== null) as {
    extensionId: string
    name: string
  }[]
  if (successful.length === 0) return

  const data = await browser.storage.local.get('linkedin')
  const results: ScanResult[] = (data.linkedin as ScanResult[]) ?? []
  for (const { extensionId, name } of successful) {
    const entry = results.find(r => r.extensionId === extensionId)
    if (entry) entry.name = name
  }
  await browser.storage.local.set({ linkedin: results })
}

async function InitBadgeWithStorage () {
  const data = await browser.storage.local.get('linkedin')
  const results = (data.linkedin as ScanResult[]) || []
  const count = results.length
  if (count > 0) {
    await browser.action.setBadgeText({ text: String(count) })
    await browser.action.setBadgeBackgroundColor({ color: '#FF4444' })
  }
  const unnamed = results.filter(r => !r.name).map(r => r.extensionId)
  fetchExtensionNames(unnamed)
}

async function handleScanResults (message: {
  type: string
  results: ScanResult[]
}) {
  const data = await browser.storage.local.get('linkedin')
  const existing = (data.linkedin as ScanResult[]) || []
  const existingIds = new Set(existing.map(r => r.extensionId))

  const delta = message.results.filter(r => !existingIds.has(r.extensionId))
  if (delta.length !== 0) {
    const updated = existing.concat(delta)
    await browser.storage.local.set({ linkedin: updated })
    fetchExtensionNames(delta.map(r => r.extensionId))

    await browser.action.setBadgeText({ text: String(updated.length) })
    await browser.action.setBadgeBackgroundColor({ color: '#FF4444' })

    console.log(
      `[Extension Detector] +${delta.length} new fingerprint(s), ${updated.length} total`
    )
  } else {

    console.log(`[Extension Detector] updating names for a total of ${existing.filter(r => !r.name).map(r => r.extensionId).length}`)
    fetchExtensionNames(existing.filter(r => !r.name).map(r => r.extensionId));
  }
}
