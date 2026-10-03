// MCP-server via stdio — voor MCP-clients die een lokaal proces starten (Claude Desktop,
// Claude Code, Cursor, MCP Inspector). Praat met een draaiend platform via AIP_URL.
// Let op: niets naar stdout schrijven behalve MCP-berichten; logs gaan naar stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server";

async function main() {
  const baseUrl = (process.env.AIP_URL ?? "http://localhost:3001").replace(/\/$/, "");
  const server = createMcpServer({
    baseUrl,
    allowApprovals: process.env.AIP_MCP_ALLOW_APPROVALS === "true",
    user: process.env.AIP_MCP_USER ?? "mcp-stdio",
    // Met accounts aan: een API-sleutel van de organisatie (Beheer → Gebruikers → API-sleutels).
    headers: process.env.AIP_API_KEY ? { authorization: `Bearer ${process.env.AIP_API_KEY}` } : undefined
  });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[aip-mcp] verbonden via stdio met ${baseUrl}\n`);
}

main().catch((err) => {
  process.stderr.write(`[aip-mcp] fout: ${(err as Error).message}\n`);
  process.exit(1);
});
