# AIP-integratieplatform

Projectkennis (architectuur, conventies, tests, open punten): zie `PROJECTKENNIS.md`. Code staat in `platform/`.

## Na elke nieuwe of gewijzigde functionaliteit
1. **test-agent** (`.claude/agents/test-agent.md`): typecheck + alle testsuites op een eigen testserver (poort 3099, geheugen), fouten direct repareren.
2. **mcp-agent** (`.claude/agents/mcp-agent.md`): daarna de MCP-server bijwerken zodat MCP-clients de nieuwe functionaliteit ook kunnen gebruiken (`npm run mcp:agent`, eigen tools voor bouwen/monitoren, `src/mcp/coverage.json`).

## Vaste afspraken
- Nooit testen tegen de server van de gebruiker op poort 3001; nooit gebruikersdata verwijderen.
- Communicatie, GUI-teksten en commits in het Nederlands; iconen i.p.v. tekstknoppen.
- Geen namen van andere workflowproducten in het platform.
- Geen persoonlijke gegevens (namen, e-mailadressen, domeinen van de gebruiker of klanten) en nooit echte inloggegevens in code, tests of documentatie. Testaccounts en -wachtwoorden zijn altijd `demo@demo.nl` / `welkom` (extra accounts: `demo2@demo.nl`, …). Voor accounttests: `AIP_STORAGE=memory AIP_DEMO_PASSWORDS=true`.
- Alleen committen/pushen als daarom gevraagd wordt; tokens nooit tonen of opslaan.
