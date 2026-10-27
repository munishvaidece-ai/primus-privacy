"use client";
import { useEffect, useRef, useState } from "react";

/** Shows a figure that counts up from zero once, when it first appears. Shows the final value without JavaScript or with reduced motion. */
export function CountUp({ value, className }: { value: string | number; className?: string }) {
  const final = String(value);
  const m = final.match(/^(\D*)([\d,]+)(.*)$/);
  const [text, setText] = useState(final);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!m) return;
    let calm = false;
    try { calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* keep the final value */ }
    const end = parseInt(m[2]!.replace(/,/g, ""), 10);
    if (calm || !Number.isFinite(end) || end === 0) return;
    let raf = 0;
    const t0 = performance.now();
    const dur = 1000;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setText(`${m[1]}${Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString("en-IN")}${m[3]}`);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final]);
  return <span ref={ref} className={className} aria-label={final}>{text}</span>;
}
