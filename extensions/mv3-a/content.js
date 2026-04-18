/**
 * Content script for LinkedIn Extension Detector (MV3-A)
 *
 * Receives script URLs from the background service worker,
 * fetches the script body (leveraging browser cache), and scans
 * it for extension-fingerprinting patterns.
 */

// The same regex from the original index.js
var EXTENSION_PATTERN =
  /['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]\s*,\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/g;

// Track URLs we've already scanned to avoid duplicates
var scannedUrls = {};

// Listen for messages from the background service worker
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'SCAN_SCRIPT' && message.url) {
    // Skip if already scanned
    if (scannedUrls[message.url]) return;
    scannedUrls[message.url] = true;

    // Fetch the script body (should come from browser cache)
    fetch(message.url)
      .then(function (response) {
        return response.text();
      })
      .then(function (body) {
        var match;
        var foundExtensions = [];

        // Reset regex lastIndex since we reuse the global regex
        EXTENSION_PATTERN.lastIndex = 0;

        while ((match = EXTENSION_PATTERN.exec(body)) !== null) {
          foundExtensions.push({
            extensionId: match[1],
            resourceFile: match[2],
            sourceUrl: message.url
          });
        }

        if (foundExtensions.length > 0) {
          console.log(
            '[Extension Detector] Fingerprinting script found at: ' +
              message.url
          );
          console.table(foundExtensions);

          // Send results back to the background service worker
          chrome.runtime.sendMessage({
            type: 'SCAN_RESULTS',
            results: foundExtensions
          });
        }
      })
      .catch(function (error) {
        // Ignore CORS errors and other fetch failures
      });
  }
});
