/**
 * Main World script for LinkedIn Extension Detector (MV3-B)
 *
 * Runs in the page's JavaScript context ("MAIN" world) so it can
 * monkey-patch window.fetch and XMLHttpRequest to intercept response
 * bodies as they flow through the page.
 *
 * When a script response body matches the fingerprinting regex,
 * results are sent to the isolated content script via window.postMessage.
 */

(function () {
  'use strict';

  var EXTENSION_PATTERN =
    /['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]\s*,\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/g;

  var MESSAGE_TYPE = '__EXT_DETECTOR_RESULTS__';

  /**
   * Scan a script body for extension fingerprinting patterns
   * and post results to the isolated content script if found.
   */
  function scanBody(body, sourceUrl) {
    if (typeof body !== 'string' || body.length === 0) return;

    var match;
    var foundExtensions = [];

    EXTENSION_PATTERN.lastIndex = 0;

    while ((match = EXTENSION_PATTERN.exec(body)) !== null) {
      foundExtensions.push({
        extensionId: match[1],
        resourceFile: match[2],
        sourceUrl: sourceUrl
      });
    }

    if (foundExtensions.length > 0) {
      console.log(
        '[Extension Detector] Fingerprinting script found at: ' + sourceUrl
      );
      console.table(foundExtensions);

      // Send to isolated content script via postMessage
      window.postMessage(
        {
          type: MESSAGE_TYPE,
          results: foundExtensions
        },
        '*'
      );
    }
  }

  // --- Monkey-patch fetch ---
  var originalFetch = window.fetch;

  window.fetch = function () {
    var args = arguments;
    var url =
      typeof args[0] === 'string'
        ? args[0]
        : args[0] && args[0].url
        ? args[0].url
        : '';

    return originalFetch.apply(this, args).then(function (response) {
      // Only scan script-like responses
      var contentType = '';
      try {
        contentType = response.headers.get('content-type') || '';
      } catch (e) {}

      var isScript =
        contentType.indexOf('javascript') !== -1 ||
        contentType.indexOf('ecmascript') !== -1 ||
        url.endsWith('.js');

      if (isScript) {
        // Clone the response so the page still gets the original
        var cloned = response.clone();
        cloned
          .text()
          .then(function (body) {
            scanBody(body, url);
          })
          .catch(function () {});
      }

      return response;
    });
  };

  // --- Monkey-patch XMLHttpRequest ---
  var originalXHROpen = XMLHttpRequest.prototype.open;
  var originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._extDetectorUrl = url;
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    var url = xhr._extDetectorUrl || '';

    xhr.addEventListener('load', function () {
      // Check if this looks like a script response
      var contentType = '';
      try {
        contentType = xhr.getResponseHeader('content-type') || '';
      } catch (e) {}

      var isScript =
        contentType.indexOf('javascript') !== -1 ||
        contentType.indexOf('ecmascript') !== -1 ||
        (typeof url === 'string' && url.endsWith('.js'));

      if (isScript) {
        try {
          scanBody(xhr.responseText, url);
        } catch (e) {}
      }
    });

    return originalXHRSend.apply(this, arguments);
  };

  // --- Also scan <script> tags loaded via HTML parsing ---
  // Use a MutationObserver to catch script elements as they're inserted
  var observedScripts = {};

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var addedNodes = mutations[i].addedNodes;
      for (var j = 0; j < addedNodes.length; j++) {
        var node = addedNodes[j];
        if (
          node.tagName === 'SCRIPT' &&
          node.src &&
          !observedScripts[node.src]
        ) {
          observedScripts[node.src] = true;

          // Fetch the script content to scan it
          (function (scriptUrl) {
            originalFetch
              .call(window, scriptUrl)
              .then(function (resp) {
                return resp.text();
              })
              .then(function (body) {
                scanBody(body, scriptUrl);
              })
              .catch(function () {});
          })(node.src);
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  console.log('[Extension Detector] Main world interceptors installed (MV3-B)');
})();
