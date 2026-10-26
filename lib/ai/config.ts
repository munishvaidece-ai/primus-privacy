// AI runtime configuration, read from the environment (documented in
// .env.example and docs/DEPLOYMENT.md). Nothing here is a secret default.
export type ProviderName = "offline" | "anthropic" | "openai_compatible";

export interface AiConfig {
  provider: ProviderName;
  /** Master switch for sending ANY text to an external model. */
  externalEnabled: boolean;
  apiKey: string | null;
  model: string | null;
  baseUrl: string | null;
  /** Shown in the UI as the headline guardrail ("model hosted in <region>"). */
  dataRegion: string;
  maxInputChars: number;
  workerPollMs: number;
  requestTimeoutMs: number;
}

export function readAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const raw = (env.AI_PROVIDER ?? "offline").trim().toLowerCase();
  const provider: ProviderName = raw === "anthropic" || raw === "openai_compatible" ? raw : "offline";
  return {
    provider,
    externalEnabled: (env.AI_EXTERNAL_ENABLED ?? "false").toLowerCase() === "true",
    apiKey: env.AI_API_KEY?.trim() || null,
    model: env.AI_MODEL?.trim() || null,
    baseUrl: env.AI_BASE_URL?.trim() || null,
    dataRegion: env.AI_DATA_REGION?.trim() || "not declared (offline engine: no data leaves this server)",
    maxInputChars: Number(env.AI_MAX_INPUT_CHARS ?? 12000),
    workerPollMs: Number(env.AI_WORKER_POLL_MS ?? 2000),
    requestTimeoutMs: Number(env.AI_REQUEST_TIMEOUT_MS ?? 60000),
  };
}

export function externalConfigProblem(cfg: AiConfig): string | null {
  if (cfg.provider === "offline") return null;
  if (!cfg.externalEnabled) return "AI_PROVIDER is set to an external model but AI_EXTERNAL_ENABLED is not 'true'.";
  if (!cfg.apiKey) return "AI_API_KEY is not set.";
  if (!cfg.model) return "AI_MODEL is not set.";
  if (cfg.provider === "openai_compatible" && !cfg.baseUrl) return "AI_BASE_URL is required for an openai_compatible provider.";
  return null;
}
