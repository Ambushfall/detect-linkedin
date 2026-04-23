export interface ScanResult {
  extensionId: string;
  resourceFile: string;
  sourceUrl: string;
  name?: string;
  iconUrl?: string;
}

function getLastItemSplit(string : string,separator : string){
  return string.split(separator)[string.split(separator).length - 1];
}

export default function ExtensionView({ result }: { result: ScanResult }) {
  return (
    <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg py-3 px-3.5 mb-2 last:mb-0 hover:border-[rgba(0,212,255,0.2)] transition-colors">
      <div className="flex items-stretch gap-2.5">
        <div className="shrink-0 flex pr-20">
          {result.iconUrl ? (
            <img src={result.iconUrl} className="h-full aspect-square rounded object-cover" />
          ) : (
            <div className="h-full aspect-square rounded bg-[rgba(0,212,255,0.1)] border border-[rgba(0,212,255,0.15)] flex items-center justify-center text-[13px] font-bold text-[#00d4ff] uppercase">
              {result.extensionId[0]}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 pl-2">
          {result.name && (
            <div className="flex items-start mb-1.5">
              {/* <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#556677] min-w-[70px] shrink-0 pt-px">Name</span> */}
              <span className="text-xs text-[#c0d0e0] font-medium">{result.name}</span>
            </div>
          )}
          <div className="flex items-start mb-1.5">
            {/* <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#556677] min-w-[70px] shrink-0 pt-px">Ext ID</span> */}
            <span className="text-xs text-[#ff6b6b] break-all font-mono">{result.extensionId}</span>
          </div>
          <div className="flex items-start mb-1.5">
            {/* <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#556677] min-w-[70px] shrink-0 pt-px">File</span> */}
            <span className="text-xs text-[#ffd93d] break-all font-mono">{getLastItemSplit(result.resourceFile, "\/")}</span>
          </div>
          <div className="flex items-start">
            {/* <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#556677] min-w-[70px] shrink-0 pt-px">Source</span> */}
            <span className="text-[11px] text-[#69b4ff] break-all font-mono">
              {getLastItemSplit(result.sourceUrl, "\/")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
