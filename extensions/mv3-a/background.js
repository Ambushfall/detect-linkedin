/**
 * Background service worker for LinkedIn Extension Detector (MV3-A)
 *
 * Listens for completed script requests via chrome.webRequest,
 * forwards URLs to the content script for scanning, and stores
 * results in chrome.storage.session to survive service worker restarts.
 */

// --- webRequest listener: detect when script resources finish loading ---
chrome.webRequest.onCompleted.addListener(
  function (details) {
    if (details.tabId < 0) return;

    // Send the completed script URL to the content script for scanning
    chrome.tabs.sendMessage(
      details.tabId,
      { type: 'SCAN_SCRIPT', url: details.url }
    ).catch(function () {
      // Content script not injected in this tab — ignore
    });
  },
  { urls: ['<all_urls>'], types: ['script'] }
);

// --- Message listener: receive results from content script & serve popup ---
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'SCAN_RESULTS') {
    var tabId = sender.tab ? sender.tab.id : -1;
    if (tabId < 0) return;

    var storageKey = 'tab_' + tabId;

    chrome.storage.session.get(storageKey, function (data) {
      var existing = data[storageKey] || [];
      var updated = existing.concat(message.results);

      var obj = {};
      obj[storageKey] = updated;

      chrome.storage.session.set(obj, function () {
        // Update badge
        chrome.action.setBadgeText({
          text: updated.length > 0 ? String(updated.length) : '',
          tabId: tabId
        });
        chrome.action.setBadgeBackgroundColor({
          color: '#FF4444',
          tabId: tabId
        });

        console.log(
          '[Extension Detector] Found ' +
            message.results.length +
            ' fingerprint(s) in tab ' +
            tabId
        );
      });
    });
  }

  if (message.type === 'GET_RESULTS') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tabId = tabs[0] ? tabs[0].id : -1;
      var storageKey = 'tab_' + tabId;

      chrome.storage.session.get(storageKey, function (data) {
        sendResponse({ results: data[storageKey] || [] });
      });
    });
    return true; // Keep message channel open for async response
  }
});

// --- Clean up when a tab is closed ---
chrome.tabs.onRemoved.addListener(function (tabId) {
  chrome.storage.session.remove('tab_' + tabId);
});

// --- Reset results when a tab navigates to a new page ---
chrome.webNavigation.onBeforeNavigate.addListener(function (details) {
  if (details.frameId === 0) {
    var storageKey = 'tab_' + details.tabId;
    chrome.storage.session.remove(storageKey);
    chrome.action.setBadgeText({
      text: '',
      tabId: details.tabId
    });
  }
});

console.log('[Extension Detector] Service worker loaded (MV3-A)');
