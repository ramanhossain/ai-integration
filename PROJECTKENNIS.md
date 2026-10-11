# AIP Integratieplatform: projectkennis

Stand van zaken op 11 oktober 2026. Dit document beschrijft wat het platform is, hoe het in elkaar zit, hoe je het draait en test, en welke afspraken en valkuilen er zijn. Het is bedoeld als startpunt voor een nieuwe ontwikkelsessie.

---

## 1. Wat het is

Het AIP Integratieplatform is een eigen, AI-native **iPaaS**: een integratieplatform om processen tussen systemen te bouwen, te testen en uit te rollen. Het platform is volledig zelf geschreven. Er wordt geen code van andere workflow-producten gebruikt; dat is een harde regel.

De belangrijkste onderdelen:

- **Proceseditor (BPMN):**
  - Processen bouw je op een canvas met triggers, stappen, beslissingen en eindevents.
  - Per stap is er een detailvenster met drie kolommen: INPUT, parameters en OUTPUT.
  - Je kunt een stap of het hele proces uitvoeren met testdata.
- **Omgevingen DEV → TEST → ACC → PROD:**
  - Bewerken kan alleen op DEV; opslaan maakt een nieuwe versie op DEV.
  - Een deploy naar een andere omgeving is een goedkeuringsverzoek.
  - Er is een vier-ogenprincipe. Dat staat standaard aan, maar kan uit via Instellingen.
  - Op ACC en PROD kun je direct deployen en tussenliggende omgevingen overslaan.
- **Versies:**
  - Er is een keuzelijst met versies en een BPMN-vergelijking per stap.
  - Je kunt een versie terugzetten.
  - Er worden maximaal 100 versies bewaard, standaard 50. Opschonen kan voor alle processen tegelijk.
- **Plugins (connectors):** ongeveer 290 diensten met samen ruim 1500 operaties.
  - De meeste zijn REST-plugins, aangevuld met drivers voor databases, brokers, LDAP, IMAP, SSH en Odoo.
  - Er is OAuth2 met een knop "Verbinden".
  - Elke plugin toont het logo van de organisatie erachter.
  - Plugins moet je **activeren**; alleen geactiveerde plugins verschijnen in de editor.
- **API-beheer:**
  - API's worden gemaakt op basis van een OpenAPI-specificatie (JSON of YAML).
  - Een operatie koppel je aan een proces of aan een passthrough naar een achterliggende API.
  - Beleid regelt API-sleutels, OAuth/JWT via JWKS of HS, publieke toegang, throttling, CORS, een IP-allowlist en welke velden gelogd worden.
  - Er is monitoring van alle aanroepen en een "Proberen"-scherm.
  - Opslaan maakt een patchversie, een deploy publiceert een majorversie (via goedkeuring).
- **Organisaties (multi-tenant):**
  - Aanmelden, inloggen en wachtwoord vergeten.
  - Een hoofdaccount ziet alle organisaties.
  - Accounts kunnen per omgeving andere rechten hebben.
  - Per gebruiker zie je hoeveel processen die heeft en wanneer die laatst inlogde.
- **AI-assistent:**
  - Een chatbubbel rechts die de huidige pagina automatisch leest.
  - Elk gesprek begint nieuw; eerdere gesprekken staan in een geschiedenis.
  - Er zijn agents voor bouwen, monitoring en pagina-advies (Claude, of een heuristiek zonder API-sleutel).
- **MCP-server:** het platform is bruikbaar vanuit Claude Desktop en andere MCP-clients, via stdio (`npm run mcp`) en HTTP (`/mcp`).
- **Agents en infrastructuur:**
  - Externe uitvoeragents met agentgroepen, deploydoelen en failover.
- **ebMS 2.0 en AS4:**
  - Plugins `ebms`, `digipoort`, `berichtenbox`, `lopende-zaken` en `digilevering`.
  - AS4 werkt via een Holodeck-gateway.
  - Deze onderdelen zijn gebouwd in een **andere sessie** en zijn nog niet gecommit (zie §9).

Licentie: MIT (publieke repository).

---

## 2. Locaties en links

| Wat | Waar |
|---|---|
| Code | `~/Documents/Claude/ai-integration/platform` (repo-root: `~/Documents/Claude/ai-integration`) |
| GitHub | `github.com/ramanhossain/ai-integration`, branch `main` (publiek) |
| Lokale server van de gebruiker | `http://localhost:3001/app/` (draait met `npm run dev`, dus `tsx watch`) |
| Codespace | **musical waddle** · portaal `https://musical-waddle-544vv5pqwg534j6g-3001.app.github.dev/app/` |
| GitHub-gegevens (PAT) | `~/Documents/Claude/GITHUB_SETUP.md`: **nooit tonen of opslaan** |

---

## 3. Techniek

- **Taal en runtime:** TypeScript, Node 24 (`engines >=24`), uitgevoerd met `tsx`, server op Fastify 5.
- **GUI:** vanilla JavaScript in `public/`, zonder framework. De HTML/CSS staat in `public/index.html`, de Engelse vertaling in `public/i18n/en.js`.
- **Opslag (`src/store`):**
  - Standaard **FileDriver**: per collectie één JSON-bestand in `data/store`. Schrijven gebeurt atomair (tijdelijk bestand, fsync, hernoemen).
  - `AIP_STORAGE=memory` houdt alles alleen in het geheugen (tests, agents).
  - `DATABASE_URL` schakelt over naar Postgres.
  - Een beschadigd bestand wordt hernoemd naar `*.kapot-<tijd>` en niet overschreven.
- **Multi-tenancy (`src/tenancy`):**
  - De organisatie volgt het request via AsyncLocalStorage (`runInOrg` / `currentOrg`).
  - `scoped()` levert per organisatie een eigen singleton.
  - Collecties krijgen het voorvoegsel `org~`; globale collecties beginnen met `_` (bijvoorbeeld `_users`, `_orgs`).
  - Publieke paden van andere organisaties staan onder `/o/<org>/hooks|apis/…`.
  - Bij het opstarten laadt `hydrateOrg` elke organisatie in (zie `boot.ts`).
- **Authenticatie (`src/auth/guard.ts`):**
  - Sessies via een HttpOnly-cookie, wachtwoorden met scrypt, API-sleutels `aip_…`.
  - Velden met een identiteit in de body (`approver`, `proposedBy`, `owner`, …) worden overschreven met de ingelogde gebruiker.
  - `AIP_AUTH=off` zet authenticatie uit; alleen voor ontwikkeling en tests, niet toegestaan als `NODE_ENV=production`.
- **Geheimen:**
  - Geheime velden van koppelingen worden versleuteld (`enc:v1:`) met `AIP_SECRET_KEY`, en in API-antwoorden gemaskeerd (`••••••`).
- **Uitgaand verkeer (`src/net/egress.ts`):**
  - `safeFetch` en `assertHostAllowed` bewaken uitgaande verzoeken.
  - Metadata-adressen zijn altijd geblokkeerd.
  - Een privénetwerk is alleen toegestaan voor de standaardorganisatie (`AIP_EGRESS_PRIVATE`).
  - IPv4-adressen die in IPv6 verpakt zijn (`::ffff:`, `64:ff9b::/96`) worden herkend.
- **Code-stap:** draait in een isolated-vm-sandbox met een geheugen- en tijdslimiet.
- **Engine (`src/engine`):**
  - `engine.ts` doet uitvoering, retry met backoff, dead-letter en het bijhouden van runs.
  - `nodes.ts` bevat de staptypes, `STEP_CATALOG` en `TRIGGER_CATALOG`.
  - Een fout met `noRetry` wordt niet opnieuw geprobeerd; dat geldt bijvoorbeeld voor 4xx-antwoorden behalve 408 en 429.
- **Triggers (`src/triggers/manager.ts`):**
  - Soorten: handmatig, schema (cron), webhook (`/hooks/<env>/<pad>`), API-endpoint (`/apis/<env>/<pad>`), queue, map, FTP, AS4 en ebMS.
  - Faalt de validatiestap, dan krijgt de aanroeper **422** met de ontbrekende velden.
  - Andere fouten geven 500, met details alleen op DEV (`publicError`).
- **API-gateway (`src/apim`):**
  - Per aanroep: route bepalen, beleid zoeken, authenticeren, throttling toepassen, het proces of de passthrough uitvoeren en alles loggen.
  - Sleutels en tokens van de afnemer komen nooit in het proces, de logs of het doelsysteem terecht.
  - CORS-headers van het doelsysteem worden niet doorgegeven.
- **Belangrijke omgevingsvariabelen:**
  - Server: `PORT`, `HOST`, `LOG_LEVEL`, `NODE_ENV`, `AIP_PUBLIC_URL`.
  - Opslag en sleutels: `AIP_DATA_DIR`, `AIP_STORAGE`, `DATABASE_URL`, `AIP_SECRET_KEY`.
  - Toegang: `AIP_AUTH`, `AIP_SIGNUP`, `AIP_EGRESS_PRIVATE`.
  - Mail: `AIP_SMTP_URL`, `AIP_MAIL_FROM`.
  - AI: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.
  - MCP: `AIP_MCP_TOKEN`.
  - TLS en ebMS: `AIP_TLS_*` en `AIP_EBMS_*`.

### Mappen in `src/`

| Map | Inhoud |
|---|---|
| `api/` | REST-routes (`routes.ts`, `platformRoutes.ts`, `pluginRoutes.ts`, `apimRoutes.ts`, `authRoutes.ts`, `connectorRoutes.ts` met `/apis` en `/hooks`, `runtimeRoutes.ts`, `transferRoutes.ts`, plus ebMS en AS4) |
| `domain/` | `registry.ts` (processen + validatie bij opslaan), `deployments.ts` (versies/omgevingen), `settings.ts`, `workspace.ts` (plugin-activatie en concepten) |
| `engine/` | uitvoering en staptypes |
| `plugins/` | `defs/*` (plugindefinities), `runtime.ts` (REST-uitvoering), `drivers.ts`, `signers.ts`, `logos.ts`, `catalog.ts` |
| `apim/` | API-beheer, gateway, JWT |
| `approval/` | goedkeuringen (risico groen/oranje/rood) en `executor.ts` |
| `auth/` | accounts, guard, mailer |
| `connectors/` | koppelingen (`credentials.ts`), datatabellen, queues, bestanden |
| `mcp/`, `agents/`, `agent/`, `runtime/` | MCP-server, AI-agents, externe uitvoeragent, agentgroepen |

---

## 4. Draaien

```bash
cd platform
npm install
npm run dev          # http://localhost:3001/app/ (tsx watch)
npm run seed         # demodata in een draaiende server
```

- **Lokale server van de gebruiker (3001) herstarten zonder het `tsx watch`-proces te stoppen:** `touch src/index.ts`. De watcher start de server dan opnieuw.
- **Testserver** (nooit 3001 gebruiken):

  ```bash
  AIP_AUTH=off AIP_STORAGE=memory PORT=3099 npx tsx src/index.ts
  ```

---

## 5. Testen

| Commando | Wat |
|---|---|
| `npm run smoke` | kern zonder server |
| `npm run test:plugins` | alle plugins (bouwt ook de aanvraag van elke operatie) |
| `npm run test:auth` | accounts, organisaties, beveiliging |
| `npm run test:apim` | API-beheer, gateway, beleid, JWT |
| `npm run test:ebms` / `test:as4` | ebMS/AS4 (andere sessie) |
| `AIP_URL=http://localhost:3099 npm run test:integration` | tegen een draaiende server met `AIP_AUTH=off` |
| `npm run typecheck` | TypeScript |

- Controleer de GUI-bestanden met `node --check public/*.js`.
- De integratietest verwacht precies het aantal triggertypes in `TRIGGER_CATALOG`: **7** zonder ebMS/AS4, **9** met. In de lokale werkkopie staat 9; in git nog 7.

---

## 6. Codespace (gratis hosting)

- Bestanden: `.devcontainer/devcontainer.json` en `.devcontainer/start.sh`.
  - `start.sh` start de server losgekoppeld (`setsid nohup`) op poort 3001.
  - Het maakt eenmalig een eigen `AIP_SECRET_KEY` aan in `platform/data/.secret`.
  - Het wacht tot `/health` antwoordt; logs staan in `/tmp/aip.log`.
- **Bijwerken**, in de terminal van de codespace:

  ```bash
  cd /workspaces/ai-integration && git pull --ff-only && bash .devcontainer/start.sh
  ```

- Na elke herstart staat poort 3001 weer op **Private**. Zet hem terug via **Ports**: rechtermuisknop op de poort, dan Port Visibility en **Public**. Klik niet op "Stop Forwarding Port".
- De codespace stopt vanzelf na een tijd zonder activiteit. Dan moet je hem herstarten, `start.sh` draaien en de poort weer op Public zetten.
- Gegevens staan in `platform/data` en blijven bewaard bij `git pull` en bij een herstart. Ze zijn **alleen weg als je de codespace verwijdert**.
- Onderzocht op 8 oktober: de "verdwenen processen" waren nooit opgeslagen. Het auditlog bevat geen enkele `integration.upserted`. Concepten (§7) voorkomen dat verlies nu.

---

## 7. Gedrag dat bewust zo is (recente beslissingen)

### Processen en editor

- **Nieuw proces:**
  - Begint met alleen de trigger en een unieke naam (NieuwProces, NieuwProces2, …).
  - `#editor/new` is elke keer leeg.
- **Concepten:**
  - Ga je weg uit een nieuw proces zonder op te slaan, dan wordt het als concept op de server bewaard. Dat gebeurt ook bij sluiten of verversen van de pagina, maar alleen als er iets gewijzigd is.
  - Concepten staan op de pagina Processen en openen via `#editor/~<id>`.
  - Opslaan maakt er een gewoon proces van en verwijdert het concept.
  - API: `/api/v1/drafts`.
- **Veldpaden:**
  - In velden die een naam of pad vragen, telt `{{veld}}` als `veld`. Dat geldt voor `required`, `key`, `when`, `field`, `target`, `bodyField`, `inputField`, `contentField`, `sortBy`, kolommen en de sleutels van Velden instellen en Transformatie.
  - De engine normaliseert dit centraal in `getNode` (`normalizeStep`).
  - De editor zet in zulke velden het kale pad. In de naamkolom van een rij komen de naam en de verwijzing (`{{veld}}`) als waarde.
  - In tekstvelden blijft het een `{{template}}`.
- **Velden instellen en Transformatie:**
  - Er is een vinkje "Overige / niet-gemapte velden behouden". Bij nieuwe stappen staat het uit, dus de output bevat alleen de ingestelde velden. Bestaande stappen houden het oude gedrag.
  - Een stap zonder regels geeft het bericht ongewijzigd door.
- **HTTP-stap:**
  - Zonder methode wordt GET gebruikt; met een ingestelde body POST.
  - Zonder URL wordt de aanroep gesimuleerd (bewust; de demo draait zo).
  - Ontbrekende `{{variabelen}}` in de URL geven een fout zonder retry.
- **Editor:**
  - Knoppen voor ongedaan maken en opnieuw.
  - Verwijder je een stap midden in de flow, dan worden de buren opnieuw verbonden.
  - De "+" op een vrije uitgang is altijd zichtbaar.
  - Het tabblad Versies heeft een knop Vergelijken.
- **Bij opslaan geweigerd:**
  - Een naam die al bestaat (409 met `create=true`).
  - Een verbinding naar een stap die niet bestaat (400).
  - Een dubbel webhookpad of dubbel API-pad (409).
- **Statistiek:** testruns uit de editor tellen niet mee in de dashboardcijfers.

### Plugins

- Er zijn twee knoppen per plugin:
  - **Activeren** maakt de plugin zichtbaar in de editor. Dit wordt per organisatie opgeslagen in de collectie `plugin-activation`.
  - **Openen** gaat naar de pluginpagina met overzicht en koppelingen.
- Zolang activatie nog nooit is ingesteld, gelden plugins die al in gebruik zijn als actief.
- Een connector-stap gebruikt standaard de stap-id als doelveld, zodat twee stappen van dezelfde plugin elkaar niet overschrijven.
- Een opgeslagen geheim kun je wissen via "Opgeslagen waarde wissen".
- Testen op PROD mag, omdat testoperaties altijd alleen lezen.

### API-beheer

- De API-trigger in de editor heeft een keuzelijst met endpoints uit API-beheer. Bij opslaan wordt het endpoint aan het proces gekoppeld (`trigger.apiId` en `trigger.operation`).
- Deployen kan vanuit de API-lijst (raketknop). Een openstaand verzoek toont "wacht".
- Een deploy geeft een waarschuwing, maar wordt niet geweigerd, als een gekoppeld proces of het beleid op de doelomgeving ontbreekt.
- Ongeldige JSON krijgt een 400, maar pas ná de toegangscontrole, en de aanroep komt in de monitoring.
- Iets wat niet bestaat geeft 404, een validatiefout 400.
- **Vier-ogen:** wie een verzoek indient, mag het niet zelf goedkeuren. Wie alleen werkt, moet een tweede account gebruiken of vier-ogen uitzetten.

---

## 8. Afspraken met de gebruiker

- Communicatie, GUI-teksten en commits zijn **in het Nederlands**.
- Gebruik **iconen in plaats van tekstknoppen** waar dat kan.
- **Nooit testen tegen de server van de gebruiker op 3001.** Gebruik een aparte testserver op 3099 (of 3101, enzovoort) met `AIP_STORAGE=memory`.
- **Push alleen als de gebruiker erom vraagt.** "doe jij het" geldt voor die ene keer.
- Verwijder nooit zelf gegevens of codespaces van de gebruiker. Verander geen beveiligingsinstellingen, zoals Trust in VS Code.
- **Controleer vóór elke push** of er geen verwijzingen naar andere workflow-producten in staan, en geen geheimen, PAT of persoonlijk e-mailadres.
- **Pushen:**
  - De SSH-sleutel `~/.ssh/id_ed25519` bestaat niet meer op de Mac.
  - Push daarom via HTTPS met de PAT als eenmalige header: `git -c http.extraHeader="Authorization: Basic <base64 x-access-token:PAT>" push https://github.com/ramanhossain/ai-integration.git main`.
  - Toon de PAT nooit en sla hem nergens op.
- **Codespace bijwerken:** via de VS Code-tab in Chrome (Claude in Chrome), daarna poort 3001 weer op Public zetten.
- **Bij bugs in de GUI:** eerst reproduceren op 3099, dan fixen, de testsuites draaien, in de browser controleren en in het Nederlands rapporteren.

---

## 9. Werk van een andere sessie (ebMS/AS4): niet zonder overleg committen

- Niet gecommit, en bewust buiten alle commits gehouden:
  - `platform/docs/`;
  - `scripts/ebms-test.ts` en `scripts/as4-test.ts`;
  - `src/api/ebmsRoutes.ts` en `src/api/as4Routes.ts`;
  - `src/plugins/ebms*` en `src/plugins/as4*`;
  - `src/plugins/defs/ebms.ts` en `src/plugins/defs/as4.ts`.
- Daarnaast staan er wijzigingen van die sessie in gedeelde bestanden:
  - `index.ts` (TLS en routes), `tenancy/boot.ts`, `triggers/manager.ts` en `engine/nodes.ts` (triggers);
  - `auth/guard.ts`, `store/*`, `plugins/registry.ts` en `plugins/drivers.ts`;
  - `public/app.js`, `public/editor.js`, `public/plugins.js` en `public/admin.js`;
  - `schemas/integration.schema.json`, `package.json` (kafkajs/ebMS-dependencies), `.gitignore` en `README.md`;
  - `scripts/integration-test.ts` (9 triggers).
- **Zo commit je alleen je eigen werk uit gemengde bestanden:**
  1. Neem van de huidige werkkopie de `git diff -U0`.
  2. Draai van onder naar boven alleen de hunks terug die `ebms`, `as4` of `holodeck` bevatten.
  3. Schrijf het resultaat in een tijdelijke worktree vanaf HEAD.
  4. Draai daar `tsc`, `node --check` en de testsuites.
  5. Stage de bestanden met `git hash-object -w` en `git update-index --cacheinfo`.
- Let op: hunks zonder zo'n trefwoord kunnen tóch van die sessie zijn (bijvoorbeeld TLS in `index.ts`). Controleer daarom altijd de diff.

---

## 10. Commitgeschiedenis (recent)

| Commit | Inhoud |
|---|---|
| `62f39f8` | Veldpaden in alle stappen; Transformatie alleen gemapte velden (optie) |
| `ee3f94e` | Velden instellen: alleen ingestelde velden; veld in naamkolom wordt naam + verwijzing |
| `b0c0eaa` | Validatie accepteert `{{veld}}`; editor voegt het kale pad in |
| `9289836` | Plugins activeren, concepten, API-trigger uit API-beheer, deployen vanaf de API-lijst |
| `c72a562` | Resterende punten uit de testrapporten |
| `35d559f` | Fixes uit drie testrondes |
| `3ae426d` | API-beheer en plugin-logo's |
| `5d375e4`, `4c2a9d4` | Codespaces |
| `556babb` | Accounts en organisaties + beveiligingsronde |
| `99c83e6` | Versies, BPMN-vergelijking, direct deployen naar ACC/PROD |
| `5c5871d` | Eerste publieke versie (MIT) |

---

## 11. Bekende open punten en ideeën

- Er is nog geen lus- of split-stap.
- Odoo-netwerkfouten tonen nog geen foutcode, zoals ECONNREFUSED.
- De ebMS/AS4-code wacht nog op een beslissing van de gebruiker over committen.
