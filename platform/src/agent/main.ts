// Startpunt van de agent. De agent gebruikt nooit de database van het portaal:
// DATABASE_URL wordt genegeerd vóórdat de engine geladen wordt.
delete process.env.DATABASE_URL;
process.env.AIP_STORAGE = "memory"; // de agent bewaart zelf niets; het portaal is de bron
process.env.AIP_ROLE = "agent";
// eslint-disable-next-line @typescript-eslint/no-require-imports
(require("./agent") as typeof import("./agent")).main().catch((err: Error) => {
  console.error("[aip-agent]", err.message);
  process.exit(1);
});
