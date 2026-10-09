/**
 * Build target. The "artifact" build is a single self-contained HTML page for a sandboxed viewer
 * (no URL/history manipulation, no print dialog, file saves go through the viewer's `downloads` capability).
 */
export const IS_ARTIFACT: boolean = import.meta.env.VITE_TARGET === 'artifact';
