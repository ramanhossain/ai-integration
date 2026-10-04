# AI Integration Platform (AIP)

Open-source, AI-native integratieplatform — met een eigen workflow-engine, BPMN-editor, omgevingen DEV → TEST → ACC → PROD met vier-ogenprincipe, agents per infrastructuur (AWS, Azure, …), 280+ connectors, een MCP-server en een AI-assistent.

De code staat in [`platform/`](platform/) — zie [platform/README.md](platform/README.md) voor starten, architectuur en API.

```bash
cd platform
npm install
npm run dev   # http://localhost:3001/app/
```

Licentie: [MIT](LICENSE)

## Proberen in GitHub Codespaces

Klik op **Code → Codespaces → Create codespace on main**. De omgeving installeert alles en start het platform automatisch op poort 3001 (een eigen encryptiesleutel wordt aangemaakt). Open het tabblad **Ports** en klik op de wereldbol bij poort 3001; maak daar bij de eerste keer het hoofdaccount aan. De poort is standaard privé (alleen jij, ingelogd op GitHub); zet hem op *Public* om het met anderen te delen. Logs: `tail -f /tmp/aip.log`.

