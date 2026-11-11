// Welke REST-operaties een MCP-client via de algemene tool call_api mag aanroepen.
// Alles wat hier niet geblokkeerd is, is meteen bereikbaar, ook nieuwe functionaliteit
// waar (nog) geen eigen MCP-tool voor is. Regels werken op patronen, zodat nieuwe routes
// onder bv. /auth of /admin automatisch geblokkeerd blijven.

export interface PolicyOpts { allowApprovals: boolean; allowDelete: boolean }

const RULES: Array<{ test: (m: string, p: string) => boolean; reason: string; unless?: keyof PolicyOpts }> = [
  { test: (_m, p) => !p.startsWith("/api/v1/"), reason: "geen platform-API (publieke endpoints, GUI of agent-downloads)" },
  { test: (_m, p) => /^\/api\/v1\/(auth|admin|org|oauth|agent-api)(\/|$)/.test(p), reason: "accounts, beheer en aanmelden alleen via de GUI" },
  { test: (_m, p) => p.startsWith("/api/v1/mcp/"), reason: "MCP-informatie zelf" },
  { test: (_m, p) => p === "/api/v1/events", reason: "eventstream (SSE), niet geschikt voor één aanroep" },
  { test: (_m, p) => /\/logo$/.test(p), reason: "afbeelding" },
  { test: (_m, p) => /\/rotate-key$/.test(p), reason: "sleutelbeheer alleen via de GUI" },
  { test: (_m, p) => /^\/api\/v1\/approvals\/[^/]+\/(approve|reject)$/.test(p), reason: "goedkeuren doet een mens (AIP_MCP_ALLOW_APPROVALS=true staat het toe)", unless: "allowApprovals" },
  { test: (m, p) => m === "DELETE" || /\/(purge|clear|cleanup)$/.test(p), reason: "verwijderen/leegmaken (AIP_MCP_ALLOW_DELETE=true staat het toe)", unless: "allowDelete" }
];

// Geeft de reden terug als de operatie geblokkeerd is. `path` mag een sjabloon ({id}) of een echt pad zijn.
export function blockedReason(method: string, path: string, opts: PolicyOpts): string | undefined {
  const m = method.toUpperCase();
  const p = path.split("?")[0];
  for (const r of RULES) if (r.test(m, p) && !(r.unless && opts[r.unless])) return r.reason;
  return undefined;
}

// Zoekt bij een echt pad de OpenAPI-sjabloonroute (/api/v1/runs/abc -> /api/v1/runs/{id}).
export function matchTemplate(path: string, templates: string[]): string | undefined {
  const parts = path.split("?")[0].split("/");
  const fits = (t: string) => {
    const tp = t.split("/");
    return tp.length === parts.length && tp.every((s, i) => s.startsWith("{") || s === parts[i]);
  };
  // Vaste segmenten gaan voor parameters (/integrations/bulk vóór /integrations/{name}).
  return templates.filter(fits).sort((a, b) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0))[0];
}
