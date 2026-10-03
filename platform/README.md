# AIP — Agentic Integration Platform

Een eigen integratieplatform: **eigen workflow-engine**
(geen externe runtime), een BPMN-procesontwerper, een promotiepijplijn **DEV → TEST → ACC → PROD**,
standaardkoppelingen, triggers, datatabellen, queues, een MCP-server, AI-agents en
human-in-the-loop. Alles is API-first en machine-leesbaar.

Plan en architectuur: [`../agentic-integration-platform.html`](../agentic-integration-platform.html).

## Starten

```bash
npm install
npm run dev               # http://localhost:3001/app/
npm run seed              # (tweede terminal) demodata in de draaiende server
npm run smoke             # test de kern zonder server
# end-to-end tests: bij voorkeur tegen een aparte testserver in het geheugen, zodat testprocessen niet in je eigen data komen
PORT=3099 AIP_STORAGE=memory npx tsx src/index.ts &   # testserver
AIP_URL=http://localhost:3099 npm run test:integration  # incl. echte FTP-server en MCP
npm run mcp               # MCP-server via stdio (voor Claude Desktop e.d.)
```

Werkt zonder database: alles wordt standaard bewaard in bestanden in `data/store/` (processen, versies, uitvoeringen,
koppelingen, tabellen, queues, varianten, audit log) en blijft staan na een herstart. Voor Postgres: `docker compose up -d`
en `DATABASE_URL=postgres://aip:aip@localhost:5432/aip`. `AIP_STORAGE=memory` = alleen in het geheugen (voor tests).

| Variabele | Betekenis |
|---|---|
| `DATABASE_URL` | Postgres voor persistentie (anders bestanden in `data/store/`) |
| `AIP_DATA_DIR` | Map voor de bestandsopslag (standaard `data/store`) |
| `AIP_STORAGE` | `memory` = niets bewaren (tests) |
| `AIP_SECRET_KEY` | Sleutel waarmee geheimen van koppelingen versleuteld worden (zet deze!) |
| `AIP_FILES_ROOT` | Map voor bestanden per omgeving (default `data/files`) |
| `AIP_MCP_TOKEN` | Bearer-token vereist op `/mcp` |
| `AIP_MCP_ALLOW_APPROVALS` | `true` = goedkeuren mag ook via MCP (standaard uit) |
| `AIP_PUBLIC_URL` | Publieke basis-URL voor webhook- en MCP-URL's |
| `ANTHROPIC_API_KEY` | Agents gebruiken Claude; zonder key een heuristische fallback |

## GUI

De omgevingsknoppen bovenin (DEV/TEST/ACC/PROD) bepalen welke omgeving je bekijkt:
dashboard, processen, triggers, queues, datatabellen en bestanden volgen die keuze.
Het menu klap je in en uit met ☰ (onthouden per browser). De **AI-assistent** open je via de
invoerbalk onderaan het scherm (of Ctrl/Cmd+J); het gesprek opent als **paneel rechts** (breedte
versleepbaar) en de inhoud schuift op, zodat het canvas zichtbaar blijft. In de proceseditor **bouwt hij live mee**
en lichten gewijzigde elementen kort paars op: een
opdracht als “voeg een duplicaatcheck op orderId toe, stuur daarna een e-mail naar
ops@bedrijf.nl” past het proces direct op het canvas aan (met ongedaan maken; opslaan doe je zelf).
Elders ontwerpt hij nieuwe processen en beantwoordt hij vragen over status, goedkeuringen,
triggers, queues en datatabellen.

| Scherm | Wat je er doet |
|---|---|
| Dashboard | Monitoring per omgeving: uitvoeringen, succesratio, fouten, duur, gezondheid, recente fouten |
| Procesinstanties | Elke uitvoering met gevolgd pad, input/output per stap en waardoor hij startte |
| Incidenten | Incident melden; de Recovery Agent stelt herstel voor |
| Processen | Versie per omgeving, deploy-knoppen, uitvoeren op de gekozen omgeving |
| Proceseditor | BPMN-notatie (startevent, taken met markering, gateway, eindevent, datastores, haakse lijnen, gereedschapsbalk links, instellingenpaneel rechts), bediening: vrij verschuiven, verbinden door te slepen, “+” op een losse uitgang, keuzepaneel, dubbelklik opent Input · Parameters · Output met “Stap uitvoeren”, “Proces uitvoeren”, undo/redo, opruimen |
| Detailvenster (dubbelklik) | INPUT en OUTPUT als Schema, Tabel of JSON (keuze wordt onthouden); velden slepen naar een invulveld in het midden wordt `{{pad}}` (ook `lijst[0].veld`), of klik in een veld en daarna op een invoerveld; slepen naar “Sleep invoervelden hierheen” maakt een nieuwe rij; live preview van elke `{{expressie}}`; “Vorige stappen uitvoeren” haalt de echte invoer van de stap op; output kopiëren |
| Selectie en contextmenu | Rechtermuisknop op element/groep/canvas: openen, uitvoeren, hernoemen, (de)activeren, vastzetten, kopiëren/plakken/dupliceren, vervangen, aan chat toevoegen, verwijderen. Meerdere elementen: Shift/⌘-klik, Shift-slepen (lasso) of ⌘A; groeperen (⌘G, BPMN-groep, dubbelklik op de naam om te hernoemen, slepen verplaatst de hele groep, ⇧⌘G heft op) en “Omzetten naar subproces” (één ingang en één uitgang) |
| Deploy met subprocessen | Bij deployen waarschuwt de editor als aangeroepen subprocessen nog niet op de doelomgeving staan, en kan ze meteen mee deployen |
| Export / import | In de editor “⇩ Export” (huidige canvas, ook niet-opgeslagen) en in de proceslijst ⇩ per proces: JSON-bestand `<naam>.aip.json` downloaden of kopiëren, met gebruikte subprocessen en optioneel testdata. “⇧ Import(eren)”: bestand slepen/kiezen of JSON plakken → controle vooraf (schema, naamconflict, subprocessen, ontbrekende koppelingen/tabellen/queues op DEV) → openen in de editor of direct opslaan als versie op DEV |
| AI-assistent | Bolletje onderaan in het midden; klik klapt het uit tot invoerbalk (Esc of buiten klikken klapt weer in), het gesprek opent rechts. Ontwerpt processen uit gewone taal, past in de editor het proces live aan, en **leest de pagina** (“◎ Lees deze pagina” of een vraag als “waarom is dit mislukt?”, “is dit proces klaar voor PROD?”): de hele paginatekst plus de platformdata erachter → samenvatting, aandachtspunten (risico/let op/tip/in orde) met knoppen ernaartoe en vervolgvragen. Met `ANTHROPIC_API_KEY` doet Claude dit, anders regels per pagina. API: `POST /api/v1/agents/page/advise` |
| Datatabellen | Tabellen met getypeerde kolommen: rijen toevoegen, zoeken, bewerken. Een tabel bestaat altijd op DEV, TEST, ACC en PROD met dezelfde kolommen (aanmaken, kolommen wijzigen en verwijderen gelden voor alle omgevingen); de rijen zijn per omgeving gescheiden |
| Queues | Queues aanmaken, berichten plaatsen/bekijken/ophalen, dead-letter opnieuw aanbieden. Een queue bestaat altijd op DEV, TEST, ACC en PROD met dezelfde naam (ook als hij ontstaat door publiceren of een queue-trigger); berichten zijn per omgeving gescheiden; leegmaken is per omgeving, verwijderen geldt voor alle omgevingen |
| Bestanden | Bestandsmap per omgeving (voor de map-trigger en de stap Bestand) |
| Infrastructuur | Omgevingsvarianten (agentgroepen) per omgeving: de ingebouwde groep Platform plus bijv. PROD-AWS en PROD-Azure. Per variant: agents met status, OS, versie, cloud en laatste heartbeat; verbindingssleutel (eenmalig getoond, vernieuwen); installatiescripts voor Linux/EC2/Azure VM, AWS ECS/Fargate, Azure Container Apps, Docker, Kubernetes en Node. Per proces kies je bij Deploy de varianten en de modus (failover of alle tegelijk); wijzigen op TEST/ACC/PROD gaat via goedkeuring |
| Meervoudige selectie | Vinkjes in Processen, Actieve triggers, Koppelingen, Queues, Datatabellen en Goedkeuringen (Shift-klik voor een reeks, kopvinkje voor alles): (de)activeren op de gekozen omgeving (bijv. alle schema's tegelijk), verwijderen, leegmaken, goedkeuren/afwijzen. Een proces buiten DEV verwijderen vraagt goedkeuring |
| Taal | Instellingen → Taal: Nederlands of English (per browser; ook `?lang=en`). Alle schermen, meldingen, dialogen en de assistent; de assistent begrijpt ook Engelse opdrachten |
| Triggers | Actieve triggers per omgeving, webhook-URL's, volgende uitvoering, pauzeren/hervatten |
| Koppelingen | Credentials met per omgeving andere waarden, verbinding testen |
| Goedkeuringen | Human-in-the-loop inbox |
| Instellingen | Vier-ogenprincipe aan/uit (wijziging komt in het audit log) |
| Audit log | Append-only hash-keten |
| MCP-server | Koppelinstructies voor Claude Code / Claude Desktop, verbindingstest |
| Catalogus & API | Agents, bevoegdheden en machine-interfaces |

## Staptypes (koppelingen)

| Groep | Stappen |
|---|---|
| Data | Validatie · Transformatie · Velden instellen · Duplicaatcheck · CSV · XML |
| Kern | HTTP-aanroep (met auth via koppeling) · Code (JavaScript) · Wachten · Subproces · Doorgeven |
| Bestanden | Bestand (lokaal) · FTP / FTPS / SFTP |
| Opslag & berichten | Queue: publiceren · Queue: ophalen · Datatabel · SQL (PostgreSQL) |
| Communicatie | E-mail (SMTP) · Teams / Slack |
| AI & MCP | MCP-tool (roept een externe MCP-server aan) |
| Flow | Beslissing (ja/nee, met operatoren) · Einde |

Velden accepteren templates: `{{veld.pad}}`, `{{$now}}`, `{{$date}}`, `{{$uuid}}`, `{{$env}}`.
Externe stappen krijgen de retry-instellingen van het proces; daarna optioneel dead-letter.
Zonder URL/koppeling worden HTTP, e-mail en Teams/Slack gesimuleerd (handig op DEV).

## Accounts en organisaties (iPaaS)

Het platform wordt aangeboden als iPaaS: elke klant heeft een eigen **organisatie** met volledig afgeschermde gegevens (processen, versies, koppelingen, queues, datatabellen, bestanden, triggers, uitvoeringen, goedkeuringen, audit log, agentgroepen), elk met DEV/TEST/ACC/PROD.

- **Eerste start:** de GUI vraagt om het **hoofdaccount**. Bestaande gegevens horen bij de hoofdorganisatie (`default`).
- **Aanmelden:** iedereen kan een organisatie aanmaken (uit te zetten in Platformbeheer of met `AIP_SIGNUP=off`); de aanmelder wordt beheerder.
- **Gebruikers** (beheerder): accounts uitnodigen (mail met link, 72 uur geldig), rol beheerder/gebruiker, toegang **per omgeving**: geen / lezen / bewerken. Meerdere accounts per omgeving. Wachtwoordmail sturen, uitschakelen, verwijderen.
- **API-sleutels** per organisatie (`Authorization: Bearer aip_…`) voor MCP, scripts en CI; voor MCP via stdio: `AIP_API_KEY`.
- **Platformbeheer** (hoofdaccount): alle organisaties en accounts met aantal processen, laatst ingelogd en laatst actief; wachtwoord-vergeten-mail sturen; organisaties aanmaken/uitschakelen; aanmelden open/dicht; outbox van systeemmails.
- **Wachtwoord vergeten:** mail met link (1 uur geldig). Mail via `AIP_SMTP_URL` (bijv. `smtps://user:pass@smtp.example.com:465`) en `AIP_MAIL_FROM`; zonder mailserver komen mails in de outbox (Platformbeheer) en het serverlog. Zet `AIP_PUBLIC_URL` voor de juiste links.
- **Publieke endpoints per organisatie:** webhooks `/o/<organisatie>/hooks/<omgeving>/<pad>` en API-endpoints `/o/<organisatie>/apis/<omgeving>/<pad>` (hoofdorganisatie zonder `/o/…`).
- **Beveiliging:** wachtwoorden met scrypt; sessies (HttpOnly-cookie, 14 dagen), reset-tokens en API-sleutels alleen als hash opgeslagen; max. 10 mislukte inlogpogingen per kwartier; indiener/goedkeurder/eigenaar is altijd de ingelogde gebruiker (vier-ogenprincipe met echte accounts).
- **Ontwikkeling/tests zonder accounts:** `AIP_AUTH=off` (alles in de hoofdorganisatie, gebruiker via `x-aip-user`). `npm run test:integration` verwacht zo'n server; `npm run test:auth` test accounts en afscherming in-process.

## Beveiliging

- **Code-stap** draait in een eigen V8-isolate (`isolated-vm`): geen toegang tot Node, bestanden, netwerk of andere organisaties; geheugenlimiet (`AIP_CODE_MEMORY_MB`, standaard 64) en tijdslimiet. Vereist Node 24+.
- **Uitgaand verkeer (SSRF):** HTTP-stappen, plugins, databases, brokers, FTP/SFTP, SMTP en MCP gaan door een egress-controle. Cloud-metadata en link-local zijn altijd geblokkeerd; intern netwerk/localhost alleen voor de hoofdorganisatie (`AIP_EGRESS_PRIVATE=allow|deny` om dat te wijzigen). Redirects worden per stap gecontroleerd. Zet bij hosting ook een egress-firewall (DNS-rebinding).
- **Accounts:** scrypt-wachtwoorden, gelijke responstijd bij onbekende accounts, max. 10 inlogpogingen per kwartier, max. 3 resetmails per account per uur, max. 5 aanmeldingen per IP per uur. Resetlinks gebruiken `AIP_PUBLIC_URL` (zonder die variabele alleen een lokaal adres, nooit een willekeurige Host-header).
- **API-sleutels** kunnen geen accounts of sleutels beheren.
- **Headers:** CSP (geen inline scripts) voor de GUI, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Cache-Control: no-store` voor de API. Sessiecookie `HttpOnly`, `SameSite=Lax`, `Secure` achter HTTPS.
- **Productie:** `NODE_ENV=production` weigert te starten zonder eigen `AIP_SECRET_KEY` of met `AIP_AUTH=off`. Let op: een andere `AIP_SECRET_KEY` maakt eerder versleutelde koppelingsgeheimen onleesbaar (opnieuw invullen).
- **Webhooks** zijn standaard publiek; zet per trigger `auth: apikey` voor alles wat niet publiek hoort te zijn.
- Afhankelijkheden: `npm audit --omit=dev` (laatste controle: 0 kwetsbaarheden).

## Versies

Elk opslaan maakt een nieuwe versie op DEV, met optioneel een wijzigingsnotitie. Op de processenpagina opent het versienummer een keuzelijst met alle versies (datum, auteur, notitie, omgeving):
- **Vergelijken** in BPMN: oud en nieuw naast elkaar; stappen gekleurd als nieuw, verwijderd of gewijzigd. Klik op een stap voor de gewijzigde velden (oud → nieuw), inclusief trigger en verbindingen.
- **Terugzetten**: op DEV als kopie (nieuwe versie), op TEST/ACC/PROD via deploy met goedkeuring.
- **Instellingen → Versies**: aantal bewaarde versies per proces (standaard 50, maximaal 100; oudere worden automatisch opgeruimd) en **Opschonen** (alle oude versies van alle processen verwijderen). Versies die op een omgeving draaien of in een openstaand goedkeuringsverzoek staan, blijven altijd bewaard.
- API: `GET /api/v1/integrations/:name/versions`, `GET /api/v1/versions/stats`, `POST /api/v1/versions/cleanup`, `POST /api/v1/integrations?note=…`.

## Plugins (connectors naar externe diensten)

Pagina **Plugins** (Ontwikkelen → Plugins) toont alle connectors: 284 in de catalogus, waarvan 282 uitgewerkt met 1454 operaties. Nog *gepland*: Orbit (dienst gestopt in 2024) en Flow (API-documentatie van getflow.com niet bereikbaar). Eigen implementatie op de publieke API's van de diensten.

- Definities: `src/plugins/defs/*.ts` (declaratief: baseUrl, authenticatie, operaties met parameters). Runtime: `src/plugins/runtime.ts` (OAuth2 met verversen, client credentials, AWS Signature V4, API-keys, basic, bearer).
- Eigen ondertekening (`auth.type: "custom"`, `src/plugins/signers.ts`): Ghost Admin-JWT, Azure Storage Shared Key (of SAS), Azure Cosmos DB master key, Unleashed HMAC, en sessies voor SeaTable, FileMaker, Wekan en Venafi TPP.
- Drivers voor niet-HTTP-diensten (`driver: "naam:actie"`, `src/plugins/drivers.ts`): MySQL, SQL Server, Oracle (thin), PostgreSQL/TimescaleDB, MongoDB, Redis, Kafka, MQTT, RabbitMQ, AMQP 1.0, LDAP, IMAP, SSH en Odoo (JSON-RPC). Elke aanroep opent en sluit een eigen verbinding; drivers worden pas geladen bij gebruik. Draai ze via een agent als de database/broker alleen intern bereikbaar is.
- Sjablonen kennen `{{$uuid}}` en `{{$now}}`; operaties kunnen eigen headers hebben (`headers`) en parameters die alleen in sjablonen gebruikt worden (`in: "template"`).
- Koppelingen: type `plugin`, waarden per omgeving (versleuteld). Bij OAuth2 per omgeving op **Verbinden** klikken; zet de getoonde redirect-URI in de OAuth-app (`AIP_PUBLIC_URL` bepaalt de host).
- In een proces: staptype **Connector** (typ de naam van de dienst in de stapkiezer), kies operatie + koppeling; parameters mogen `{{veld}}` bevatten.
- **Proberen** voert een operatie direct uit (niet op PROD). API: `GET /api/v1/plugins`, `GET /api/v1/plugins/:id`, `POST /api/v1/plugins/:id/execute`, `POST /api/v1/plugins/:id/test`. MCP: `list_plugins`, `get_plugin`.
- Tests: `npm run test:plugins` (mockserver, ondertekeningen tegen de specificatie, RSS/Atom, Odoo, elke driver laadt en meldt een verbindingsfout netjes, en alle HTTP-operaties bouwen een geldige aanvraag).

## Triggers

De trigger kies je **in het proces**: bij een nieuw proces verschijnt “Hoe start dit proces?”,
en daarna via de knop ⚡ in de editor of door op het startevent te dubbelklikken. Een trigger is
actief op elke omgeving waar een versie van het proces gedeployed is; “Actieve triggers” is het overzicht.

| Trigger | Werking |
|---|---|
| Handmatig | Via GUI, API of MCP |
| Webhook / HTTP | `/hooks/<omgeving>/<pad>`, optioneel API-key per omgeving, eigen antwoord via `_response` |
| API-endpoint | `/apis/<omgeving>/<pad met {parameters}>`, per methode, schoon JSON-antwoord, OpenAPI op `/apis/<omgeving>/openapi.json` |
| Schema | Cron (5 velden) of elke N seconden |
| Queue | Per bericht; na 3 mislukte pogingen naar `<queue>.dlq` |
| Map | Nieuwe bestanden in de bestandsmap van de omgeving; daarna archiveren of verwijderen |
| FTP / SFTP | Nieuwe bestanden op een server (via koppeling) |

## Omgevingsvarianten en agents (AWS, Azure, …)

Elke omgeving (DEV/TEST/ACC/PROD) heeft één of meer agentgroepen. De ingebouwde groep `<env>-platform` voert processen in het portaal uit.
Voor een groep in bijvoorbeeld AWS of Azure installeer je de **agent**: hij maakt alleen uitgaande HTTPS-verbindingen naar het portaal
(heartbeat elke 15 s, jobs via long-poll), voert processen uit met dezelfde engine en meldt het resultaat terug. Datatabel- en queue-stappen
voert het portaal uit namens de agent; wachtwoorden en sleutels van koppelingen gaan alleen mee met een job, voor de omgeving van de groep.

```bash
# op een Linux-server (EC2, Azure VM, on-prem) — installeert een systemd-service
curl -fsSL https://portaal/agent/install.sh | sudo AIP_AGENT_KEY=aipk_... AIP_AGENT_NAME=aws-1 bash
# of vanuit deze map
AIP_URL=https://portaal AIP_AGENT_KEY=aipk_... npm run agent
```

- `GET/POST /api/v1/agent-groups`, `PATCH/DELETE /api/v1/agent-groups/{id}`, `POST /api/v1/agent-groups/{id}/rotate-key`
- `GET /api/v1/integrations/{naam}/targets`, `PUT /api/v1/integrations/{naam}/targets/{env}` `{ groups, mode: failover|all }`; deploy accepteert `targets`
- Agent-API (Bearer = verbindingssleutel): `POST /api/v1/agent-api/heartbeat`, `GET /api/v1/agent-api/jobs/next`, `POST /api/v1/agent-api/jobs/{id}/result`, `POST /api/v1/agent-api/steps/execute`
- Pakket en scripts: `/agent/aip-agent.tgz`, `/agent/install.sh`, `/agent/Dockerfile`
- Bulk: `POST /api/v1/integrations/bulk` `{ action: pause|resume|delete, names[], env }`, `DELETE /api/v1/integrations/{naam}`

## Export en import (Integration-as-Code)

Formaat `aip.process-export` v1: `{ format, formatVersion, exportedAt, exportedBy, source{integration, version, environments}, process, subprocesses[], requires{credentials, datatables, queues, subprocesses}, testInput? }`.
Geheimen gaan nooit mee: koppelingen, tabellen en queues staan er alleen bij naam in. Een kale procesdefinitie (zoals `GET /api/v1/integrations/{naam}`) kan ook geïmporteerd worden.

- `GET /api/v1/integrations/{naam}/export?version=&subprocesses=true&download=true`
- `POST /api/v1/integrations/export` — `{ definition }` (bv. een niet-opgeslagen canvas)
- `POST /api/v1/integrations/import` — `{ bundle, name?, onConflict: version|rename|fail, subprocesses: missing|all|none, dryRun?, saveProcess? }`
  (`dryRun` toont wat er gebeurt en wat er op DEV ontbreekt; import landt altijd op DEV en volgt daarna de gewone promotie)

## MCP

- **Streamable HTTP:** `http://localhost:3001/mcp` — `claude mcp add --transport http aip http://localhost:3001/mcp`
- **stdio:** `npm run mcp` (met `AIP_URL`); de GUI-pagina MCP-server toont de Claude Desktop-config.
- 30 tools (o.a. `list_versions` / `restore_version`; `list_agent_groups`: omgevingsvarianten; `review_process`: proces laten beoordelen; `edit_process`: proces aanpassen met een opdracht; `export_process` / `import_process`) (processen, testen, uitvoeren, deploy voorstellen, runs, dashboard, triggers,
  koppelingen, queues, datatabellen), resources `aip://schema/integration` en
  `aip://processes/{name}`, prompt `integratie-bouwen`.
- Alle tools gaan via de REST-API; deploys en PROD-uitvoeringen blijven menselijke goedkeuring vereisen.

## Omgevingen en goedkeuring

**Bewerken kan alleen op DEV.** Opslaan maakt altijd een nieuwe versie op DEV. Op TEST, ACC en PROD wordt nooit iets
bewerkt: de editor toont daar de actieve versie alleen-lezen, met "Bewerken op DEV". Een versie komt op TEST/ACC/PROD
uitsluitend via **Deploy** (goedkeuringsverzoek):

- **Gewone stap:** de versie van de vorige omgeving (DEV → TEST → ACC → PROD).
- **Overslaan:** elke versie mag rechtstreeks naar elke omgeving, bijv. DEV → PROD; het verzoek en het venster melden welke omgevingen worden overgeslagen.
- **Terugzetten:** een oudere versie op een omgeving zetten (rollback), bijv. PROD van v5 terug naar v4.
- **Terugzetten op DEV:** Versies → *Terugzetten op DEV* maakt van een oude versie een nieuwe versie (kopie); de historie blijft intact.

API: `POST /api/v1/integrations/{naam}/deploy` `{ toEnv, version? }`, `GET /api/v1/integrations/{naam}/versions` (versies + geschiedenis),
`POST /api/v1/integrations/{naam}/versions/{v}/restore`. MCP: `deploy_process` (met `version`), `list_versions`, `restore_version`.

| Naar | Risico | Goedkeuring |
|---|---|---|
| DEV | GREEN | automatisch |
| TEST | ORANGE | 1 persoon (met vier-ogenprincipe niet de indiener) |
| ACC | ORANGE | 1 persoon |
| PROD | RED | 2 verschillende personen binnen 30 min (vier-ogenprincipe aan) · 1 (uit) |

Het **vier-ogenprincipe** staat standaard aan en is uit te zetten onder Beheer → Instellingen
(of `PUT /api/v1/settings {"fourEyes": false}`). Uit = één goedkeuring volstaat, ook door de
indiener. Openstaande verzoeken zonder beslissing volgen de nieuwe instelling; verzoeken met al
een goedkeuring houden hun eis. Via MCP is de instelling alleen te lezen.

Uitvoeren op PROD via GUI/API/MCP vraagt ook goedkeuring; triggers van een gedeployed proces draaien direct.

## Structuur

| Onderdeel | Pad |
|---|---|
| Schemas (bron van waarheid) | `schemas/*.json` |
| Workflow-engine + staptypes | `src/engine/` |
| Koppelingen, queues, datatabellen, bestanden | `src/connectors/` |
| Triggers | `src/triggers/` |
| MCP-server (HTTP + stdio) | `src/mcp/` |
| Omgevingen, versies, deployments | `src/domain/` |
| Policy + approval + executor | `src/policy/`, `src/approval/` |
| Agents (Builder, Recovery) | `src/agents/` |
| Persistentie (bestand/Postgres/memory) | `src/store/` |
| API | `src/api/` — OpenAPI op `/openapi.json`, Swagger op `/docs` |
| GUI | `public/` (`app.js`, `editor.js`, `admin.js`, `assistant.js`) |

## Bekende beperkingen

- Geen echte gebruikers/rollen: de gebruikersnaam rechtsboven is een vrij veld.
- SFTP en FTPS zijn gebouwd maar alleen FTP is end-to-end getest (met een lokale FTP-server).
- De code-stap draait in `node:vm`; dat is geen beveiligingsgrens — alleen beheerders mogen code schrijven.
- SQL alleen voor PostgreSQL.
