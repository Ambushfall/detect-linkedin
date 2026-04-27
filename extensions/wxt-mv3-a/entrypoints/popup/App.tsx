import { useState, useEffect } from 'react';
import { browser } from 'wxt/browser';
import './App.css';
import ExtensionsList from '@/components/ExtensionsList';
import { type ScanResult } from '@/components/ExtensionView';
import newFetch from '@/tools/fetcher';

function App() {
  const [results, setResults] = useState<ScanResult[]>([]);
  async function fetcher(){
    let res = await newFetch("https://chromewebstore.google.com/detail/text-to-video-ai-video-cr/aaaeoelkococjpgngfokhbkkfiiegolp");
    await browser.runtime.sendMessage({ type: 'test', results: res });
  }
// TODO ChromeMV3Test eval if newfetch would work with same trick, if yes, mimick same in output and eval.
// TODO If Not, figure out a different way at least to post to a diff location and save the refference data.
  useEffect(() => {
    fetcher()
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
    <div className="min-w-105 max-w-125 bg-[#0f1923] text-[#e0e6ed] font-sans">
      <div className="bg-linear-to-br from-[#1a2a3a] to-[#0d1b2a] px-5 py-4 border-b border-[rgba(0,212,255,0.15)] flex items-center gap-3">
        <div className="w-7 h-7 bg-linear-to-br from-[#00d4ff] to-[#0099cc] rounded-md flex items-center justify-center text-sm shrink-0">
          🔍
        </div>
        <h1 className="text-[15px] font-semibold text-white tracking-[-0.2px]">Extension Detector</h1>
        <span className="ml-auto bg-[rgba(0,212,255,0.12)] text-[#00d4ff] text-[11px] font-semibold px-2 py-0.75 rounded-[10px] border border-[rgba(0,212,255,0.2)]">
          {results.length > 0 ? results.length : '—'}
        </span>
      </div>

      <ExtensionsList results={results} />

      <div className="px-5 py-2.5 border-t border-[rgba(255,255,255,0.05)] text-center">
        <span className="text-[10px] text-[#445566]">
          Manifest V3 · <span className="text-[#00d4ff]">WXT + React</span>
        </span>
      </div>
    </div>
  );
}

export default App;
