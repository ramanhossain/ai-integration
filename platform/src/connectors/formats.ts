import { XMLBuilder, XMLParser } from "fast-xml-parser";

// ---------- CSV ----------
// RFC 4180-achtig: velden tussen dubbele quotes mogen scheidingstekens, quotes ("") en regeleinden bevatten.
export function csvParse(text: string, opts: { delimiter?: string; header?: boolean } = {}): Array<Record<string, string>> | string[][] {
  const d = opts.delimiter || ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (opts.header === false) return rows;
  const [head, ...rest] = rows;
  if (!head) return [];
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
}

export function csvGenerate(records: unknown, opts: { delimiter?: string; header?: boolean } = {}): string {
  const d = opts.delimiter || ",";
  const list = Array.isArray(records) ? records : [records];
  if (!list.length) return "";
  const cell = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /["\n\r]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  if (Array.isArray(list[0])) return (list as unknown[][]).map((r) => r.map(cell).join(d)).join("\n");
  const cols = [...new Set(list.flatMap((r) => Object.keys((r as object) ?? {})))];
  const lines = list.map((r) => cols.map((c) => cell((r as Record<string, unknown>)[c])).join(d));
  return (opts.header === false ? lines : [cols.map(cell).join(d), ...lines]).join("\n");
}

// ---------- XML ----------
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: true, trimValues: true });
const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@", format: true, suppressEmptyNode: true });
export function xmlParse(text: string): unknown {
  return parser.parse(text);
}
export function xmlBuild(obj: unknown, root?: string): string {
  const data = root ? { [root]: obj } : obj;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(data)}`;
}

// ---------- Code (JavaScript) ----------
// Gebruikerscode draait in een eigen V8-isolate (isolated-vm): geen toegang tot Node,
// het bestandssysteem, het netwerk of de gegevens van andere organisaties; met
// geheugen- en tijdslimiet. Alleen JSON gaat erin en eruit. Beschikbaar in de code:
// `input` (kopie van het bericht, ook als `$json`), `env` en `console.log`.
// (node:vm is géén beveiligingsgrens en wordt daarom niet gebruikt.)
const CODE_MEMORY_MB = Number(process.env.AIP_CODE_MEMORY_MB || 64);
export async function runCode(code: string, input: Record<string, unknown>, env: string, timeoutMs = 2000): Promise<{ result: Record<string, unknown>; logs: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ivm = require("isolated-vm") as typeof import("isolated-vm");
  const isolate = new ivm.Isolate({ memoryLimit: CODE_MEMORY_MB });
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set("__in", JSON.stringify(input ?? {}));
    await jail.set("__env", String(env));
    const wrapped = `(async () => {
      const __logs = [];
      const console = { log: (...a) => { if (__logs.length < 200) __logs.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ").slice(0, 2000)); } };
      const input = JSON.parse(__in); const $json = input; const env = __env;
      const __out = await (async () => {\n${code}\n})();
      const result = __out === undefined ? input : __out;
      return JSON.stringify({ result, logs: __logs });
    })()`;
    const script = await isolate.compileScript(wrapped, { filename: "code-stap.js" });
    const raw = await Promise.race([
      script.run(context, { timeout: timeoutMs, promise: true, copy: true }) as Promise<string>,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Code-stap duurde langer dan ${timeoutMs} ms`)), timeoutMs + 50))
    ]);
    const parsed = JSON.parse(String(raw ?? "{}")) as { result: unknown; logs: string[] };
    const out = parsed.result;
    if (!out || typeof out !== "object" || Array.isArray(out)) return { result: { ...JSON.parse(JSON.stringify(input ?? {})), result: out }, logs: parsed.logs || [] };
    return { result: out as Record<string, unknown>, logs: parsed.logs || [] };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (/timed out/i.test(msg)) throw new Error(`Code-stap duurde langer dan ${timeoutMs} ms`);
    if (/memory limit/i.test(msg) || isolate.isDisposed) throw new Error(`Code-stap gebruikte meer dan ${CODE_MEMORY_MB} MB geheugen`);
    throw err;
  } finally {
    if (!isolate.isDisposed) isolate.dispose();
  }
}
