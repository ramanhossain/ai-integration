// Plugin-framework: elke connector (Google Sheets, Slack, Salesforce, …) is een declaratieve
// definitie van de publieke API van die dienst. Eén generieke stap "connector" voert elke
// operatie uit; de GUI, de API en MCP lezen dezelfde definities (machine-leesbaar).
// Eigen implementatie op de publieke API's van de diensten.

export type FieldType = "string" | "number" | "boolean" | "json" | "text" | "select";

export interface FieldDef {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  default?: string;
}

// Authenticatie. Waarden komen uit een koppeling (credential) per omgeving.
export type AuthDef =
  | { type: "none" }
  | { type: "bearer"; label?: string; prefix?: string; help?: string } // veld: token
  | { type: "basic"; userLabel?: string; passLabel?: string; help?: string } // velden: user, password
  | { type: "apiKey"; in: "header" | "query"; name: string; prefix?: string; label?: string; help?: string } // veld: apiKey
  | { type: "headers"; headers: Record<string, string>; fields: FieldDef[]; help?: string } // headers met {{veld}}-templates
  | { type: "query"; query: Record<string, string>; fields: FieldDef[]; help?: string } // queryparameters met {{veld}}
  | {
      type: "oauth2"; // authorization code (gebruiker logt in bij de dienst)
      authUrl: string;
      tokenUrl: string;
      scopes: string[];
      scopeSeparator?: string;
      authParams?: Record<string, string>;
      tokenAuth?: "body" | "basic";
      help?: string;
    }
  | { type: "oauth2-client"; tokenUrl: string; scopes?: string[]; tokenAuth?: "body" | "basic"; help?: string } // client credentials
  | { type: "aws"; service: string; help?: string } // AWS Signature V4 (velden: accessKeyId, secretAccessKey, region)
  | { type: "custom"; signer: string; fields: FieldDef[]; help?: string }; // eigen ondertekening/sessie (zie signers.ts)

export interface ParamDef {
  name: string; // voor body-parameters mag een pad met punten ("fields.summary")
  label: string;
  in?: "path" | "query" | "body" | "header" | "rawQuery" | "template"; // rawQuery: "a=eq.1&b=gt.2" letterlijk toevoegen; template: alleen voor {{…}} in basis-URL/headers/body-sjabloon
  format?: "adf" | "list" | "raw"; // adf: tekst -> Atlassian Document Format; list: "a,b" -> ["a","b"]; raw: pad niet coderen
  type?: FieldType;
  required?: boolean;
  options?: string[];
  default?: unknown;
  placeholder?: string;
  help?: string;
}

export interface OperationDef {
  id: string; // bv. "message.send"
  resource: string; // bv. "Bericht"
  label: string; // bv. "Bericht versturen"
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "PROPFIND" | "MKCOL" | "MOVE" | "COPY";
  path: string; // bv. "/chat.postMessage" of "/repos/{{owner}}/{{repo}}/issues"
  params?: ParamDef[];
  bodyType?: "json" | "form"; // standaard json
  body?: unknown; // vaste body (met {{param}}-templates); anders uit body-params
  bodyParam?: string; // param (type json) die de volledige body is
  output?: string; // pad in het antwoord dat de uitkomst is (bv. "items")
  description?: string;
  baseUrl?: string; // afwijkende basis-URL voor deze operatie
  special?: "gmail-raw"; // speciale opbouw van de body
  driver?: string; // geen HTTP: uitvoeren via een driver (zie drivers.ts), bv. "mysql.query"
  transform?: "sheet-rows" | "feed"; // uitkomst omzetten (sheet-rows: eerste rij = kolomnamen; feed: RSS/Atom -> items)
  headers?: Record<string, string>; // extra headers voor deze operatie (mag {{param}} en {{veld}} bevatten)
  contentType?: string; // afwijkend content-type (bv. application/x-amz-json-1.0)
  target?: string; // AWS: X-Amz-Target header
}

export interface PluginDef {
  id: string;
  name: string;
  category: string;
  description: string;
  website?: string;
  docs?: string;
  color?: string;
  baseUrl: string; // mag {{veld}} uit de koppeling bevatten, bv. https://{{subdomain}}.zendesk.com/api/v2
  auth: AuthDef;
  fields?: FieldDef[]; // extra koppelingsvelden (subdomein, regio, instance-URL, …)
  headers?: Record<string, string>; // vaste headers (mag {{veld}} bevatten)
  operations: OperationDef[];
  test?: string; // operatie-id om de koppeling te testen (zonder parameters)
  errorPath?: string; // waar in een foutantwoord de melding staat
  okField?: string; // veld dat false is bij een fout (bv. Slack "ok")
  graphqlErrors?: boolean; // GraphQL: 200 met "errors" is ook een fout
  tokenFields?: Record<string, string>; // OAuth: extra velden uit het tokenantwoord bewaren (bv. instance_url -> instanceUrl)
}

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  website?: string;
  hasTrigger?: boolean;
}
