import crypto from "node:crypto";

// Connector credentials are encrypted before they reach the database
// (AES-256-GCM). The key lives only in the deployment's environment
// (CONNECTOR_SECRET_KEY: 32 bytes, base64 or hex). Without the key no
// connector secret can be saved or read.

export class SecretKeyError extends Error {}

function key(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.CONNECTOR_SECRET_KEY?.trim();
  if (!raw) throw new SecretKeyError("CONNECTOR_SECRET_KEY is not set. Generate one with: openssl rand -base64 32");
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new SecretKeyError("CONNECTOR_SECRET_KEY must decode to exactly 32 bytes.");
  return buf;
}

export const SECRET_KEY_VERSION = 1;

export function encryptSecret(value: Record<string, string>, env?: NodeJS.ProcessEnv): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(env), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(ciphertext: string, env?: NodeJS.ProcessEnv): Record<string, string> {
  const [v, iv, tag, data] = ciphertext.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format.");
  const d = crypto.createDecipheriv("aes-256-gcm", key(env), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  const plain = Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  return JSON.parse(plain) as Record<string, string>;
}
