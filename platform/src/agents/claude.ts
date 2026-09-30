// Lichte Claude-client (via fetch, geen SDK-dependency). Als ANTHROPIC_API_KEY
// ontbreekt is de agent nog steeds bruikbaar: elke agent heeft een deterministische
// fallback. Zo draait het platform zonder key, en wordt het slimmer mét key.

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export function claudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface ClaudeJsonOptions {
  system: string;
  user: string;
  maxTokens?: number;
}

// Vraagt Claude om puur JSON en parseert dat. Gooit als er geen key is of parsing faalt;
// de aanroeper vangt dit op en gebruikt zijn fallback.
export async function claudeJson<T>(opts: ClaudeJsonOptions): Promise<T> {
  if (!claudeAvailable()) throw new Error("ANTHROPIC_API_KEY ontbreekt");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system + "\nAntwoord uitsluitend met geldige JSON, zonder toelichting of code fences.",
      messages: [{ role: "user", content: opts.user }]
    })
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = data.content.map((c) => c.text ?? "").join("").trim();
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned) as T;
}

export const claudeMeta = { model: MODEL };
