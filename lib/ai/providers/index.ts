import { externalConfigProblem, readAiConfig, type AiConfig } from "../config";
import { AnthropicProvider } from "./anthropic";
import { OpenAiCompatibleProvider } from "./openai";
import type { LlmProvider } from "./types";

export type { LlmProvider } from "./types";

export interface ProviderChoice {
  /** null = use the offline rules engine. */
  provider: LlmProvider | null;
  label: string;
  model: string;
  /** Why external AI is not in use although configured (shown to admins). */
  note: string | null;
}

/**
 * Picks the provider for one engagement. External AI is used only when ALL
 * of: the deployment enables it (AI_EXTERNAL_ENABLED), a provider is fully
 * configured, AND the engagement's own switch (allow_external_ai) is on.
 * Anything else falls back to the offline engine, which never sends data
 * anywhere.
 */
export function chooseProvider(allowExternalForEngagement: boolean, cfg: AiConfig = readAiConfig()): ProviderChoice {
  const offline: ProviderChoice = { provider: null, label: "offline", model: "rules-engine-1", note: null };
  if (cfg.provider === "offline") return offline;
  const problem = externalConfigProblem(cfg);
  if (problem) return { ...offline, note: problem };
  if (!allowExternalForEngagement) {
    return { ...offline, note: "External AI is configured for this deployment but switched off for this engagement." };
  }
  const provider =
    cfg.provider === "anthropic"
      ? new AnthropicProvider(cfg.apiKey!, cfg.model!, cfg.baseUrl ?? undefined, cfg.requestTimeoutMs)
      : new OpenAiCompatibleProvider(cfg.apiKey!, cfg.model!, cfg.baseUrl!, cfg.requestTimeoutMs);
  return { provider, label: provider.name, model: provider.model, note: null };
}
