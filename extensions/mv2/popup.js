/**
 * Popup script for LinkedIn Extension Detector (MV2)
 *
 * Requests stored scan results from the background page
 * and renders them into the popup UI.
 */

document.addEventListener('DOMContentLoaded', function () {
  var container = document.getElementById('results-container');
  var emptyState = document.getElementById('empty-state');
  var countBadge = document.getElementById('count-badge');

  chrome.runtime.sendMessage({ type: 'GET_RESULTS' }, function (response) {
    var results = (response && response.results) || [];

    countBadge.textContent = results.length > 0 ? results.length : '0';

    if (results.length === 0) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      var card = document.createElement('div');
      card.className = 'result-card';
      card.innerHTML =
        '<div class="result-row">' +
        '  <span class="result-label">Ext ID</span>' +
        '  <span class="result-value id">' +
        escapeHtml(result.extensionId) +
        '</span>' +
        '</div>' +
        '<div class="result-row">' +
        '  <span class="result-label">File</span>' +
        '  <span class="result-value file">' +
        escapeHtml(result.resourceFile) +
        '</span>' +
        '</div>' +
        '<div class="result-row">' +
        '  <span class="result-label">Source</span>' +
        '  <span class="result-value source">' +
        escapeHtml(truncateUrl(result.sourceUrl)) +
        '</span>' +
        '</div>';
      container.appendChild(card);
    }
  });
});

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncateUrl(url) {
  if (!url) return '';
  if (url.length > 80) {
    return url.substring(0, 77) + '...';
  }
  return url;
}
