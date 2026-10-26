"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { ConnectorInputError, createConnector, requestConnectorRun, setConnectorEnabled, updateConnector } from "@/lib/connectors/service";
import { SecretKeyError } from "@/lib/connectors/secrets";
import { connectorByType } from "@/lib/connectors/catalog";
import { aiBase, withFlag } from "@/components/ai/shell";

const ids = z.object({ organisationId: z.string().uuid(), engagementId: z.string().uuid() });

function target(formData: FormData) {
  const p = ids.safeParse({ organisationId: formData.get("organisationId"), engagementId: formData.get("engagementId") });
  if (!p.success) redirect("/organisations");
  return { scope: p.data, path: `${aiBase(p.data.organisationId, p.data.engagementId)}/connectors` };
}

/** Collects `c_<key>` and `s_<key>` form fields. */
function fields(formData: FormData) {
  const config: Record<string, string> = {};
  const secret: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string") continue;
    if (k.startsWith("c_")) config[k.slice(2)] = v;
    if (k.startsWith("s_")) secret[k.slice(2)] = v;
  }
  return { config, secret };
}

async function guarded(path: string, fn: () => Promise<void>, ok: string): Promise<never> {
  let message: string | null = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof ConnectorInputError || err instanceof SecretKeyError) message = err.message;
    else if (err instanceof NotFoundOrForbiddenError) message = "You do not have permission to do that.";
    else {
      console.error("connector action failed", err);
      message = "Something went wrong. Please try again, or ask your administrator to check the server log.";
    }
  }
  revalidatePath(path);
  redirect(message ? withFlag(path, "error", message) : withFlag(path, "saved", ok));
}

export async function addConnectorAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, path } = target(formData);
  const type = String(formData.get("type") ?? "");
  const { config, secret } = fields(formData);
  await guarded(path, async () => {
    if (!connectorByType(type)) throw new ConnectorInputError("Unknown connector type.");
    await withRequestDb(user.id, (db) => createConnector(db, user.id, scope, { type, name: String(formData.get("name") ?? ""), config, secret }));
  }, "Connector added. Use “Test connection” to check it.");
}

export async function updateConnectorAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, path } = target(formData);
  const id = z.string().uuid().safeParse(formData.get("connectorId"));
  const { config, secret } = fields(formData);
  await guarded(path, async () => {
    if (!id.success) throw new ConnectorInputError("Unknown connector.");
    await withRequestDb(user.id, (db) => updateConnector(db, user.id, scope, id.data, { name: String(formData.get("name") ?? ""), config, secret }));
  }, "Connector updated. Test it again to confirm.");
}

export async function toggleConnectorAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, path } = target(formData);
  const id = z.string().uuid().safeParse(formData.get("connectorId"));
  const enable = formData.get("enable") === "1";
  await guarded(path, async () => {
    if (!id.success) throw new ConnectorInputError("Unknown connector.");
    await withRequestDb(user.id, (db) => setConnectorEnabled(db, user.id, scope, id.data, enable));
  }, enable ? "Connector switched on." : "Connector switched off.");
}

export async function runConnectorAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const { scope, path } = target(formData);
  const id = z.string().uuid().safeParse(formData.get("connectorId"));
  const kind = formData.get("kind") === "scan" ? "scan" : "test";
  await guarded(path, async () => {
    if (!id.success) throw new ConnectorInputError("Unknown connector.");
    const r = await withRequestDb(user.id, (db) => requestConnectorRun(db, user.id, scope, id.data, kind));
    if (!r.queued) throw new ConnectorInputError("That is already queued — wait for it to finish.");
  }, kind === "scan" ? "Scan queued. The AI worker will run it shortly; refresh to see the result." : "Test queued. Refresh in a few seconds to see the result.");
}
