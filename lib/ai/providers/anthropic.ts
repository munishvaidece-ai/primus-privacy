import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

/**
 * Anthropic Messages API. Wire format implemented from the public API
 * documentation; verified against a local mock server in tests/ai (it has
 * NOT been exercised against the live API from this build environment).
 */
export class AnthropicProvider implements LlmProvider {
  name = "anthropic" as const;
  constructor(
    private readonly apiKey: string,
    public readonly model: string,
    private readonly baseUrl = "https://api.anthropic.com",
    private readonly timeoutMs = 60000,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as {
      model?: string;
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    return { text, model: body.model ?? this.model, inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens };
  }
}
