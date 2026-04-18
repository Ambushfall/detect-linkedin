/**
 * Content script (isolated world) for LinkedIn Extension Detector (MV3-B)
 *
 * Acts as a relay between the main-world script (which cannot access
 * chrome.runtime) and the background service worker.
 *
 * Listens for postMessage from the main world script and forwards
 * results to the service worker via chrome.runtime.sendMessage.
 */

(function () {
  'use strict';

  var MESSAGE_TYPE = '__EXT_DETECTOR_RESULTS__';

  window.addEventListener('message', function (event) {
    // Only accept messages from the same window
    if (event.source !== window) return;

    // Only accept our specific message type
    if (!event.data || event.data.type !== MESSAGE_TYPE) return;

    // Forward results to the background service worker
    chrome.runtime.sendMessage({
      type: 'SCAN_RESULTS',
      results: event.data.results
    });
  });
})();
