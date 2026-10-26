import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence-storage";

/**
 * Reads the bytes of an evidence object for the AI worker. The worker is a
 * trusted back-end process with no user session, so it uses the Supabase
 * service-role key (never shipped to a browser). It only ever asks for
 * objects whose document_versions row the AI agent could already read under
 * row-level security. With no Supabase configured (local/dev) it reads the
 * same local directory the app's local storage adapter writes to.
 */
export async function readEvidenceObject(storagePath: string): Promise<Buffer> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.storage.from(EVIDENCE_BUCKET).download(storagePath);
    if (error || !data) throw new Error(`Could not read evidence object: ${error?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
  }
  const root = process.env.EVIDENCE_LOCAL_ROOT ?? path.join(process.cwd(), ".local-storage", "evidence");
  return fs.readFile(path.join(root, storagePath));
}
