/**
 * Popup script for LinkedIn Extension Detector (MV3-A)
 *
 * Reads scan results directly from chrome.storage.local
 * and renders them into the popup UI.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('results-container');
  const emptyState = document.getElementById('empty-state');
  const countBadge = document.getElementById('count-badge');

  const data = await chrome.storage.local.get('linkedin');
  const results = data.linkedin ?? [];

  countBadge.textContent = results.length;

  if (results.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  for (const result of results) {
    const card = document.createElement('div');
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
