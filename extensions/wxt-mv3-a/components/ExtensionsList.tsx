import ExtensionView from '@/components/ExtensionView';
import { type ScanResult } from '@/tools/scanresults';

export default function ExtensionsList({ results }: { results: ScanResult[] }) {
  return (
    <div className="px-5 py-4 max-h-100 overflow-y-auto">
      {results.length === 0 ? (
        <div className="text-center py-8 px-4">
          <div className="text-[36px] mb-3 opacity-50">🛡️</div>
          <h2 className="text-sm font-semibold text-[#8899aa] mb-1.5">No fingerprinting detected</h2>
          <p className="text-xs text-[#556677] leading-relaxed">
            Navigate to a page and this extension will<br />scan loaded scripts for fingerprinting patterns.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((r) => (
            <ExtensionView result={r} key={r.extensionId} />
          ))}
        </div>
      )}
    </div>
  );
}
