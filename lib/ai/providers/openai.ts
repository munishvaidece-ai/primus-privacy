import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

/**
 * Any OpenAI-compatible chat-completions endpoint (a self-hosted model
 * server inside the client's environment, an in-India hosted endpoint, or a
 * hosted vendor). Verified against a local mock server in tests/ai.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  name = "openai_compatible" as const;
  constructor(
    private readonly apiKey: string,
    public readonly model: string,
    private readonly baseUrl: string,
    private readonly timeoutMs = 60000,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens,
        temperature: 0,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Model API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      model: body.model ?? this.model,
      inputTokens: body.usage?.prompt_tokens,
      outputTokens: body.usage?.completion_tokens,
    };
  }
}
