// Pagina-adviseur: de AI-assistent "leest" de pagina die de gebruiker bekijkt
// (tekst van de pagina + de echte platformdata erachter) en geeft een samenvatting,
// aandachtspunten en advies. Met ANTHROPIC_API_KEY doet Claude dit; zonder key
// gebruikt de adviseur deterministische regels per pagina.

import type { Integration } from "../domain/types";
import { ENVIRONMENTS, isEnv, type EnvName } from "../domain/environments";
import { engine, type Run } from "../engine/engine";
import { registry } from "../domain/registry";
import { deployments } from "../domain/deployments";
import { approvals } from "../approval/approvalEngine";
import { settings } from "../domain/settings";
import { audit } from "../audit/auditLog";
import { triggers } from "../triggers/manager";
import { credentials } from "../connectors/credentials";
import { datatables } from "../connectors/datatables";
import { broker } from "../connectors/queue";
import { claudeAvailable, claudeJson } from "./claude";
import { agentGroups } from "../runtime/agentGroups";

export interface PageContext {
  view: string;
  param?: string;
  env?: string;
  title?: string;
  text?: string; // zichtbare tekst van de pagina
  definition?: Integration; // editor: de canvas zoals hij nu is (ook niet-opgeslagen)
  dirty?: boolean;
  question?: string;
  user?: string;
  lang?: string; // "nl" of "en": taal van het antwoord
}
export type Level = "risk" | "warn" | "info" | "ok";
export interface Finding { level: Level; title: string; detail?: string; go?: string; goLabel?: string }
export interface PageAdvice { page: string; summary: string; findings: Finding[]; answer?: string; suggestions: string[]; by: "claude" | "heuristiek" }

const PAGE_NAMES: Record<string, string> = {
  dashboard: "Dashboard", instances: "Procesinstanties", instance: "Procesinstantie", incidents: "Incidenten", processes: "Processen",
  editor: "Proceseditor", infra: "Infrastructuur", datatables: "Datatabellen", queues: "Queues", files: "Bestanden", environments: "Omgevingen", triggers: "Actieve triggers",
  credentials: "Koppelingen", approvals: "Goedkeuringen", audit: "Audit log", mcp: "MCP-server", settings: "Instellingen"
};
const PAGE_ABOUT: Record<string, string> = {
  dashboard: "Het dashboard toont per omgeving hoeveel processen er draaiden, de succesratio, fouten, dead-letters, openstaande goedkeuringen en incidenten.",
  instances: "Procesinstanties zijn alle uitvoeringen van processen, met status, versie, wie of wat ze startte en hoeveel stappen slaagden.",
  instance: "Dit is één uitvoering: het gevolgde pad over het proces, en per stap de input, output of fout.",
  incidents: "Incidenten zijn gemelde problemen; de Recovery Agent stelt een herstelactie voor die via goedkeuring loopt.",
  processes: "Hier staan alle processen met de versie per omgeving (DEV → TEST → ACC → PROD) en de knoppen om te deployen of uit te voeren.",
  editor: "In de proceseditor bouw je het proces als BPMN-model: startevent met trigger, taken, beslissingen en eindevent. Opslaan maakt een nieuwe versie op DEV.",
  datatables: "Datatabellen zijn ingebouwde tabellen per omgeving om gegevens tijdelijk of blijvend op te slaan.",
  queues: "Queues bufferen berichten per omgeving; processen kunnen erop publiceren of er door gestart worden. Mislukte berichten gaan naar de dead-letter queue (.dlq).",
  files: "De bestandsmap per omgeving, gebruikt door de map-trigger en de stap Bestand.",
  infra: "Infrastructuur toont per omgeving de omgevingsvarianten (agentgroepen): de ingebouwde groep Platform en groepen in bijvoorbeeld AWS of Azure waar een agent draait. Per proces kies je op welke varianten het draait, met failover of op alle tegelijk.",
  environments: "De promotiepijplijn: welke versie van elk proces op DEV, TEST, ACC en PROD staat.",
  triggers: "Alle actieve triggers per omgeving: webhooks, API-endpoints, schema's, queues, mappen en FTP, met status en laatste uitvoering.",
  credentials: "Koppelingen bewaren verbindingsgegevens (versleuteld) met per omgeving andere waarden. Geheimen worden nooit getoond.",
  approvals: "Goedkeuringen: acties met risico (deploys, PROD-uitvoeringen, herstel) wachten hier op een mens.",
  audit: "Het audit log is een onveranderbare hash-keten van alle acties op het platform.",
  mcp: "De MCP-server laat MCP-clients (Claude Code/Desktop) het platform bedienen via tools.",
  settings: "Platforminstellingen, zoals het vier-ogenprincipe bij goedkeuringen."
};

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- proces-lint
function reachable(def: Integration): Set<string> {
  const seen = new Set<string>();
  const conns = def.connections || [];
  const queue = conns.filter((c) => c.from === "start").map((c) => c.to);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of conns) if (c.from === id) queue.push(c.to);
  }
  return seen;
}

export function lintProcess(def: Integration, opts: { dirty?: boolean } = {}): Finding[] {
  const f: Finding[] = [];
  const steps = def.steps || [];
  const trig = (def.trigger || { type: "manual" }) as Record<string, unknown> & { type: string };
  const real = steps.filter((s) => s.type !== "end");
  const name = def.integration;
  if (opts.dirty) f.push({ level: "info", title: "Niet-opgeslagen wijzigingen", detail: "Sla het proces op om een nieuwe versie op DEV te maken; pas daarna kun je het deployen." });
  if (!real.length) { f.push({ level: "info", title: "Het proces heeft nog geen taken", detail: "Voeg taken toe via de gereedschapsbalk of vraag de assistent, bijv. “haal orders op en stuur ze naar het ERP”." }); return f; }

  // Trigger
  const inbound = ["webhook", "api"].includes(trig.type);
  if (inbound && (!trig.auth || trig.auth === "none")) f.push({ level: "risk", title: `${trig.type === "api" ? "API-endpoint" : "Webhook"} zonder authenticatie`, detail: "Iedereen die de URL kent kan dit proces starten. Zet authenticatie op API-key met een koppeling (per omgeving een andere sleutel)." });
  const first = (def.connections || []).filter((c) => c.from === "start").map((c) => steps.find((s) => s.id === c.to)).filter(Boolean);
  if ((inbound || ["queue", "file", "ftp"].includes(trig.type)) && !first.some((s) => s!.type === "validate")) f.push({ level: "warn", title: "Inkomende berichten worden niet eerst gevalideerd", detail: "Zet een Validatie-stap direct na het startevent met de verplichte velden, zodat foute berichten vroeg en duidelijk falen." });
  if (["webhook", "queue", "file", "ftp", "api"].includes(trig.type) && !steps.some((s) => s.type === "duplicate-check") && steps.some((s) => ["http", "sql", "email", "datatable", "queue"].includes(s.type))) f.push({ level: "info", title: "Geen duplicaatcheck", detail: "Bij herhaalde aanlevering (retries van de bron) kan hetzelfde bericht twee keer verwerkt worden. Overweeg een Duplicaatcheck op een uniek veld (bijv. orderId)." });
  if (trig.type === "schedule" && Number(trig.everySeconds) > 0 && Number(trig.everySeconds) < 30) f.push({ level: "warn", title: "Schema draait erg vaak", detail: `Elke ${trig.everySeconds} seconden. Controleer of de bron dit aankan; vaak is elke minuut of een queue/webhook beter.` });

  // Stappen
  for (const s of steps) {
    const c = (s.config || {}) as Record<string, unknown>;
    const label = `“${s.name || s.id}”`;
    if (["sql"].includes(s.type) && !c.credential) f.push({ level: "risk", title: `${label}: geen koppeling`, detail: "Een SQL-stap heeft een database-koppeling nodig." });
    if (s.type === "email" && !c.credential) f.push({ level: "info", title: `${label}: e-mail wordt gesimuleerd`, detail: "Zonder SMTP-koppeling wordt de e-mail niet echt verstuurd. Kies een koppeling voor TEST/ACC/PROD." });
    if (s.type === "http" && typeof c.url === "string" && /^http:\/\//.test(c.url) && !/localhost|127\.0\.0\.1/.test(c.url)) f.push({ level: "warn", title: `${label}: onversleuteld HTTP`, detail: `${c.url} gebruikt http://. Gebruik https:// voor verkeer buiten het eigen netwerk.` });
    if (typeof c.credential === "string" && c.credential) {
      const cred = credentials.get(c.credential);
      if (!cred) f.push({ level: "risk", title: `${label}: koppeling ${c.credential} bestaat niet`, detail: "Maak de koppeling aan onder Beheer → Koppelingen, of kies een bestaande.", go: "credentials", goLabel: "Naar koppelingen" });
      else {
        const st = deployments.listStates().find((x) => x.integration === name);
        const deployedEnvs = st ? ENVIRONMENTS.filter((e) => st.envs[e] != null) : ["dev" as EnvName];
        const lacking = deployedEnvs.filter((e) => !cred.envs.includes(e));
        if (lacking.length) f.push({ level: "warn", title: `${label}: koppeling ${c.credential} heeft geen waarden voor ${lacking.map((e) => e.toUpperCase()).join(", ")}`, go: "credentials", goLabel: "Naar koppelingen" });
      }
    }
    if (s.type === "subprocess" && c.process && !registry.getIntegration(String(c.process))) f.push({ level: "risk", title: `${label}: subproces ${c.process} bestaat niet` });
    if (s.type === "datatable" && c.table && !datatables.list("dev").some((t) => t.name === c.table)) f.push({ level: "warn", title: `${label}: datatabel ${c.table} bestaat niet op DEV`, go: "datatables", goLabel: "Naar datatabellen" });
    if (s.type === "code") f.push({ level: "info", title: `${label}: eigen code`, detail: "Code-stappen zijn krachtig maar lastiger te onderhouden en te reviewen. Gebruik waar het kan Transformatie of Velden instellen." });
    if ((s as { disabled?: boolean }).disabled) f.push({ level: "warn", title: `${label} is gedeactiveerd`, detail: "Deze stap wordt overgeslagen, ook na deployen. Activeer hem of verwijder hem voor je naar TEST gaat." });
    if ((s as { pinData?: unknown }).pinData !== undefined) f.push({ level: "info", title: `${label} heeft vastgezette testdata`, detail: "Wordt alleen in testruns gebruikt; in echte uitvoeringen draait de stap gewoon." });
    if (s.type === "decision") {
      const ports = new Set((def.connections || []).filter((x) => x.from === s.id).map((x) => x.port));
      if (!ports.has("true") || !ports.has("false")) f.push({ level: "warn", title: `${label}: beslissing heeft maar één uitgang`, detail: "Verbind zowel het ja- als het nee-pad, anders stopt het proces stil bij de andere uitkomst." });
    }
  }
  const reach = reachable(def);
  const loose = steps.filter((s) => !reach.has(s.id));
  if (loose.length) f.push({ level: "warn", title: `${plural(loose.length, "element is", "elementen zijn")} niet bereikbaar vanaf het startevent`, detail: loose.map((s) => s.name || s.id).join(", ") });
  const deadEnds = real.filter((s) => reach.has(s.id) && !(def.connections || []).some((c) => c.from === s.id));
  if (deadEnds.length && steps.some((s) => s.type === "end")) f.push({ level: "info", title: "Paden zonder eindevent", detail: `${deadEnds.map((s) => s.name || s.id).join(", ")} ${deadEnds.length === 1 ? "heeft" : "hebben"} geen uitgaande verbinding. Verbind ${deadEnds.length === 1 ? "hem" : "ze"} met een eindevent voor een duidelijk model.` });

  const retry = (def as { retry?: { attempts?: number; onExhaust?: string } }).retry;
  if (!retry || !retry.attempts) f.push({ level: "info", title: "Geen retry ingesteld", detail: "Tijdelijke fouten (time-outs, 503) leiden direct tot een mislukte uitvoering. Stel bijv. 3 pogingen met exponential backoff in." });
  else if (retry.onExhaust !== "dead-letter-queue") f.push({ level: "info", title: "Mislukte berichten gaan niet naar een dead-letter queue", detail: "Met dead-letter kun je mislukte berichten later opnieuw aanbieden." });

  // Uitvoeringen en deployments
  const runs = engine.list({ integration: name, limit: 50 });
  const failed = runs.filter((r) => r.status === "error");
  if (failed.length) {
    const last = failed[0];
    const step = last.steps.find((s) => s.status === "failed");
    f.push({ level: failed.length > runs.length / 2 ? "risk" : "warn", title: `${plural(failed.length, "mislukte uitvoering", "mislukte uitvoeringen")} van de laatste ${runs.length}`, detail: `Laatste fout op ${last.env.toUpperCase()}${step ? ` in stap ${step.id}` : ""}: ${last.error || step?.error || "onbekend"}`, go: `instance/${last.id}`, goLabel: "Bekijk uitvoering" });
  }
  const st = deployments.listStates().find((x) => x.integration === name);
  if (st) {
    const behind = ENVIRONMENTS.filter((e) => e !== "dev" && st.envs[e] != null && st.envs[e]! < (st.envs.dev ?? 0));
    if (behind.length) f.push({ level: "info", title: `DEV (v${st.envs.dev}) loopt voor op ${behind.map((e) => `${e.toUpperCase()} v${st.envs[e]}`).join(", ")}`, detail: "Test de nieuwe versie en promoveer hem stap voor stap." });
    if (st.envs.test == null && runs.some((r) => r.env === "dev" && r.status === "success")) f.push({ level: "info", title: "Nog niet op TEST", detail: "Het proces werkt op DEV. Deploy het naar TEST voor een ketentest." });
  }
  return f;
}

// ---------------------------------------------------------------- run-diagnose
function diagnoseRun(run: Run): Finding[] {
  const f: Finding[] = [];
  if (run.status === "success") {
    f.push({ level: "ok", title: `Geslaagd in ${run.durationMs} ms`, detail: `${run.steps.filter((s) => s.status === "ok").length} stappen uitgevoerd op ${run.env.toUpperCase()}.` });
    const slow = [...run.steps].sort((a, b) => b.ms - a.ms)[0];
    if (slow && slow.ms > 1000) f.push({ level: "info", title: `Traagste stap: ${slow.id} (${slow.ms} ms)`, detail: "Bij veel volume kan dit een knelpunt worden; kijk naar time-outs of batching." });
    return f;
  }
  const step = run.steps.find((s) => s.status === "failed");
  const err = String(run.error || step?.error || "");
  f.push({ level: "risk", title: `Mislukt${step ? ` in stap ${step.id} (${step.type})` : ""}`, detail: err || "Geen foutmelding vastgelegd." });
  const hint = (t: string, d: string) => f.push({ level: "info", title: t, detail: d });
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(err)) hint("Het doelsysteem is niet bereikbaar", "Controleer de URL/host, of het systeem draait en of het vanaf deze omgeving bereikbaar is (firewall, DNS).");
  else if (/timeout|timed out|ETIMEDOUT/i.test(err)) hint("Time-out", "Het doelsysteem reageert te traag. Verhoog de time-out of werk asynchroon via een queue; retry vangt incidentele time-outs op.");
  else if (/\b(401|403)\b|unauthor|forbidden|auth/i.test(err)) hint("Autorisatie geweigerd", `Controleer de koppeling (sleutel/wachtwoord) voor ${run.env.toUpperCase()} onder Beheer → Koppelingen.`);
  else if (/\b404\b|not found|niet gevonden/i.test(err)) hint("Niet gevonden", "Het pad of de resource bestaat niet. Controleer de URL, tabel, queue of het subproces in de stapconfiguratie.");
  else if (/\b5\d\d\b/.test(err)) hint("Fout aan de kant van het doelsysteem", "Een 5xx-fout is meestal tijdelijk; retry met backoff helpt. Blijft het, neem contact op met de beheerder van dat systeem.");
  else if (/ontbre[ek]|verplicht|required|missing/i.test(err)) hint("Invoer onvolledig", "Het binnenkomende bericht mist verplichte velden. Controleer de bron of pas de validatie aan.");
  else if (/duplica/i.test(err)) hint("Duplicaat tegengehouden", "Dit bericht was al verwerkt. Dat is meestal gewenst gedrag.");
  if (run.deadLettered) f.push({ level: "warn", title: "Bericht staat in de dead-letter queue", detail: "Los de oorzaak op en bied het bericht opnieuw aan via Queues → dead-letter.", go: "queues", goLabel: "Naar queues" });
  if (step && step.attempts > 1) f.push({ level: "info", title: `${step.attempts} pogingen gedaan`, detail: "De retry is uitgeput; de fout is dus niet tijdelijk." });
  return f;
}

// ---------------------------------------------------------------- per pagina
function heuristic(ctx: PageContext, env: EnvName): { summary: string; findings: Finding[] } {
  const f: Finding[] = [];
  const E = env.toUpperCase();
  switch (ctx.view) {
    case "dashboard": {
      const m = engine.metrics(env);
      const pend = approvals.list({ status: "pending" });
      const inc = registry.listIncidents();
      if (!m.totalRuns) f.push({ level: "info", title: `Nog geen uitvoeringen op ${E}`, detail: "Deploy een proces naar deze omgeving of voer er een uit om monitoringgegevens te zien.", go: "processes", goLabel: "Naar processen" });
      else if (m.successRate < 90) f.push({ level: "risk", title: `Succesratio ${m.successRate}% op ${E}`, detail: `${m.error} van ${m.totalRuns} uitvoeringen mislukten.`, go: `instances/${env}`, goLabel: "Bekijk instanties" });
      else if (m.successRate < 99) f.push({ level: "warn", title: `Succesratio ${m.successRate}%`, detail: `${m.error} mislukte uitvoeringen van ${m.totalRuns}.`, go: `instances/${env}`, goLabel: "Bekijk instanties" });
      else f.push({ level: "ok", title: `Succesratio ${m.successRate}% over ${m.totalRuns} uitvoeringen` });
      const byProc = new Map<string, number>();
      for (const r of engine.list({ env, limit: 500 })) if (r.status === "error") byProc.set(r.integration, (byProc.get(r.integration) || 0) + 1);
      const worst = [...byProc.entries()].sort((a, b) => b[1] - a[1])[0];
      if (worst) f.push({ level: "warn", title: `Meeste fouten: ${worst[0]} (${worst[1]}×)`, detail: m.recentErrors.find((e) => e.integration === worst[0])?.error, go: `editor/${encodeURIComponent(worst[0])}`, goLabel: "Open proces" });
      if (m.deadLettered) f.push({ level: "warn", title: `${plural(m.deadLettered, "bericht", "berichten")} in dead-letter`, detail: "Deze berichten zijn niet verwerkt. Los de oorzaak op en bied ze opnieuw aan.", go: "queues", goLabel: "Naar queues" });
      if (pend.length) f.push({ level: pend.some((a) => a.riskLevel === "red") ? "warn" : "info", title: `${plural(pend.length, "goedkeuring staat", "goedkeuringen staan")} open`, detail: pend.slice(0, 3).map((a) => `${a.action.type} ${a.action.target?.integration ?? ""}`).join(" · "), go: "approvals", goLabel: "Naar goedkeuringen" });
      if (inc.length) f.push({ level: "warn", title: `${plural(inc.length, "incident", "incidenten")} gemeld`, go: "incidents", goLabel: "Naar incidenten" });
      const trg = triggers.list("").filter((t) => t.env === env && t.errors > 0);
      if (trg.length) f.push({ level: "warn", title: `${plural(trg.length, "trigger heeft", "triggers hebben")} fouten`, detail: trg.map((t) => `${t.integration}: ${t.errors}×`).join(" · "), go: "triggers", goLabel: "Naar triggers" });
      return { summary: m.totalRuns ? `${E}: ${m.totalRuns} uitvoeringen, ${m.successRate}% geslaagd, gemiddeld ${m.avgDurationMs} ms.` : `${E} heeft nog geen uitvoeringen.`, findings: f };
    }
    case "processes":
    case "environments": {
      const list = registry.listIntegrations();
      const states = deployments.listStates();
      const onlyDev = states.filter((s) => ENVIRONMENTS.every((e) => e === "dev" || s.envs[e] == null));
      const onProd = states.filter((s) => s.envs.prod != null);
      if (!list.length) f.push({ level: "info", title: "Nog geen processen", detail: "Maak er een met “+ Nieuw proces”, importeer een export, of beschrijf de integratie aan de assistent." });
      if (onlyDev.length) f.push({ level: "info", title: `${plural(onlyDev.length, "proces staat", "processen staan")} alleen op DEV`, detail: onlyDev.slice(0, 6).map((s) => s.integration).join(", ") + (onlyDev.length > 6 ? " …" : "") });
      const ahead = states.filter((s) => s.envs.prod != null && (s.envs.dev ?? 0) > s.envs.prod!);
      if (ahead.length) f.push({ level: "info", title: `${plural(ahead.length, "proces heeft", "processen hebben")} een nieuwere versie dan op PROD`, detail: ahead.map((s) => `${s.integration} (DEV v${s.envs.dev}, PROD v${s.envs.prod})`).join(", ") });
      const failing = list.map((i) => ({ i, runs: engine.list({ integration: i.integration, env, limit: 20 }) })).filter((x) => x.runs.length && x.runs[0].status === "error");
      for (const x of failing.slice(0, 4)) f.push({ level: "warn", title: `${x.i.integration}: laatste uitvoering op ${E} mislukte`, detail: x.runs[0].error, go: `instance/${x.runs[0].id}`, goLabel: "Bekijk" });
      const risky = list.filter((i) => ["webhook", "api"].includes(i.trigger?.type) && (!(i.trigger as { auth?: string }).auth || (i.trigger as { auth?: string }).auth === "none"));
      if (risky.length) f.push({ level: "risk", title: `${plural(risky.length, "proces heeft", "processen hebben")} een endpoint zonder authenticatie`, detail: risky.map((i) => i.integration).join(", ") });
      const noDesc = list.filter((i) => !i.description);
      if (noDesc.length && list.length) f.push({ level: "info", title: `${plural(noDesc.length, "proces heeft", "processen hebben")} geen beschrijving`, detail: "Een korte beschrijving helpt beheerders en agents te begrijpen wat het proces doet." });
      if (!f.length) f.push({ level: "ok", title: "Geen aandachtspunten gevonden" });
      return { summary: `${plural(list.length, "proces", "processen")}; ${onProd.length} op PROD, ${onlyDev.length} alleen op DEV.`, findings: f };
    }
    case "editor": {
      const def = ctx.definition || (ctx.param && ctx.param !== "new" ? registry.getIntegration(ctx.param) : undefined);
      if (!def) return { summary: "Geen proces geopend.", findings: [] };
      const lint = lintProcess(def, { dirty: ctx.dirty });
      const n = (def.steps || []).filter((s) => s.type !== "end").length;
      if (!lint.some((x) => x.level === "risk" || x.level === "warn")) lint.push({ level: "ok", title: "Geen risico's of waarschuwingen gevonden" });
      return { summary: `${def.integration}: ${plural(n, "taak", "taken")}, trigger ${def.trigger?.type ?? "manual"}. ${plural(lint.filter((x) => x.level === "risk" || x.level === "warn").length, "aandachtspunt", "aandachtspunten")}.`, findings: lint };
    }
    case "instance": {
      const run = ctx.param ? engine.get(ctx.param) : undefined;
      if (!run) return { summary: "Uitvoering niet gevonden.", findings: [] };
      return { summary: `${run.integration} op ${run.env.toUpperCase()} (${run.test ? "test" : `v${run.version}`}): ${run.status === "success" ? "geslaagd" : "mislukt"}.`, findings: diagnoseRun(run) };
    }
    case "instances": {
      const e = ctx.param && isEnv(ctx.param) ? ctx.param : undefined;
      const runs = engine.list({ env: e, limit: 200 });
      const failed = runs.filter((r) => r.status === "error");
      const errs = new Map<string, number>();
      for (const r of failed) { const k = `${r.integration}: ${String(r.error || "").slice(0, 90)}`; errs.set(k, (errs.get(k) || 0) + 1); }
      for (const [k, n] of [...errs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) f.push({ level: n > 2 ? "warn" : "info", title: `${n}× ${k}` });
      if (failed[0]) f.push(...diagnoseRun(failed[0]).slice(1).map((x) => ({ ...x, title: `Laatste fout — ${x.title}` })));
      if (!failed.length && runs.length) f.push({ level: "ok", title: "Geen mislukte uitvoeringen in deze lijst" });
      return { summary: `${runs.length} uitvoeringen${e ? ` op ${e.toUpperCase()}` : ""}, ${pct(runs.length - failed.length, runs.length)}% geslaagd.`, findings: f };
    }
    case "approvals": {
      const pend = approvals.list({ status: "pending" });
      const four = settings.get().fourEyes;
      for (const a of pend.slice(0, 6)) f.push({ level: a.riskLevel === "red" ? "warn" : "info", title: `${a.action.type} — ${a.action.target?.integration ?? ""}${a.action.target?.environment ? ` (${String(a.action.target.environment).toUpperCase()})` : ""}`, detail: `Voorgesteld door ${a.action.proposedBy}; ${a.approvals.filter((x) => x.decision === "approve").length}/${a.requiredApprovals} goedkeuringen. ${a.action.proposedBy === ctx.user ? "Je kunt je eigen voorstel niet goedkeuren." : ""}`.trim() });
      if (!four) f.push({ level: "warn", title: "Vier-ogenprincipe staat uit", detail: "PROD-acties hebben dan maar één goedkeuring nodig. Zet het aan onder Instellingen als je organisatie dat vereist.", go: "settings", goLabel: "Naar instellingen" });
      if (!pend.length) f.push({ level: "ok", title: "Geen openstaande goedkeuringen" });
      return { summary: `${plural(pend.length, "goedkeuring staat", "goedkeuringen staan")} open; vier-ogen ${four ? "aan" : "uit"}.`, findings: f };
    }
    case "infra": {
      const groups = agentGroups.list();
      const remote = groups.filter((g) => !g.builtin);
      for (const g of remote) {
        const procs = agentGroups.processesOn(g.id);
        const online = g.agents.filter((a) => agentGroups.isOnline(a)).length;
        if (!g.agents.length) f.push({ level: procs.length ? "risk" : "info", title: `${g.name} (${g.env.toUpperCase()}): nog geen agent verbonden`, detail: procs.length ? `${procs.join(", ")} ${procs.length === 1 ? "draait" : "draaien"} hier, maar er is geen agent. Installeer de agent via “Agent installeren”.` : "Installeer de agent via “Agent installeren”." });
        else if (!online) f.push({ level: procs.length ? "risk" : "warn", title: `${g.name} (${g.env.toUpperCase()}): alle agents offline`, detail: `Laatst gezien: ${g.agents[0].lastSeen}. Controleer de server of container en de verbinding naar het portaal.` });
        else if (online === 1 && g.env === "prod" && procs.length) f.push({ level: "info", title: `${g.name}: één agent`, detail: "Draai minstens twee agents in een productievariant, zodat onderhoud of uitval geen stilstand geeft." });
        const versions = new Set(g.agents.map((a) => a.version).filter(Boolean));
        if (versions.size > 1) f.push({ level: "info", title: `${g.name}: agents met verschillende versies`, detail: [...versions].join(", ") });
      }
      const prodRemote = remote.filter((g) => g.env === "prod");
      if (!prodRemote.length) f.push({ level: "info", title: "PROD draait alleen op het platform", detail: "Voeg een omgevingsvariant toe (bijv. AWS en Azure) om processen dicht bij je systemen of in twee clouds te laten draaien." });
      if (!f.some((x) => x.level === "risk" || x.level === "warn")) f.push({ level: "ok", title: "Alle varianten met processen hebben een agent online" });
      const online = remote.reduce((n, g) => n + g.agents.filter((a) => agentGroups.isOnline(a)).length, 0);
      return { summary: `${plural(groups.length, "omgevingsvariant", "omgevingsvarianten")}, waarvan ${remote.length} extern; ${plural(online, "agent", "agents")} online.`, findings: f };
    }
    case "triggers": {
      const list = triggers.list("").filter((t) => t.env === env);
      for (const t of list) {
        const cfg = t.config as { auth?: string };
        if ((t.type === "webhook" || t.type === "api") && (!cfg.auth || cfg.auth === "none")) f.push({ level: env === "prod" ? "risk" : "warn", title: `${t.integration}: ${t.type} zonder authenticatie`, detail: t.url });
        if (t.paused) f.push({ level: "info", title: `${t.integration}: gepauzeerd`, detail: "Er worden geen nieuwe uitvoeringen gestart tot je hem hervat." });
        if (t.errors) f.push({ level: "warn", title: `${t.integration}: ${t.errors} van ${t.fires} keer mislukt`, detail: t.lastError, go: t.lastRunId ? `instance/${t.lastRunId}` : undefined, goLabel: "Laatste uitvoering" });
      }
      if (!list.length) f.push({ level: "info", title: `Geen processen gedeployed op ${E}`, detail: "Triggers worden actief zodra een proces op deze omgeving staat." });
      else if (!f.length) f.push({ level: "ok", title: "Alle triggers draaien zonder fouten" });
      return { summary: `${plural(list.length, "trigger", "triggers")} op ${E}, ${list.filter((t) => t.paused).length} gepauzeerd.`, findings: f };
    }
    case "queues": {
      const list = broker.list(env);
      for (const q of list) {
        if (q.isDeadLetter && q.depth) f.push({ level: "warn", title: `${q.queue}: ${plural(q.depth, "bericht", "berichten")} in dead-letter`, detail: "Bekijk de oorzaak en bied ze opnieuw aan (redrive)." });
        else if (!q.isDeadLetter && q.depth > 50 && !q.consumers) f.push({ level: "warn", title: `${q.queue}: ${q.depth} berichten, geen verwerker`, detail: "Er is geen proces met een queue-trigger actief op deze queue op deze omgeving." });
        else if (!q.isDeadLetter && q.depth && !q.consumers) f.push({ level: "info", title: `${q.queue}: ${plural(q.depth, "bericht wacht", "berichten wachten")}`, detail: "Geen proces leest deze queue automatisch; berichten blijven staan tot een stap ze ophaalt." });
      }
      if (!list.length) f.push({ level: "info", title: `Nog geen queues op ${E}` });
      else if (!f.length) f.push({ level: "ok", title: "Geen achterstand of dead-letters" });
      return { summary: `${plural(list.filter((q) => !q.isDeadLetter).length, "queue", "queues")} op ${E}.`, findings: f };
    }
    case "datatables": {
      const list = datatables.list(env);
      const used = new Set(registry.listIntegrations().flatMap((i) => (i.steps || []).filter((s) => s.type === "datatable").map((s) => String((s.config as { table?: string })?.table))));
      for (const t of list) {
        if (!used.has(t.name)) f.push({ level: "info", title: `${t.name}: niet gebruikt door een proces` });
        if (t.rowCount > 10000) f.push({ level: "warn", title: `${t.name}: ${t.rowCount} rijen`, detail: "Voor grote of blijvende data is een echte database via een SQL-koppeling geschikter." });
      }
      const missing = [...used].filter((n) => n && !list.some((t) => t.name === n));
      if (missing.length) f.push({ level: "warn", title: `Processen gebruiken tabellen die op ${E} niet bestaan`, detail: missing.join(", ") });
      if (!list.length) f.push({ level: "info", title: `Nog geen datatabellen op ${E}` });
      return { summary: `${plural(list.length, "datatabel", "datatabellen")} op ${E}.`, findings: f };
    }
    case "credentials": {
      const list = credentials.list();
      const usedBy = new Map<string, string[]>();
      for (const i of registry.listIntegrations()) for (const s of i.steps || []) { const c = (s.config as { credential?: string })?.credential; if (c) usedBy.set(c, [...(usedBy.get(c) || []), i.integration]); }
      for (const c of list) {
        const missingEnvs = ENVIRONMENTS.filter((e) => !c.envs.includes(e));
        if (usedBy.has(c.name) && missingEnvs.length) f.push({ level: missingEnvs.includes("prod") ? "warn" : "info", title: `${c.name}: geen waarden voor ${missingEnvs.map((e) => e.toUpperCase()).join(", ")}`, detail: `Gebruikt door ${usedBy.get(c.name)!.join(", ")}.` });
        if (!usedBy.has(c.name)) f.push({ level: "info", title: `${c.name}: niet gebruikt`, detail: "Ongebruikte koppelingen kun je opruimen." });
      }
      const unknown = [...usedBy.keys()].filter((n) => !list.some((c) => c.name === n));
      if (unknown.length) f.push({ level: "risk", title: "Processen verwijzen naar koppelingen die niet bestaan", detail: unknown.map((n) => `${n} (${usedBy.get(n)!.join(", ")})`).join(" · ") });
      if (!process.env.AIP_SECRET_KEY) f.push({ level: "warn", title: "Standaard encryptiesleutel in gebruik", detail: "Zet AIP_SECRET_KEY op de server; anders zijn de versleutelde geheimen met een bekende sleutel te ontsleutelen." });
      return { summary: `${plural(list.length, "koppeling", "koppelingen")}.`, findings: f };
    }
    case "incidents": {
      const list = registry.listIncidents();
      for (const i of list.slice(0, 6)) f.push({ level: i.severity === "critical" || i.severity === "high" ? "warn" : "info", title: `${i.integration}: ${i.problem}`, detail: `Ernst ${i.severity}.` });
      if (!list.length) f.push({ level: "ok", title: "Geen incidenten gemeld" });
      return { summary: `${plural(list.length, "incident", "incidenten")}.`, findings: f };
    }
    case "audit": {
      const v = audit.verify();
      f.push(v.valid ? { level: "ok", title: "Audit-keten is intact", detail: "Geen enkele regel is achteraf gewijzigd of verwijderd." } : { level: "risk", title: `Audit-keten verbroken bij regel ${v.brokenAt}`, detail: "Er is met het log geknoeid of het is beschadigd. Onderzoek dit direct." });
      return { summary: `${audit.list().length} auditregels.`, findings: f };
    }
    case "settings": {
      const s = settings.get();
      f.push(s.fourEyes ? { level: "ok", title: "Vier-ogenprincipe staat aan", detail: "Risicovolle acties hebben twee verschillende goedkeurders nodig." } : { level: "warn", title: "Vier-ogenprincipe staat uit", detail: "Eén persoon kan dan een PROD-deploy goedkeuren. Aanbevolen: aanzetten voor productie." });
      return { summary: "Platforminstellingen.", findings: f };
    }
    case "mcp": {
      const allow = process.env.AIP_MCP_ALLOW_APPROVALS === "true";
      f.push(allow ? { level: "warn", title: "Goedkeuren via MCP staat aan", detail: "Een AI-client kan dan zelf goedkeuringen geven. Zet AIP_MCP_ALLOW_APPROVALS uit tenzij dit bewust is." } : { level: "ok", title: "Goedkeuren via MCP staat uit", detail: "MCP-clients kunnen voorstellen doen, maar een mens beslist." });
      return { summary: "MCP-server voor Claude Code/Desktop en andere MCP-clients.", findings: f };
    }
    default:
      return { summary: ctx.title ? `Pagina ${ctx.title}.` : "Deze pagina.", findings: f };
  }
}

const ORDER: Record<Level, number> = { risk: 0, warn: 1, info: 2, ok: 3 };
const WORDS = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 3);

function suggestionsFor(view: string): string[] {
  const base: Record<string, string[]> = {
    editor: ["Wat kan er beter aan dit proces?", "Is dit proces klaar voor PROD?", "Leg uit wat dit proces doet"],
    dashboard: ["Waar moet ik nu naar kijken?", "Waarom mislukken uitvoeringen?"],
    instance: ["Waarom is dit mislukt?", "Hoe los ik dit op?"],
    processes: ["Welke processen hebben aandacht nodig?", "Wat kan naar de volgende omgeving?"],
    infra: ["Zijn al mijn agents online?", "Hoe zet ik PROD op AWS en Azure?"],
    approvals: ["Wat moet ik goedkeuren?", "Wat betekent vier-ogen?"],
    triggers: ["Zijn mijn endpoints veilig?"],
    queues: ["Is er een achterstand?"],
    credentials: ["Ontbreken er waarden per omgeving?"]
  };
  return base[view] || ["Wat zie ik hier?", "Wat raad je aan?"];
}

function heuristicAnswer(q: string, view: string, summary: string, findings: Finding[]): string {
  const t = q.toLowerCase();
  const about = PAGE_ABOUT[view] || "";
  if (/leg uit|wat (is|zie|betekent|doet)|uitleg|waar gaat|wat staat|explain|what (is|am i|does|do i see)|about this/.test(t)) {
    if (view === "editor") return `${summary} ${about}`;
    return `${about} ${summary}`.trim();
  }
  if (/prod|productie|klaar|production|ready/.test(t) && view === "editor") {
    const blockers = findings.filter((x) => x.level === "risk" || x.level === "warn");
    return blockers.length ? `Nog niet: los eerst ${blockers.length === 1 ? "dit punt" : `deze ${blockers.length} punten`} op — ${blockers.map((x) => x.title).join("; ")}. Daarna via TEST en ACC naar PROD.` : "Ik zie geen blokkerende punten. Volg de pijplijn: deploy naar TEST, test de keten, dan ACC en PROD (met goedkeuring).";
  }
  const qw = new Set(WORDS(q));
  const hit = findings.filter((x) => WORDS(`${x.title} ${x.detail || ""}`).some((w) => qw.has(w)));
  const top = (hit.length ? hit : findings.filter((x) => x.level !== "ok")).slice(0, 3);
  if (!top.length) return `${summary} Ik zie hier geen aandachtspunten.`;
  return `${summary} Belangrijkste: ${top.map((x) => `${x.title}${x.detail ? ` (${x.detail})` : ""}`).join("; ")}.`;
}

export async function advisePage(ctx: PageContext): Promise<PageAdvice> {
  const env: EnvName = ctx.env && isEnv(ctx.env) ? ctx.env : "dev";
  const view = PAGE_NAMES[ctx.view] ? ctx.view : ctx.view || "onbekend";
  const page = `${PAGE_NAMES[view] || ctx.title || view}${ctx.param && ctx.param !== "new" && view !== "instances" ? ` · ${ctx.param}` : ""}`;
  const h = heuristic(ctx, env);
  h.findings.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const base: PageAdvice = { page, summary: h.summary, findings: h.findings.slice(0, 12), suggestions: suggestionsFor(view), by: "heuristiek" };
  if (ctx.question) base.answer = heuristicAnswer(ctx.question, view, h.summary, h.findings);
  if (ctx.question) base.suggestions = base.suggestions.filter((x) => x.toLowerCase() !== ctx.question!.trim().toLowerCase());

  if (!claudeAvailable()) return base;
  try {
    const text = String(ctx.text || "").replace(/\n{3,}/g, "\n\n").slice(0, 20000);
    const r = await claudeJson<{ summary: string; findings: Finding[]; answer?: string; suggestions?: string[] }>({
      system: `Je bent de AI-assistent van AIP, een integratieplatform (processen als BPMN, omgevingen DEV→TEST→ACC→PROD, goedkeuringen, triggers, queues, datatabellen, koppelingen).
Je krijgt de volledige tekst van de pagina die de gebruiker nu bekijkt, platformdata en voorlopige bevindingen van een regelsysteem.
Lees de pagina, vat samen wat de gebruiker ziet en geef concreet, kort advies in het ${ctx.lang === "en" ? "Engels (English)" : "Nederlands"}. Verzin geen gegevens die niet in de pagina of data staan.
Formaat: {"summary": string (1-2 zinnen), "findings": [{"level": "risk"|"warn"|"info"|"ok", "title": string, "detail"?: string, "go"?: string}], "answer"?: string (antwoord op de vraag, als die er is), "suggestions"?: string[] (max 3 vervolgvragen)}.
"go" is optioneel een route uit de voorlopige bevindingen (bijv. "queues", "instance/<id>"); gebruik alleen routes die daar voorkomen.`,
      user: JSON.stringify({ pagina: page, omgeving: env, vraag: ctx.question || null, niet_opgeslagen: ctx.dirty || false, proces: ctx.definition || undefined, voorlopige_bevindingen: base.findings, samenvatting_regels: base.summary, paginatekst: text }),
      maxTokens: 1500
    });
    const routes = new Set(base.findings.map((x) => x.go).filter(Boolean));
    const findings = (Array.isArray(r.findings) ? r.findings : []).filter((x) => x && x.title && ORDER[x.level] !== undefined).slice(0, 12)
      .map((x) => ({ level: x.level, title: String(x.title), detail: x.detail ? String(x.detail) : undefined, go: x.go && routes.has(x.go) ? x.go : undefined, goLabel: x.go && routes.has(x.go) ? base.findings.find((b) => b.go === x.go)?.goLabel : undefined }));
    return { page, summary: String(r.summary || base.summary), findings: findings.length ? findings : base.findings, answer: r.answer ? String(r.answer) : base.answer, suggestions: (r.suggestions || base.suggestions).slice(0, 3), by: "claude" };
  } catch {
    return base;
  }
}
