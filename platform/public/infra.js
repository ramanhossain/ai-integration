// INFRASTRUCTUUR — omgevingsvarianten (agentgroepen) per omgeving.
// Elke omgeving heeft de ingebouwde groep "Platform"; daarnaast groepen voor AWS, Azure,
// GCP, Kubernetes of on-prem waar een agent draait die met dit portaal praat.
/* global VIEWS, S, api, esc, toast, openModal, closeModal, ENVS, fmtDateTime, who, render */

const PROVIDER = {
  platform: { label: "Platform", cls: "pv-platform" },
  aws: { label: "AWS", cls: "pv-aws" },
  azure: { label: "Azure", cls: "pv-azure" },
  gcp: { label: "Google Cloud", cls: "pv-gcp" },
  kubernetes: { label: "Kubernetes", cls: "pv-k8s" },
  onprem: { label: "On-premises", cls: "pv-onprem" },
  other: { label: "Anders", cls: "pv-onprem" }
};
const pvBadge = (p) => `<span class="pv ${(PROVIDER[p] || PROVIDER.other).cls}">${esc((PROVIDER[p] || PROVIDER.other).label)}</span>`;
function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s geleden` : s < 3600 ? `${Math.round(s / 60)} min geleden` : fmtDateTime(iso);
}
const isOnline = (a) => Date.now() - Date.parse(a.lastSeen) < 45000;

VIEWS.infra = async (main) => {
  const [groups, targets] = await Promise.all([api("/api/v1/agent-groups"), api("/api/v1/targets")]);
  const byEnv = (env) => groups.filter((g) => g.env === env);
  const card = (g) => {
    const online = g.builtin ? 1 : g.agents.filter(isOnline).length;
    const status = g.builtin ? `<span class="chip ok">actief</span>` : online ? `<span class="chip ok">${online} agent${online === 1 ? "" : "s"} online</span>` : g.agents.length ? `<span class="chip err">offline</span>` : `<span class="chip none">nog geen agent</span>`;
    return `<div class="ag ${g.builtin ? "builtin" : ""}">
      <div class="ag-h">${pvBadge(g.provider)}<b>${esc(g.name)}</b><span style="flex:1"></span>${status}</div>
      <div class="ag-m faint">${g.region ? `${esc(g.region)} · ` : ""}<span class="mono">${esc(g.id)}</span></div>
      ${g.description && !g.builtin ? `<div class="ag-d">${esc(g.description)}</div>` : ""}
      ${g.builtin ? `<div class="ag-d muted">Processen draaien in het portaal zelf. Geen installatie nodig.</div>` : g.agents.length ? `<ul class="ag-agents">${g.agents.map((a) => `<li><span class="dot ${isOnline(a) ? "on" : "off"}" aria-label="${isOnline(a) ? "online" : "offline"}"></span><div><b>${esc(a.name)}</b> <span class="faint">${esc(a.os || "")}${a.version ? ` · agent ${esc(a.version)}` : ""}</span><div class="faint">${a.cloud?.provider && a.cloud.provider !== "onprem" ? `${esc(a.cloud.provider.toUpperCase())}${a.cloud.service ? " " + esc(a.cloud.service) : ""}${a.cloud.region ? " " + esc(a.cloud.region) : ""} · ` : ""}laatst gezien ${ago(a.lastSeen)} · ${a.jobsDone} jobs${a.jobsFailed ? `, ${a.jobsFailed} mislukt` : ""}</div></div></li>`).join("")}</ul>` : `<div class="ag-d muted">Installeer de agent op een server of container in ${esc((PROVIDER[g.provider] || PROVIDER.other).label)}. Hij maakt verbinding met dit portaal.</div>`}
      <div class="ag-f"><span class="faint">${g.processes.length} proces${g.processes.length === 1 ? "" : "sen"}${g.queued ? ` · ${g.queued} in wachtrij` : ""}</span><span style="flex:1"></span>
        ${g.builtin ? "" : `<button class="btn sm" data-act="ag-install" data-id="${esc(g.id)}">Agent installeren</button><button class="btn sm sec" data-act="ag-edit" data-id="${esc(g.id)}" aria-label="${esc(g.name)} bewerken">Bewerken</button>`}</div>
    </div>`;
  };
  const names = Object.keys(targets).sort();
  const cell = (name, env) => {
    const t = targets[name][env];
    if (t.version == null) return `<td class="faint">—</td>`;
    const multi = groups.filter((g) => g.env === env).length > 1;
    return `<td><div class="tg">${t.groups.map((id) => { const g = groups.find((x) => x.id === id); return `<span class="tgc">${g ? pvBadge(g.provider) : ""}${esc(g ? g.name : id)}</span>`; }).join("")}</div>
      <div class="faint" style="font-size:.74rem">v${t.version}${t.groups.length > 1 ? ` · ${t.mode === "all" ? "alle groepen" : "failover"}` : ""}${multi ? ` · <button class="lnk" data-act="ag-targets" data-name="${esc(name)}" data-env="${env}">wijzigen</button>` : ""}</div></td>`;
  };
  main.innerHTML = `
  <div class="head"><div><h1>Infrastructuur</h1><p>Omgevingsvarianten per omgeving: waar processen draaien. Elke omgeving heeft de ingebouwde groep <b>Platform</b>. Voeg groepen toe voor bijvoorbeeld AWS en Azure en installeer daar de agent; bij het deployen kies je op welke varianten een proces draait (bijv. PROD op AWS én Azure).</p></div>
    <div class="row"><button class="btn" data-act="ag-new">+ Omgevingsvariant</button></div></div>
  <div class="card how"><div class="cb">
    <div class="how-steps"><div><b>1</b> Maak een variant, bijv. <i>PROD · AWS eu-west-1</i>. Je krijgt een verbindingssleutel.</div><div><b>2</b> Installeer de agent in AWS of Azure met het script. Hij maakt alleen uitgaande HTTPS-verbinding met dit portaal.</div><div><b>3</b> Kies bij Deploy op welke varianten het proces draait: failover of op alle tegelijk.</div></div>
  </div></div>
  ${ENVS.map((e) => `<section class="ag-env" aria-label="${esc(e.name)}">
    <div class="ag-env-h"><span class="env ${e.id}">${e.label}</span><h3>${esc(e.name)}</h3><span class="faint">${byEnv(e.id).length} variant${byEnv(e.id).length === 1 ? "" : "en"}</span><span style="flex:1"></span><button class="btn sm sec" data-act="ag-new" data-env="${e.id}">+ Variant op ${e.label}</button></div>
    <div class="ag-grid">${byEnv(e.id).map(card).join("")}</div></section>`).join("")}
  <div class="card" style="margin-top:18px"><div class="ch"><h3>Processen per omgevingsvariant</h3><span class="faint">Wijzigen op TEST/ACC/PROD gaat via goedkeuring</span></div>
    <div class="tw">${names.length ? `<table><thead><tr><th>Proces</th>${ENVS.map((e) => `<th><span class="env ${e.id}">${e.label}</span></th>`).join("")}</tr></thead><tbody>
      ${names.map((n) => `<tr><td><a href="#editor/${encodeURIComponent(n)}"><b>${esc(n)}</b></a></td>${ENVS.map((e) => cell(n, e.id)).join("")}</tr>`).join("")}</tbody></table>` : `<div class="empty">Nog geen processen.</div>`}</div></div>`;
};

// ---------------------------------------------------------------- modals
function groupFormModal(g, envDefault) {
  const isNew = !g;
  openModal(`<div class="ch"><h3>${isNew ? "Nieuwe omgevingsvariant" : `${esc(g.name)} bewerken`}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <form class="cb form" id="ag-form">
      ${isNew ? `<label for="ag-env">Omgeving</label><select class="f" id="ag-env">${ENVS.map((e) => `<option value="${e.id}" ${e.id === (envDefault || S.env) ? "selected" : ""}>${e.name}</option>`).join("")}</select>` : `<label>Omgeving</label><div><span class="env ${g.env}">${g.env}</span></div>`}
      <label for="ag-prov">Infrastructuur</label>
      <select class="f" id="ag-prov">${Object.entries(PROVIDER).filter(([k]) => k !== "platform").map(([k, v]) => `<option value="${k}" ${(g ? g.provider : "aws") === k ? "selected" : ""}>${v.label}</option>`).join("")}</select>
      <label for="ag-name">Naam</label><input class="f" id="ag-name" required minlength="2" maxlength="80" value="${esc(g ? g.name : "")}" placeholder="bijv. AWS eu-west-1">
      <label for="ag-region">Regio / locatie <span class="faint">(optioneel)</span></label><input class="f" id="ag-region" maxlength="60" value="${esc(g?.region || "")}" placeholder="bijv. eu-west-1, westeurope, datacenter Utrecht">
      <label for="ag-desc">Beschrijving <span class="faint">(optioneel)</span></label><input class="f" id="ag-desc" maxlength="300" value="${esc(g?.description || "")}">
      ${isNew ? `<div class="hint" style="margin-top:10px">Na aanmaken krijg je eenmalig de verbindingssleutel en de installatiescripts.</div>` : ""}
    </form>
    <div class="cf">${isNew ? "" : `<button class="btn sm no" id="ag-del" style="margin-right:auto">Verwijderen</button><button class="btn sec" id="ag-rotate">Sleutel vernieuwen</button>`}<button class="btn sec" data-close>Annuleren</button><button class="btn" id="ag-save">${isNew ? "Aanmaken" : "Opslaan"}</button></div>`);
  const nameEl = document.getElementById("ag-name");
  const prov = document.getElementById("ag-prov");
  const env = document.getElementById("ag-env");
  if (isNew) {
    const suggest = () => { if (!nameEl.dataset.touched) nameEl.value = `${(PROVIDER[prov.value] || PROVIDER.other).label}${document.getElementById("ag-region").value ? " " + document.getElementById("ag-region").value : ""}`; };
    nameEl.addEventListener("input", () => (nameEl.dataset.touched = "1"));
    prov.addEventListener("change", suggest);
    document.getElementById("ag-region").addEventListener("input", suggest);
    suggest();
  }
  setTimeout(() => nameEl.focus(), 30);
  const save = async () => {
    if (!nameEl.value.trim() || nameEl.value.trim().length < 2) { nameEl.classList.add("bad"); nameEl.focus(); return; }
    const body = { name: nameEl.value.trim(), provider: prov.value, region: document.getElementById("ag-region").value, description: document.getElementById("ag-desc").value };
    try {
      if (isNew) {
        const r = await api("/api/v1/agent-groups", { body: { ...body, env: env.value } });
        closeModal();
        toast(`Variant ${r.group.name} aangemaakt op ${r.group.env.toUpperCase()}`);
        await render();
        installModal(r.group, r.key);
      } else {
        await api(`/api/v1/agent-groups/${encodeURIComponent(g.id)}`, { method: "PATCH", body });
        closeModal();
        toast("Opgeslagen");
        render();
      }
    } catch (err) { toast(err.message, true); }
  };
  document.getElementById("ag-save").addEventListener("click", save);
  document.getElementById("ag-form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
  document.getElementById("ag-rotate")?.addEventListener("click", async () => {
    if (!confirm(`Nieuwe sleutel voor ${g.name}? De huidige sleutel werkt direct niet meer; verbonden agents moeten de nieuwe sleutel krijgen.`)) return;
    try { const r = await api(`/api/v1/agent-groups/${encodeURIComponent(g.id)}/rotate-key`, { body: {} }); closeModal(); await render(); installModal(g, r.key); }
    catch (err) { toast(err.message, true); }
  });
  document.getElementById("ag-del")?.addEventListener("click", async () => {
    if (!confirm(`Variant ${g.name} verwijderen? Agents in deze groep worden ontkoppeld.`)) return;
    try { await api(`/api/v1/agent-groups/${encodeURIComponent(g.id)}`, { method: "DELETE" }); closeModal(); toast("Variant verwijderd"); render(); }
    catch (err) { toast(err.message, true); }
  });
}

const INSTALL_TABS = [
  ["linux", "Linux-server (EC2 / Azure VM)"],
  ["aws", "AWS ECS / Fargate"],
  ["azure", "Azure Container Apps"],
  ["docker", "Docker"],
  ["k8s", "Kubernetes (EKS / AKS)"],
  ["node", "Handmatig (Node 20)"]
];
function installScripts(P, K, N) {
  const q = (s) => `'${s}'`;
  return {
    linux: [
      ["Op de server (Amazon Linux, Ubuntu, Debian, RHEL) — installeert de agent als systemd-service", `curl -fsSL ${P}/agent/install.sh | sudo AIP_AGENT_KEY=${q(K)} AIP_AGENT_NAME=${q(N)} bash`],
      ["Als EC2 user-data (bij het starten van de instance)", `#!/bin/bash\ncurl -fsSL ${P}/agent/install.sh | AIP_AGENT_KEY=${q(K)} AIP_AGENT_NAME="$(hostname)" bash`],
      ["Op een Azure-VM vanaf je eigen machine (Azure CLI)", `az vm run-command invoke -g <resourcegroep> -n <vm-naam> --command-id RunShellScript \\\n  --scripts "curl -fsSL ${P}/agent/install.sh | AIP_AGENT_KEY=${K} AIP_AGENT_NAME=${N} bash"`]
    ],
    aws: [
      ["1. Image bouwen en naar ECR pushen", `mkdir aip-agent && cd aip-agent\ncurl -fsSLO ${P}/agent/aip-agent.tgz && curl -fsSLO ${P}/agent/Dockerfile\nREPO=<account>.dkr.ecr.<regio>.amazonaws.com/aip-agent\naws ecr create-repository --repository-name aip-agent\naws ecr get-login-password | docker login --username AWS --password-stdin \${REPO%%/*}\ndocker build -t $REPO:1 . && docker push $REPO:1`],
      ["2. Sleutel veilig opslaan in Secrets Manager", `aws secretsmanager create-secret --name aip/agent-key --secret-string ${q(K)}`],
      ["3. Container in de ECS-taakdefinitie (Fargate, 1 taak of meer)", JSON.stringify({ name: "aip-agent", image: "<account>.dkr.ecr.<regio>.amazonaws.com/aip-agent:1", essential: true, environment: [{ name: "AIP_URL", value: P }, { name: "AIP_AGENT_NAME", value: N }], secrets: [{ name: "AIP_AGENT_KEY", valueFrom: "arn:aws:secretsmanager:<regio>:<account>:secret:aip/agent-key" }] }, null, 2)]
    ],
    azure: [
      ["1. Image bouwen in Azure Container Registry", `mkdir aip-agent && cd aip-agent\ncurl -fsSLO ${P}/agent/aip-agent.tgz && curl -fsSLO ${P}/agent/Dockerfile\naz acr build -r <registry> -t aip-agent:1 .`],
      ["2. Container App starten (sleutel als secret)", `az containerapp create -n aip-agent -g <resourcegroep> --environment <containerapps-omgeving> \\\n  --image <registry>.azurecr.io/aip-agent:1 --registry-server <registry>.azurecr.io \\\n  --min-replicas 1 --max-replicas 1 \\\n  --secrets aip-key=${q(K)} \\\n  --env-vars AIP_URL=${P} AIP_AGENT_NAME=${N} AIP_AGENT_KEY=secretref:aip-key`]
    ],
    docker: [
      ["Bouwen en starten", `curl -fsSLO ${P}/agent/aip-agent.tgz && curl -fsSLO ${P}/agent/Dockerfile\ndocker build -t aip-agent .\ndocker run -d --name aip-agent --restart=always \\\n  -e AIP_URL=${P} -e AIP_AGENT_KEY=${q(K)} -e AIP_AGENT_NAME=${q(N)} aip-agent`]
    ],
    k8s: [
      ["Secret en deployment (image eerst bouwen zoals bij Docker/ECR/ACR)", `kubectl create secret generic aip-agent --from-literal=key=${q(K)}\nkubectl apply -f - <<'YAML'\napiVersion: apps/v1\nkind: Deployment\nmetadata: { name: aip-agent }\nspec:\n  replicas: 2\n  selector: { matchLabels: { app: aip-agent } }\n  template:\n    metadata: { labels: { app: aip-agent } }\n    spec:\n      containers:\n        - name: agent\n          image: <registry>/aip-agent:1\n          env:\n            - { name: AIP_URL, value: "${P}" }\n            - { name: AIP_AGENT_KEY, valueFrom: { secretKeyRef: { name: aip-agent, key: key } } }\nYAML`]
    ],
    node: [
      ["Op elke machine met Node.js 20+", `curl -fsSL ${P}/agent/aip-agent.tgz | tar -xz && npm install\nAIP_URL=${P} AIP_AGENT_KEY=${q(K)} AIP_AGENT_NAME=${q(N)} npm run agent`]
    ]
  };
}
function installModal(g, key) {
  const K = key || "<VERBINDINGSSLEUTEL>";
  let P = localStorage.getItem("aip.portalUrl") || location.origin;
  let tab = g.provider === "azure" ? "azure" : g.provider === "aws" ? "linux" : g.provider === "kubernetes" ? "k8s" : "linux";
  const N = `${g.id}-1`;
  openModal(`<div class="ch"><h3>Agent installeren — ${esc(g.name)} <span class="env ${g.env}">${g.env}</span></h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb xfer">
      ${key ? `<div class="xf-note warn"><b>Verbindingssleutel</b> — bewaar hem nu; hij wordt niet opnieuw getoond.<div class="keyrow"><code id="ag-key">${esc(key)}</code><button class="btn sm sec" data-copy="${esc(key)}">Kopiëren</button></div></div>`
        : `<div class="xf-note">De sleutel wordt maar één keer getoond. Kwijt? <button class="lnk" id="ag-newkey">Maak een nieuwe sleutel</button> (de oude werkt dan niet meer).</div>`}
      <label for="ag-portal" class="xf-l">Adres van dit portaal zoals de agent het bereikt</label>
      <input class="f mono" id="ag-portal" value="${esc(P)}">
      <div class="hint" id="ag-portal-hint"></div>
      <div class="seg ndv-seg ag-tabs" role="tablist" style="margin:14px 0 8px;flex-wrap:wrap">${INSTALL_TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === tab ? "on" : ""}" role="tab" aria-selected="${k === tab}">${l}</button>`).join("")}</div>
      <div id="ag-scripts"></div>
      <details class="adv"><summary>Hoe werkt de agent?</summary><ul class="muted" style="font-size:.84rem;margin:8px 0 0;padding-left:18px">
        <li>Alleen <b>uitgaand</b> HTTPS-verkeer naar het portaal: heartbeat elke 15 s en jobs ophalen via long-poll. Er hoeft geen poort open in AWS/Azure.</li>
        <li>De agent voert processen uit met dezelfde engine als het portaal. Bestanden, FTP/SFTP, HTTP-aanroepen en databases benadert hij vanuit zijn eigen netwerk.</li>
        <li>Wachtwoorden en sleutels van koppelingen stuurt het portaal alleen mee met een job, voor de omgeving van deze variant. Datatabellen en queues blijven in het portaal.</li>
        <li>Meerdere agents in één variant delen het werk; valt een variant weg, dan neemt bij <i>failover</i> de volgende variant het over.</li></ul></details>
    </div>
    <div class="cf"><button class="btn" data-close>Klaar</button></div>`);
  const draw = () => {
    const s = installScripts(P, K, N)[tab];
    document.getElementById("ag-scripts").innerHTML = s.map(([t, code]) => `<div class="scr"><div class="scr-h"><span>${esc(t)}</span><button class="btn sm sec" data-copy="${esc(code)}">Kopiëren</button></div><pre class="code">${esc(code)}</pre></div>`).join("");
    const local = /\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(P);
    document.getElementById("ag-portal-hint").innerHTML = local ? `<span style="color:var(--amber)">Een agent in AWS of Azure kan <b>localhost</b> niet bereiken. Publiceer het portaal via HTTPS (load balancer, reverse proxy of tunnel) en vul dat adres in.</span>` : /^http:\/\//.test(P) ? `<span style="color:var(--amber)">Gebruik HTTPS: de sleutel en geheimen gaan anders onversleuteld over het netwerk.</span>` : "";
  };
  draw();
  document.getElementById("ag-portal").addEventListener("input", (e) => { P = e.target.value.trim().replace(/\/$/, ""); try { localStorage.setItem("aip.portalUrl", P); } catch { /* */ } draw(); });
  document.querySelector(".ag-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    tab = b.dataset.tab;
    document.querySelectorAll(".ag-tabs button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); });
    draw();
  });
  document.getElementById("ag-newkey")?.addEventListener("click", async () => {
    if (!confirm(`Nieuwe sleutel voor ${g.name}? De huidige sleutel werkt direct niet meer.`)) return;
    try { const r = await api(`/api/v1/agent-groups/${encodeURIComponent(g.id)}/rotate-key`, { body: {} }); render(); installModal(g, r.key); }
    catch (err) { toast(err.message, true); }
  });
}
document.addEventListener("click", async (e) => {
  const c = e.target.closest("[data-copy]");
  if (!c || !c.closest("#modal")) return;
  try { await navigator.clipboard.writeText(c.dataset.copy); const t = c.textContent; c.textContent = "Gekopieerd ✓"; setTimeout(() => (c.textContent = t), 1400); }
  catch { toast("Kopiëren niet toegestaan — selecteer de tekst en kopieer met ⌘C", true); }
});

// Deploydoelen kiezen (bij deploy en bij wijzigen).
async function chooseTargets(name, env, opts = {}) {
  const [groups, cur] = await Promise.all([api(`/api/v1/agent-groups?env=${env}`), api(`/api/v1/integrations/${encodeURIComponent(name)}/targets`).catch(() => null)]);
  if (groups.length <= 1 && !opts.always) return null; // alleen Platform: niets te kiezen
  const current = (cur && cur[env]) || { groups: [`${env}-platform`], mode: "failover" };
  return new Promise((resolve) => {
    openModal(`<div class="ch"><h3>${opts.title || `Waar draait ${esc(name)} op ${env.toUpperCase()}?`}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <div class="cb">
        <p class="muted" style="margin-top:0">Kies de omgevingsvarianten waarop dit proces draait.</p>
        <ul class="tg-list">${groups.map((g) => { const on = g.builtin ? 1 : g.agents.filter(isOnline).length; return `<li><label class="chk"><input type="checkbox" value="${esc(g.id)}" ${current.groups.includes(g.id) ? "checked" : ""}> ${pvBadge(g.provider)} <b>${esc(g.name)}</b>${g.region ? ` <span class="faint">${esc(g.region)}</span>` : ""}</label> ${on ? `<span class="chip ok">online</span>` : `<span class="chip warn">geen agent online</span>`}</li>`; }).join("")}</ul>
        <fieldset class="tg-mode"><legend>Bij meerdere varianten</legend>
          <label class="chk"><input type="radio" name="tg-mode" value="failover" ${current.mode !== "all" ? "checked" : ""}> <b>Failover</b> — de eerste gezonde variant voert uit (bovenste eerst)</label>
          <label class="chk"><input type="radio" name="tg-mode" value="all" ${current.mode === "all" ? "checked" : ""}> <b>Alle varianten</b> — elke variant voert uit (actief-actief, bijv. AWS én Azure)</label></fieldset>
        ${env !== "dev" ? `<div class="hint">${opts.deploy ? "Dit gaat mee in het goedkeuringsverzoek van de deploy." : "Wijzigen op " + env.toUpperCase() + " gaat via goedkeuring."}</div>` : ""}
      </div>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="tg-ok">${opts.deploy ? `Deploy naar ${env.toUpperCase()}` : "Opslaan"}</button></div>`);
    let done = false;
    document.querySelectorAll("#modal-box [data-close]").forEach((b) => b.addEventListener("click", () => { if (!done) { done = true; resolve("cancel"); } }));
    document.getElementById("tg-ok").addEventListener("click", () => {
      const sel = [...document.querySelectorAll(".tg-list input:checked")].map((i) => i.value);
      if (!sel.length) { toast("Kies minstens één variant", true); return; }
      done = true;
      const mode = document.querySelector('input[name="tg-mode"]:checked').value;
      closeModal();
      resolve({ groups: sel, mode });
    });
  });
}
window.chooseTargets = chooseTargets;

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act^='ag-']");
  if (!b) return;
  const act = b.dataset.act;
  try {
    if (act === "ag-new") groupFormModal(null, b.dataset.env);
    if (act === "ag-edit" || act === "ag-install") {
      const g = await api(`/api/v1/agent-groups/${encodeURIComponent(b.dataset.id)}`);
      act === "ag-edit" ? groupFormModal(g) : installModal(g);
    }
    if (act === "ag-targets") {
      const t = await chooseTargets(b.dataset.name, b.dataset.env, { always: true });
      if (!t || t === "cancel") return;
      const r = await api(`/api/v1/integrations/${encodeURIComponent(b.dataset.name)}/targets/${b.dataset.env}`, { method: "PUT", body: t });
      toast(r.applied ? "Omgevingsvarianten aangepast" : `Wacht op goedkeuring (${r.approval.requiredApprovals})`);
      render();
    }
  } catch (err) { toast(err.message, true); }
});

// Live bijwerken zolang de pagina open is (heartbeats van agents).
setInterval(() => { if (S.view === "infra" && document.getElementById("modal").classList.contains("hide") && !document.hidden) render(); }, 10000);
