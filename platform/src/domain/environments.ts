import type { RiskLevel } from "./types";

// De vaste omgevingsketen. Elke integratie ontstaat op DEV en promoveert stap voor
// stap naar TEST, ACC en PROD. Je kunt niet overslaan: promotie kan alleen naar de
// eerstvolgende omgeving.

export const ENVIRONMENTS = ["dev", "test", "acc", "prod"] as const;
export type EnvName = (typeof ENVIRONMENTS)[number];

export const ENV_LABELS: Record<EnvName, string> = {
  dev: "Development",
  test: "Test",
  acc: "Acceptatie",
  prod: "Productie"
};

// Risiconiveau van een deploy naar elke omgeving (voedt de policy/approval-laag).
export const ENV_DEPLOY_RISK: Record<EnvName, RiskLevel> = {
  dev: "green", // op DEV bouwen mag autonoom
  test: "orange", // 1 goedkeuring
  acc: "orange", // 1 goedkeuring
  prod: "red" // 4-ogen + tijdslot
};

// Actietype waarmee je naar een omgeving deployt.
export const ENV_DEPLOY_ACTION: Record<EnvName, string> = {
  dev: "deploy.dev",
  test: "deploy.test",
  acc: "deploy.acc",
  prod: "deploy.prod"
};

export function envIndex(env: EnvName): number {
  return ENVIRONMENTS.indexOf(env);
}

// De omgeving waaruit naar `env` gepromoveerd wordt (de vorige in de keten).
export function sourceEnv(env: EnvName): EnvName | null {
  const i = envIndex(env);
  return i <= 0 ? null : ENVIRONMENTS[i - 1];
}

export function isEnv(v: string): v is EnvName {
  return (ENVIRONMENTS as readonly string[]).includes(v);
}
