// The generic task runner: offline rules engine or an external model, with
// strict schema validation and (for external models) one repair retry.
import type { z } from "zod";
import type { ProviderChoice } from "./providers";

export interface TaskDef<I, O> {
  kind: string;
  outputSchema: z.ZodType<O, z.ZodTypeDef, unknown>;
  system: string;
  /** Builds the user prompt. MUST mask personal data itself (use maskPii). */
  prompt(input: I): string;
  offline(input: I): O;
  maxTokens?: number;
}

export interface TaskRun<O> {
  output: O;
  provider: string;
  model: string;
}

/** Extracts the first top-level JSON object from a model reply. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in model reply");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("unterminated JSON object in model reply");
}

export async function runTask<I, O>(def: TaskDef<I, O>, input: I, choice: ProviderChoice): Promise<TaskRun<O>> {
  if (!choice.provider) {
    const out = def.outputSchema.parse(def.offline(input));
    return { output: out, provider: choice.label, model: choice.model };
  }
  const system = `${def.system}\n\nReply with ONE JSON object only, no prose, matching the requested fields exactly. Never invent quotations: every quote you cite must be copied verbatim from the provided text.`;
  const prompt = def.prompt(input);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await choice.provider.complete({
      system,
      prompt: attempt === 0 ? prompt : `${prompt}\n\nYour previous reply was invalid (${lastError}). Reply with valid JSON only.`,
      maxTokens: def.maxTokens ?? 1200,
    });
    try {
      const parsed = def.outputSchema.parse(extractJson(res.text));
      return { output: parsed, provider: choice.provider.name, model: res.model };
    } catch (e) {
      lastError = e instanceof Error ? e.message.slice(0, 200) : "parse error";
    }
  }
  throw new Error(`Model returned invalid output twice: ${lastError}`);
}
