// Gedeelde hulpfuncties voor stappen en triggers.

// Waarde ophalen via een dot-path (a.b.c of a.0.b). "$json." wordt genegeerd.
export function getPath(obj: unknown, path: string): unknown {
  const p = path.trim().replace(/^\$json\.?/, "").replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
  if (!p) return obj;
  return p.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const out = { ...obj };
  const keys = path.split(".");
  let cur: Record<string, unknown> = out;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else {
      cur[k] = cur[k] && typeof cur[k] === "object" ? { ...(cur[k] as object) } : {};
      cur = cur[k] as Record<string, unknown>;
    }
  });
  return out;
}

// Template: "order-{{orderId}}.json" -> "order-A1.json". Objecten worden JSON.
// Speciale waarden: {{$now}} (ISO-tijd), {{$date}} (JJJJ-MM-DD), {{$env}}, {{$uuid}}.
export function tpl(str: unknown, data: unknown, env = "dev"): string {
  if (typeof str !== "string") return str == null ? "" : String(str);
  return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
    if (expr === "$now") return new Date().toISOString();
    if (expr === "$date") return new Date().toISOString().slice(0, 10);
    if (expr === "$env") return env;
    if (expr === "$uuid") return crypto.randomUUID();
    const v = getPath(data, expr);
    if (v === undefined || v === null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

// Template toepassen op alle strings in een object. Een string die volledig één
// {{expressie}} is, behoudt het type van de waarde (getal, object).
export function deepTpl(value: unknown, data: unknown, env = "dev"): unknown {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (whole && !whole[1].startsWith("$")) return getPath(data, whole[1]);
    return tpl(value, data, env);
  }
  if (Array.isArray(value)) return value.map((v) => deepTpl(v, data, env));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepTpl(v, data, env)]));
  return value;
}

// Bestandspatroon (*.csv, order-??.json) naar RegExp.
export function globToRegex(glob: string): RegExp {
  const esc = (glob || "*").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`, "i");
}

// Inhoud van een bestand interpreteren.
export function parseContent(text: string, format: string | undefined, csvParse: (t: string) => unknown): unknown {
  if (format === "json") return JSON.parse(text);
  if (format === "csv") return csvParse(text);
  return text;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
