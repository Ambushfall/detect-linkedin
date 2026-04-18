/**
 * Background script for LinkedIn Extension Detector (MV2)
 *
 * Listens for completed script requests via chrome.webRequest,
 * forwards URLs to the content script for scanning, and stores
 * any fingerprinting results per tab.
 */

// Store results per tab: { tabId: [{ extensionId, resourceFile, sourceUrl }] }
var detectedResults = {};

// --- webRequest listener: detect when script resources finish loading ---
chrome.webRequest.onCompleted.addListener(
  function (details) {
    if (details.tabId < 0) return; // Ignore non-tab requests

    // Send the completed script URL to the content script for scanning
    chrome.tabs.sendMessage(
      details.tabId,
      { type: 'SCAN_SCRIPT', url: details.url },
      function (response) {
        // Suppress errors for tabs where content script isn't injected
        if (chrome.runtime.lastError) return;
      }
    );
  },
  { urls: ['<all_urls>'] },
  []
);

// --- Message listener: receive results from content script & serve popup ---
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'SCAN_RESULTS') {
    var tabId = sender.tab ? sender.tab.id : -1;
    if (tabId < 0) return;

    if (!detectedResults[tabId]) {
      detectedResults[tabId] = [];
    }

    // Append new results
    for (var i = 0; i < message.results.length; i++) {
      detectedResults[tabId].push(message.results[i]);
    }

    // Update badge
    var count = detectedResults[tabId].length;
    chrome.browserAction.setBadgeText({
      text: count > 0 ? String(count) : '',
      tabId: tabId
    });
    chrome.browserAction.setBadgeBackgroundColor({
      color: '#FF4444',
      tabId: tabId
    });

    console.log(
      '[Extension Detector] Found ' +
        message.results.length +
        ' fingerprint(s) in tab ' +
        tabId
    );
  }

  if (message.type === 'GET_RESULTS') {
    // Popup is requesting results for a specific tab
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tabId = tabs[0] ? tabs[0].id : -1;
      sendResponse({ results: detectedResults[tabId] || [] });
    });
    return true; // Keep the message channel open for async sendResponse
  }
});

// --- Clean up when a tab is closed ---
chrome.tabs.onRemoved.addListener(function (tabId) {
  delete detectedResults[tabId];
});

// --- Reset results when a tab navigates to a new page ---
chrome.webNavigation.onBeforeNavigate.addListener(function (details) {
  if (details.frameId === 0) {
    // Main frame navigation — reset results for this tab
    detectedResults[details.tabId] = [];
    chrome.browserAction.setBadgeText({
      text: '',
      tabId: details.tabId
    });
  }
});

console.log('[Extension Detector] Background script loaded (MV2)');
