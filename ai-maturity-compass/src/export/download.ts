/** Browser download helpers. Everything stays on the device — nothing is uploaded. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  // UTF-8 BOM so Excel opens ₹ and Indian-language text correctly.
  const bom = mime.startsWith('text/csv') ? '﻿' : '';
  downloadBlob(filename, new Blob([bom + text], { type: mime }));
}
