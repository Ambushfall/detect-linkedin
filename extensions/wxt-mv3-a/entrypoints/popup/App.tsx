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

    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes.linkedin) {
        setResults((changes.linkedin.newValue as ScanResult[]) || []);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  return (
    <div className="min-w-[420px] max-w-[500px] bg-[#0f1923] text-[#e0e6ed] font-sans">
      <div className="bg-gradient-to-br from-[#1a2a3a] to-[#0d1b2a] px-5 py-4 border-b border-[rgba(0,212,255,0.15)] flex items-center gap-3">
        <div className="w-7 h-7 bg-gradient-to-br from-[#00d4ff] to-[#0099cc] rounded-md flex items-center justify-center text-sm shrink-0">
          🔍
        </div>
        <h1 className="text-[15px] font-semibold text-white tracking-[-0.2px]">Extension Detector</h1>
        <span className="ml-auto bg-[rgba(0,212,255,0.12)] text-[#00d4ff] text-[11px] font-semibold px-2 py-[3px] rounded-[10px] border border-[rgba(0,212,255,0.2)]">
          {results.length > 0 ? results.length : '—'}
        </span>
      </div>

      <div className="px-5 py-4 max-h-[400px] overflow-y-auto">
        {results.length === 0 ? (
          <div className="text-center py-8 px-4">
            <div className="text-[36px] mb-3 opacity-50">🛡️</div>
            <h2 className="text-sm font-semibold text-[#8899aa] mb-1.5">No fingerprinting detected</h2>
            <p className="text-xs text-[#556677] leading-relaxed">
              Navigate to a page and this extension will<br />scan loaded scripts for fingerprinting patterns.
            </p>
          </div>
        ) : (
          results.map((r, i) => (
            <div
              key={i}
              className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg py-3 px-3.5 mb-2 last:mb-0 hover:border-[rgba(0,212,255,0.2)] transition-colors"
            >
              <div className="flex items-start mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#556677] min-w-[70px] shrink-0 pt-px">Ext ID</span>
                <span className="text-xs text-[#ff6b6b] break-all font-mono">{r.extensionId}</span>
              </div>
              <div className="flex items-start mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#556677] min-w-[70px] shrink-0 pt-px">File</span>
                <span className="text-xs text-[#ffd93d] break-all font-mono">{r.resourceFile}</span>
              </div>
              <div className="flex items-start">
                <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#556677] min-w-[70px] shrink-0 pt-px">Source</span>
                <span className="text-[11px] text-[#69b4ff] break-all font-mono">
                  {r.sourceUrl.length > 80 ? r.sourceUrl.slice(0, 80) + '…' : r.sourceUrl}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="px-5 py-2.5 border-t border-[rgba(255,255,255,0.05)] text-center">
        <span className="text-[10px] text-[#445566]">
          Manifest V3 · <span className="text-[#00d4ff]">WXT + React</span>
        </span>
      </div>
    </div>
  );
}

export default App;
