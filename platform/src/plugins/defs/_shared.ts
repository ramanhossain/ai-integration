import type { AuthDef, FieldDef, ParamDef } from "../types";

// Korte notaties voor parameters in de definities.
export const P = (name: string, label: string, o: Partial<ParamDef> = {}): ParamDef => ({ name, label, in: "body", ...o });
export const path = (name: string, label: string, o: Partial<ParamDef> = {}): ParamDef => ({ name, label, in: "path", required: true, ...o });
export const q = (name: string, label: string, o: Partial<ParamDef> = {}): ParamDef => ({ name, label, in: "query", ...o });
export const json = (name: string, label: string, o: Partial<ParamDef> = {}): ParamDef => ({ name, label, in: "body", type: "json", ...o });
export const num = (name: string, label: string, o: Partial<ParamDef> = {}): ParamDef => ({ name, label, in: "body", type: "number", ...o });
export const bool = (name: string, label: string, o: Partial<ParamDef> = {}): ParamDef => ({ name, label, in: "body", type: "boolean", ...o });

// Google (één OAuth-app in Google Cloud Console; redirect-URI zie de koppeling)
export const google = (scopes: string[]): AuthDef => ({
  type: "oauth2",
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes,
  authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  help: "Maak in Google Cloud Console een OAuth-client (type webapplicatie), zet de redirect-URI hieronder erbij en vul Client ID en Client secret in. Klik daarna op Verbinden."
});
export const GS = "https://www.googleapis.com/auth/";

// Microsoft 365 / Graph (app-registratie in Microsoft Entra ID)
export const microsoft = (scopes: string[]): AuthDef => ({
  type: "oauth2",
  authUrl: "https://login.microsoftonline.com/{{tenant}}/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/{{tenant}}/oauth2/v2.0/token",
  scopes: [...scopes, "offline_access"],
  help: "Registreer een app in Microsoft Entra ID (Azure AD), voeg de redirect-URI hieronder toe (Web), maak een client secret en geef de gedelegeerde rechten. Tenant: 'common' of je tenant-id."
});
export const TENANT: FieldDef = { key: "tenant", label: "Tenant", default: "common", placeholder: "common of tenant-id" };
export const GRAPH = "https://graph.microsoft.com/v1.0";

export const urlField = (label = "Adres (URL)", placeholder = "https://…"): FieldDef => ({ key: "url", label, placeholder });
