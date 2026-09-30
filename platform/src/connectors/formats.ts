import { XMLBuilder, XMLParser } from "fast-xml-parser";
import vm from "node:vm";

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
// Draait gebruikerscode in een aparte V8-context met tijdslimiet. Beschikbaar:
// `input` (kopie van het bericht, ook als `$json`), `env`, `console.log`.
// Let op: node:vm is géén beveiligingsgrens; alleen beheerders mogen code-stappen schrijven.
export async function runCode(code: string, input: Record<string, unknown>, env: string, timeoutMs = 2000): Promise<{ result: Record<string, unknown>; logs: string[] }> {
  const logs: string[] = [];
  const copy = JSON.parse(JSON.stringify(input ?? {}));
  const sandbox: Record<string, unknown> = {
    input: copy,
    $json: copy,
    env,
    console: { log: (...a: unknown[]) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")) },
    JSON, Math, Date, Number, String, Boolean, Array, Object, RegExp, parseInt, parseFloat, isNaN
  };
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: "code-stap.js" });
  const pending = script.runInContext(ctx, { timeout: timeoutMs }) as Promise<unknown>;
  const out = await Promise.race([
    pending,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Code-stap duurde langer dan ${timeoutMs} ms`)), timeoutMs))
  ]);
  const result = out === undefined ? (sandbox.input as Record<string, unknown>) : out;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { result: { ...copy, result: out }, logs };
  }
  // Resultaat terugzetten naar een gewoon object uit de hoofdcontext.
  return { result: JSON.parse(JSON.stringify(result)), logs };
}
