// The Primus mark and wordmark, identical to the microsite's.
export function PrimusMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="18 18 439 439" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="pmg" gradientUnits="userSpaceOnUse" x1="29" y1="444" x2="446" y2="29">
          <stop offset="0" stopColor="#b27a42" />
          <stop offset=".55" stopColor="#8a4a2a" />
          <stop offset="1" stopColor="#5a0f13" />
        </linearGradient>
      </defs>
      <path d="M29,29 H446 V444 H175 V161.5 H294 A73.75,73.75 0 0 1 294,309 H229 V254 H245 A72.75,72.75 0 0 0 245,108.5 H122.5 V390.5 H29 Z" fill="none" stroke="url(#pmg)" strokeWidth="16" strokeLinejoin="miter" />
    </svg>
  );
}

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <PrimusMark size={36} />
      <span className={`grid font-['Fira_Sans'] text-[16px] font-medium leading-[0.98] tracking-[0.01em] ${light ? "text-[#f3d9c7]" : "text-[#5c1013]"}`}>
        <span>PRIMUS</span>
        <span>PARTNERS<sup className="text-[0.5em]">®</sup></span>
      </span>
      <span className={`ml-1 border-l pl-3 font-display text-[15px] font-semibold ${light ? "border-white/25 text-white" : "border-slate-200 text-copper"}`}>
        Privacy<sup className="text-[0.55em]">™</sup>
      </span>
    </span>
  );
}
