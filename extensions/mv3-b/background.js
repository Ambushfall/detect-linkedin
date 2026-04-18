/**
 * Background service worker for LinkedIn Extension Detector (MV3-B)
 *
 * Receives scan results from the content script relay and stores
 * them in chrome.storage.session. Serves results to the popup.
 *
 * Unlike MV3-A, this variant does NOT use webRequest — all detection
 * happens in the main world script via monkey-patched fetch/XHR.
 */

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

console.log('[Extension Detector] Service worker loaded (MV3-B)');
