/**
 * File delivery. Everything stays on the device — nothing is uploaded.
 *
 * In a plain browser the file is saved through a temporary link. Inside the Claude Artifact viewer, script-driven
 * downloads are blocked, so the viewer's `downloads` capability is used instead (the viewer asks the person to confirm).
 */
export type SaveStatus = 'saved' | 'declined' | 'failed';

interface DownloadsCapability {
  save(req: { filename: string; data: string | Blob | ArrayBuffer }): Promise<{ status: 'saved' | 'delivered' }>;
}

async function viaViewer(filename: string, data: string | Blob): Promise<SaveStatus | null> {
  const claude = typeof window !== 'undefined' ? window.claude : undefined;
  if (!claude || typeof claude.use !== 'function') return null;
  let cap: DownloadsCapability | null = null;
  try {
    cap = (await claude.use('downloads')) as DownloadsCapability | null;
  } catch {
    cap = null;
  }
  if (!cap || typeof cap.save !== 'function') return null;
  try {
    await cap.save({ filename, data });
    return 'saved';
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'declined') return 'declined';
    return 'failed';
  }
}

function viaAnchor(filename: string, blob: Blob): SaveStatus {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

export async function downloadBlob(filename: string, blob: Blob): Promise<SaveStatus> {
  const viewer = await viaViewer(filename, blob);
  return viewer ?? viaAnchor(filename, blob);
}

export async function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): Promise<SaveStatus> {
  // UTF-8 BOM so Excel opens ₹ and Indian-language text correctly.
  const body = (mime.startsWith('text/csv') ? '﻿' : '') + text;
  const viewer = await viaViewer(filename, body);
  return viewer ?? viaAnchor(filename, new Blob([body], { type: mime }));
}

/** Toast message for a save outcome. */
export function saveMessage(status: SaveStatus, what: string): { message: string; tone: 'good' | 'info' | 'bad' } {
  if (status === 'saved') return { message: `${what} ready`, tone: 'good' };
  if (status === 'declined') return { message: `${what} was not saved (cancelled)`, tone: 'info' };
  return { message: `${what} could not be saved in this view`, tone: 'bad' };
}
