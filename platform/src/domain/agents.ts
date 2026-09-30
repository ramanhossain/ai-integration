// Machine-leesbaar register van de agents en hun capabilities. Agents en externe
// systemen kunnen dit bevragen om te ontdekken wie wat mag doen en met welk risico.

import type { RiskLevel } from "./types";

export interface Capability {
  action: string; // actietype dat de agent kan voorstellen
  maxRisk: RiskLevel; // hoogste risiconiveau dat de agent zelf mag voorstellen
}

export interface AgentDescriptor {
  id: string;
  name: string;
  role: string;
  capabilities: Capability[];
}

export const agents: AgentDescriptor[] = [
  {
    id: "orchestrator",
    name: "Orchestrator Agent",
    role: "Begrijpt opdrachten en coördineert de andere agents tot een keten.",
    capabilities: [{ action: "orchestrate.plan", maxRisk: "green" }]
  },
  {
    id: "builder",
    name: "Integration Builder Agent",
    role: "Bouwt API's, workflows en integraties.",
    capabilities: [
      { action: "mapping.propose", maxRisk: "green" },
      { action: "mapping.update", maxRisk: "orange" },
      { action: "deploy.dev", maxRisk: "green" },
      { action: "deploy.test", maxRisk: "orange" },
      { action: "deploy.acc", maxRisk: "orange" },
      { action: "deploy.prod", maxRisk: "red" }
    ]
  },
  {
    id: "test",
    name: "Test Agent",
    role: "Unit-, integratie- en regressietests.",
    capabilities: [{ action: "test.run", maxRisk: "green" }, { action: "test.generate", maxRisk: "green" }]
  },
  {
    id: "chain-test",
    name: "Chain Test Agent",
    role: "End-to-end ketentest A -> B -> C met synthetische data.",
    capabilities: [{ action: "test.run", maxRisk: "green" }]
  },
  {
    id: "monitoring",
    name: "Monitoring Agent",
    role: "Analyseert logs, latency en failures; diagnose en herstelvoorstel.",
    capabilities: [
      { action: "read.logs", maxRisk: "green" },
      { action: "monitoring.analyze", maxRisk: "green" },
      { action: "consumer.pause", maxRisk: "orange" }
    ]
  },
  {
    id: "security",
    name: "Security Agent",
    role: "Continue defensieve checks; alleen geautoriseerde actieve tests.",
    capabilities: [
      { action: "read.config", maxRisk: "green" },
      { action: "security.scan", maxRisk: "green" },
      { action: "security.active_test", maxRisk: "red" }
    ]
  },
  {
    id: "infra",
    name: "Infrastructure Agent",
    role: "Containers, deployment, scaling, secrets, certificaten.",
    capabilities: [
      { action: "infra.plan", maxRisk: "orange" },
      { action: "scale.workers", maxRisk: "orange" },
      { action: "infra.apply", maxRisk: "red" }
    ]
  },
  {
    id: "recovery",
    name: "Recovery Agent",
    role: "Analyseert incidenten en stelt concreet herstel voor.",
    capabilities: [
      { action: "monitoring.analyze", maxRisk: "green" },
      { action: "consumer.pause", maxRisk: "orange" },
      { action: "integration.run", maxRisk: "orange" }
    ]
  },
  {
    id: "optimization",
    name: "Optimization Agent",
    role: "Zoekt verbeteringen in performance, kosten en architectuur.",
    capabilities: [{ action: "read.metrics", maxRisk: "green" }, { action: "config.update", maxRisk: "orange" }]
  },
  {
    id: "documentation",
    name: "Documentation Agent",
    role: "Genereert technische en functionele documentatie.",
    capabilities: [{ action: "docs.generate", maxRisk: "green" }]
  }
];
