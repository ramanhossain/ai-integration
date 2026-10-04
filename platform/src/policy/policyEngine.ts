import type { Action, RiskLevel } from "../domain/types";

// Policy engine: bepaalt het risiconiveau van een actie.
// GREEN  -> autonoom, geen goedkeuring
// ORANGE -> voorstel, 1 goedkeurder
// RED    -> verplicht, 2 verschillende goedkeurders binnen een tijdslot (4-ogen)
//
// Regels worden op volgorde geëvalueerd; de eerste match wint. Losstaand en
// data-gedreven zodat ze later uit config/Git geladen kunnen worden.

export interface PolicyRule {
  match: RegExp;
  level: RiskLevel;
  reason: string;
  prod?: RiskLevel; // niveau als het doel PROD is
}

export interface PolicyConfig {
  rules: PolicyRule[];
  default: RiskLevel;
  // Productie verhoogt het niveau altijd naar minimaal ORANGE.
  productionFloor: RiskLevel;
}

export const defaultPolicy: PolicyConfig = {
  default: "orange",
  productionFloor: "orange",
  rules: [
    { match: /^read\./, level: "green", reason: "Alleen-lezen actie." },
    { match: /^(docs|documentation)\./, level: "green", reason: "Documentatie genereren." },
    { match: /^test\.(run|generate)$/, level: "green", reason: "Tests draaien tegen niet-productie." },
    { match: /^monitoring\./, level: "green", reason: "Monitoring en analyse." },
    { match: /^mapping\.propose$/, level: "green", reason: "Voorstel zonder wijziging." },

    { match: /^deploy\.dev$/, level: "green", reason: "Bouwen op DEV." },
    { match: /^integration\.run$/, level: "green", reason: "Uitvoeren van een gedeployede integratie." },

    { match: /^mapping\.update$/, level: "orange", reason: "Wijzigt een mapping." },
    { match: /^config\.update$/, level: "orange", reason: "Wijzigt configuratie." },
    { match: /^infra\.plan$/, level: "orange", reason: "Infra-plan, nog geen apply." },
    { match: /^scale\./, level: "orange", reason: "Schaalt resources." },
    { match: /^deploy\.test$/, level: "orange", reason: "Deploy naar TEST." },
    { match: /^deploy\.acc$/, level: "orange", reason: "Deploy naar Acceptatie." },

    { match: /^deployment\.targets$/, level: "orange", prod: "red", reason: "Wijzigt waar een proces draait (omgevingsvarianten)." },
    { match: /^integration\.delete$/, level: "orange", prod: "red", reason: "Verwijdert een proces dat gedeployed is." },
    { match: /^deploy\.(prod|production)$/, level: "red", reason: "Productie-deployment." },
    { match: /^api\.deploy$/, level: "orange", prod: "red", reason: "API (specificatie) naar een omgeving deployen." },
    { match: /^db\./, level: "red", reason: "Databasewijziging." },
    { match: /^secret\./, level: "red", reason: "Secrets/credentials." },
    { match: /^(iam|firewall)\./, level: "red", reason: "Toegang/netwerk." },
    { match: /\.destroy$|^destructive\./, level: "red", reason: "Destructieve actie." },
    { match: /^security\.active_test$/, level: "red", reason: "Actieve securitytest." },
    { match: /^infra\.apply$/, level: "red", reason: "Infra apply." }
  ]
};

const order: Record<RiskLevel, number> = { green: 0, orange: 1, red: 2 };

function raise(a: RiskLevel, b: RiskLevel): RiskLevel {
  return order[a] >= order[b] ? a : b;
}

export interface PolicyDecision {
  level: RiskLevel;
  reason: string;
}

export function evaluate(action: Action, policy: PolicyConfig = defaultPolicy): PolicyDecision {
  let decision: PolicyDecision = { level: policy.default, reason: "Standaardniveau (geen regel gematcht)." };

  for (const rule of policy.rules) {
    if (rule.match.test(action.type)) {
      decision = { level: action.target?.environment === "prod" && rule.prod ? rule.prod : rule.level, reason: rule.reason };
      break;
    }
  }

  // Productie kan het niveau verhogen, nooit verlagen.
  if (action.target?.environment === "prod" && decision.level === "green") {
    decision = { level: policy.productionFloor, reason: `${decision.reason} Verhoogd wegens productie.` };
  }

  return decision;
}
