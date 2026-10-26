export interface LlmRequest {
  system: string;
  prompt: string;
  maxTokens: number;
}
export interface LlmResponse {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}
export interface LlmProvider {
  name: "offline" | "anthropic" | "openai_compatible";
  model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}
