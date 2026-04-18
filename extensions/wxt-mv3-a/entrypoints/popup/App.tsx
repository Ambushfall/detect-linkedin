import { useState, useEffect } from 'react';
import { browser } from 'wxt/browser';
import './App.css';

interface ScanResult {
  extensionId: string;
  resourceFile: string;
  sourceUrl: string;
}

function App() {
  const [results, setResults] = useState<ScanResult[]>([]);

  useEffect(() => {
    browser.storage.local.get('linkedin').then((data) => {
      setResults((data.linkedin as ScanResult[]) || []);
    });
  }, []);

  return (
    <>
      <div className="header">
        <div className="header-icon">🔍</div>
        <h1>Extension Detector</h1>
        <span className="badge">{results.length > 0 ? results.length : '—'}</span>
      </div>

      <div className="content">
        {results.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🛡️</div>
            <h2>No fingerprinting detected</h2>
            <p>Navigate to a page and this extension will<br />scan loaded scripts for fingerprinting patterns.</p>
          </div>
        ) : (
          results.map((r, i) => (
            <div className="result-card" key={i}>
              <div className="result-row">
                <span className="result-label">Ext ID</span>
                <span className="result-value id">{r.extensionId}</span>
              </div>
              <div className="result-row">
                <span className="result-label">File</span>
                <span className="result-value file">{r.resourceFile}</span>
              </div>
              <div className="result-row">
                <span className="result-label">Source</span>
                <span className="result-value source">{r.sourceUrl.length > 80 ? r.sourceUrl.slice(0, 80) + '…' : r.sourceUrl}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="footer">
        <span>Manifest V3 · <span className="approach">WXT + React</span></span>
      </div>
    </>
  );
}

export default App;
