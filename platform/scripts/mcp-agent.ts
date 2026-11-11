// MCP-agent: houdt de MCP-server bij met de rest van het platform. Draait na de tests.
// 1. Vergelijkt elke REST-operatie (OpenAPI) met de MCP-tools: eigen tool, via call_api, of bewust geblokkeerd.
// 2. Controleert dat alle staptypes en triggers via MCP te gebruiken zijn (catalogus + schema).
// 3. Roept elke lees-tool aan en bouwt, test, draait en monitort een proces volledig via MCP.
// 4. Schrijft src/mcp/coverage.json en meldt nieuwe functionaliteit sinds de vorige keer.
// Run: npm run mcp:agent            (start zelf een testserver in het geheugen)
//      AIP_URL=http://localhost:3099 npm run mcp:agent   (tegen een draaiende testserver)
//      npm run mcp:agent -- --check  (niets schrijven; faalt als coverage.json verouderd is)

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { blockedReason, matchTemplate } from "../src/mcp/policy";

const ROOT = join(__dirname, "..");
const COVERAGE = join(ROOT, "src", "mcp", "coverage.json");
const CHECK = process.argv.includes("--check");
const PORT = Number(process.env.AIP_MCP_AGENT_PORT || 3097);
let BASE = process.env.AIP_URL?.replace(/\/$/, "") ?? "";
let failures = 0;
const line = (t: string) => console.log(`\n=== ${t} ===`);
function assert(cond: unknown, msg: string, extra?: unknown) {
  console.log(`${cond ? "  ok " : "FAIL"}  ${msg}${!cond && extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(path: string): Promise<any> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// ---------- welke REST-operaties roept elke tool aan (statisch uit server.ts) ----------
function toolOperations(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const starts = [...source.matchAll(/\btool\("([a-z_]+)"/g)];
  starts.forEach((m, i) => {
    const block = source.slice(m.index!, starts[i + 1]?.index ?? source.indexOf("// ---------- resources"));
    const ops: string[] = [];
    for (const call of block.matchAll(/\bapi\("([A-Z]+)",\s*/g)) {
      const path = readPath(block, call.index! + call[0].length);
      if (path) ops.push(`${call[1]} ${path}`);
    }
    out.set(m[1], ops);
  });
  return out;
}
// Leest een string- of template-literal; ${…} tussen slashes wordt {} (parameter), overige expressies (querystring) vallen weg.
function readPath(s: string, i: number): string | undefined {
  const q = s[i];
  if (q === '"') return s.slice(i + 1, s.indexOf('"', i + 1)).split("?")[0];
  if (q !== "`") return undefined;
  let out = "";
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "`") break;
    if (s[j] === "$" && s[j + 1] === "{") {
      let depth = 1, k = j + 2;
      while (k < s.length && depth) { if (s[k] === "{") depth++; else if (s[k] === "}") depth--; else if (s[k] === "`") k = s.indexOf("`", k + 1); k++; }
      if (out.endsWith("/") && (s[k] === "/" || s[k] === "`")) out += "{}";
      j = k - 1;
      continue;
    }
    out += s[j];
  }
  return out.split("?")[0];
}

async function startServer(): Promise<ChildProcess | undefined> {
  if (BASE) return undefined;
  BASE = `http://127.0.0.1:${PORT}`;
  const child = spawn(join(ROOT, "node_modules", ".bin", "tsx"), [join(ROOT, "src", "index.ts")], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, PORT: String(PORT), AIP_STORAGE: "memory", AIP_AUTH: "off", AIP_MCP_TOKEN: "", AIP_MCP_ALLOW_APPROVALS: "", AIP_MCP_ALLOW_DELETE: "" }
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return child; } catch { /* nog niet */ }
    await sleep(500);
  }
  child.kill();
  throw new Error(`Testserver op ${BASE} startte niet`);
}

async function main() {
  const server = await startServer();
  const client = new Client({ name: "aip-mcp-agent", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
      const text = r.content?.[0]?.text ?? "";
      let data: any = text;
      try { data = JSON.parse(text); } catch { /* tekst */ }
      return { error: Boolean(r.isError), data, text };
    };

    line("Tools");
    const tools = (await client.listTools()).tools;
    const names = tools.map((t) => t.name);
    console.log(`  ${names.length} tools`);
    const info = await get("/api/v1/mcp/info");
    assert(JSON.stringify([...info.tools].sort()) === JSON.stringify([...names].sort()), "MCP-pagina toont dezelfde tools als de server");

    line("Dekking REST-API");
    const spec = await get("/openapi.json");
    const ops: Array<{ method: string; path: string; tags: string[] }> = [];
    for (const [path, ms] of Object.entries<any>(spec.paths)) for (const [m, op] of Object.entries<any>(ms)) ops.push({ method: m.toUpperCase(), path, tags: op.tags ?? [] });
    const byTool = toolOperations(readFileSync(join(ROOT, "src", "mcp", "server.ts"), "utf8"));
    const dedicated = new Map<string, string[]>();
    for (const [tool, calls] of byTool) {
      if (!names.includes(tool)) continue; // bv. decide_approval als goedkeuren uit staat
      for (const c of calls) {
        const [m, p] = c.split(" ");
        const same = ops.filter((o) => o.method === m).map((o) => o.path);
        // Strikt (vaste segmenten moeten kloppen); anders mag een variabel segment ook een vast segment zijn
        // (bv. /api/v1/${protocol}/… dekt zowel /ebms/… als /as4/…).
        const strict = matchTemplate(p, same);
        const found = strict ? [strict] : same.filter((t) => { const a = t.split("/"), b = p.split("/"); return a.length === b.length && a.every((x, i) => b[i] === "{}" || x.startsWith("{") || x === b[i]); });
        if (!found.length) { if (p.startsWith("/api/v1/")) assert(false, `tool ${tool} roept onbekende route ${c} aan`); continue; }
        for (const t of found) {
          const k = `${m} ${t}`;
          dedicated.set(k, [...new Set([...(dedicated.get(k) ?? []), tool])]);
        }
      }
    }
    const policy = { allowApprovals: false, allowDelete: false };
    const rows = ops.map((o) => {
      const k = `${o.method} ${o.path}`;
      const via = dedicated.get(k);
      const blocked = via ? undefined : blockedReason(o.method, o.path, policy);
      return { op: k, tags: o.tags, via: via ?? (blocked ? [] : ["call_api"]), ...(blocked ? { blocked } : {}) };
    }).sort((a, b) => a.op.localeCompare(b.op));
    const own = rows.filter((r) => r.via.length && r.via[0] !== "call_api").length;
    const generic = rows.filter((r) => r.via[0] === "call_api").length;
    const blocked = rows.filter((r) => r.blocked).length;
    console.log(`  ${rows.length} operaties: ${own} met eigen tool, ${generic} via call_api, ${blocked} bewust niet via MCP`);
    assert(names.includes("call_api") && names.includes("list_api_operations"), "algemene tools call_api en list_api_operations aanwezig");

    const prev = existsSync(COVERAGE) ? JSON.parse(readFileSync(COVERAGE, "utf8")) : { operations: [], tools: [], stepTypes: [], triggers: [] };
    const prevOps = new Set<string>(prev.operations.map((r: any) => r.op));
    const fresh = rows.filter((r) => !prevOps.has(r.op));
    const gone = [...prevOps].filter((op) => !rows.some((r) => r.op === op));
    // Nieuwe routes zonder eigen tool waar een bouwer of beheerder waarschijnlijk iets mee wil.
    const BUILD_MONITOR = ["integrations", "runs", "monitoring", "triggers", "queues", "datatables", "credentials", "plugins", "catalog", "environments", "apim", "ebms", "as4", "audit", "security", "files", "runtime"];
    const candidates = rows.filter((r) => r.via[0] === "call_api" && r.tags.some((t) => BUILD_MONITOR.includes(t)));

    line("Staptypes en triggers");
    const st = await call("list_step_types");
    assert(!st.error, "list_step_types werkt", st.text);
    const steps: string[] = (st.data.steps ?? st.data.stepTypes ?? []).map((s: any) => s.type);
    const triggers: string[] = (st.data.triggers ?? st.data.triggerTypes ?? []).map((t: any) => t.type);
    assert(steps.length > 0 && triggers.length > 0, `${steps.length} staptypes en ${triggers.length} triggers via MCP`);
    const schema = JSON.stringify(await get("/api/v1/schemas/integration"));
    const missing = [...steps, ...triggers].filter((t) => !schema.includes(`"${t}"`));
    assert(!missing.length, "alle staptypes en triggers staan in het schema (anders weigert save_process ze)", missing);
    const newSteps = steps.filter((s) => !prev.stepTypes.includes(s));
    const newTriggers = triggers.filter((t) => !prev.triggers.includes(t));

    line("Lees-tools aanroepen");
    for (const t of tools) {
      const req: string[] = ((t.inputSchema as any)?.required ?? []);
      if (!/^(list|get)_/.test(t.name)) continue;
      const args: Record<string, unknown> = {};
      if (req.some((r) => r !== "env")) continue; // vraagt een naam/id; komt in de flow hieronder aan bod
      if (req.includes("env")) args.env = "dev";
      const r = await call(t.name, args);
      assert(!r.error, `${t.name}`, r.text);
    }

    line("Bouwen en monitoren via MCP");
    const name = `McpAgent${Date.now().toString(36)}`;
    const def = {
      integration: name, owner: "mcp-agent", description: "Controle door de MCP-agent",
      trigger: { type: "manual" },
      steps: [
        { id: "groet", type: "enrich", config: { set: { groet: "Hallo {{naam}}" } }, position: { x: 200, y: 100 } },
        { id: "datum", type: "datetime", config: { operation: "now", target: "nu" }, position: { x: 400, y: 100 } }
      ],
      connections: [{ from: "start", to: "groet" }, { from: "groet", to: "datum" }]
    };
    const es = await call("execute_step", { type: "enrich", config: { set: { x: "{{a}}" } }, input: { a: 1 } });
    assert(!es.error && es.data.ok !== false, "execute_step voert een losse stap uit", es.text);
    const tr = await call("test_process", { definition: def, input: { naam: "MCP" } });
    assert(!tr.error && tr.data.status === "success" && tr.data.output?.groet === "Hallo MCP", "test_process", tr.text);
    const sv = await call("save_process", { definition: def });
    assert(!sv.error && sv.data.version >= 1, "save_process zet het proces op DEV", sv.text);
    const run = await call("run_process", { name, env: "dev", input: { naam: "Agent" } });
    assert(!run.error, "run_process op DEV", run.text);
    const bad = { ...def, integration: `${name}Fout`, steps: [{ id: "stop", type: "stop", config: { message: "bewuste fout" }, position: { x: 200, y: 100 } }], connections: [{ from: "start", to: "stop" }] };
    await call("save_process", { definition: bad });
    await call("run_process", { name: bad.integration, env: "dev", input: {} });
    const runs = await call("list_runs", { name, env: "dev" });
    assert(!runs.error && runs.data.some((r: any) => r.status === "success"), "list_runs toont de uitvoering", runs.text);
    const errs = await call("list_runs", { status: "error", env: "dev" });
    assert(!errs.error && errs.data.some((r: any) => r.integration === bad.integration) && errs.data.every((r: any) => r.status === "error"), "list_runs filtert op fouten", errs.text);
    if (runs.data?.[0]?.id) {
      const one = await call("get_run", { id: runs.data[0].id });
      assert(!one.error && Array.isArray(one.data.steps), "get_run geeft de stappen", one.text);
    }
    const health = await call("get_process_health", { env: "dev" });
    const hOk = health.data?.find?.((h: any) => h.integration === name);
    const hBad = health.data?.find?.((h: any) => h.integration === bad.integration);
    assert(!health.error && hOk?.successRate === 100 && hBad?.errors === 1 && /bewuste fout/.test(hBad?.lastError?.message ?? ""), "get_process_health: succesratio en laatste fout", health.text);
    const vs = await call("list_versions", { name });
    assert(!vs.error, "list_versions", vs.text);
    const pause = await call("set_trigger", { env: "dev", name, action: "pause" });
    assert(!pause.error, "set_trigger pauzeert", pause.text);
    await call("set_trigger", { env: "dev", name, action: "resume" });

    line("call_api (overige functionaliteit)");
    const lo = await call("list_api_operations", { tag: "ebms" });
    assert(!lo.error && lo.data.length > 0, "list_api_operations vindt operaties per tag", lo.text);
    const ca = await call("call_api", { method: "GET", path: "/api/v1/environments" });
    assert(!ca.error, "call_api GET /api/v1/environments", ca.text);
    const cp = await call("call_api", { method: "GET", path: `/api/v1/integrations/${name}/deployments` });
    assert(!cp.error, "call_api met padparameter", cp.text);
    const del = await call("call_api", { method: "DELETE", path: `/api/v1/integrations/${name}` });
    assert(del.error && /Niet toegestaan/.test(del.text), "call_api weigert verwijderen", del.text);
    const adm = await call("call_api", { method: "GET", path: "/api/v1/admin/overview" });
    assert(adm.error && /Niet toegestaan/.test(adm.text), "call_api weigert beheer-routes", adm.text);
    const appr = await call("call_api", { method: "POST", path: "/api/v1/approvals/x/approve", body: {} });
    assert(appr.error && /Niet toegestaan/.test(appr.text), "call_api weigert goedkeuren", appr.text);

    // ---------- rapport + coverage.json ----------
    line("Rapport");
    const coverage = {
      note: "Gegenereerd door scripts/mcp-agent.ts (npm run mcp:agent). Niet met de hand aanpassen.",
      tools: [...names].sort(),
      stepTypes: [...steps].sort(),
      triggers: [...triggers].sort(),
      operations: rows
    };
    const json = JSON.stringify(coverage, null, 2) + "\n";
    const stale = !existsSync(COVERAGE) || readFileSync(COVERAGE, "utf8") !== json;
    if (fresh.length && prevOps.size) console.log(`  Nieuwe API-operaties sinds vorige keer:\n${fresh.map((r) => `    + ${r.op}  → ${r.blocked ? `niet via MCP (${r.blocked})` : r.via.join(", ")}`).join("\n")}`);
    if (gone.length) console.log(`  Verdwenen operaties:\n${gone.map((op) => `    - ${op}`).join("\n")}`);
    if (prev.stepTypes.length && (newSteps.length || newTriggers.length)) console.log(`  Nieuwe staptypes/triggers (via list_step_types en save_process bruikbaar): ${[...newSteps, ...newTriggers].join(", ")}`);
    const newTools = names.filter((n) => prev.tools.length && !prev.tools.includes(n));
    if (newTools.length) console.log(`  Nieuwe MCP-tools: ${newTools.join(", ")}`);
    console.log(`  Kandidaten voor een eigen tool (bouwen/monitoren, nu via call_api): ${candidates.length}`);
    for (const c of candidates.filter((c) => !prevOps.size || fresh.includes(c)).slice(0, 40)) console.log(`    · ${c.op}`);
    if (CHECK) assert(!stale, "coverage.json is actueel (anders: npm run mcp:agent)");
    else if (stale) { writeFileSync(COVERAGE, json); console.log(`  coverage.json bijgewerkt`); }
    else console.log("  coverage.json was al actueel");
  } finally {
    await client.close().catch(() => undefined);
    server?.kill();
  }
  console.log(`\n${failures ? `${failures} FOUT(EN)` : "MCP-server is up-to-date"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
