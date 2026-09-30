import type { PluginDef } from "../types";
import { P, bool, json, num, path, q, urlField } from "./_shared";

const chat = (model: string) => [
  { id: "chat.ask", resource: "Chat", label: "Vraag stellen", method: "POST" as const, path: "/chat/completions", output: "choices.0.message.content",
    body: { model: "{{model}}", messages: [{ $if: "{{system}}", role: "system", content: "{{system}}" }, { role: "user", content: "{{prompt}}" }], temperature: "{{temperature}}", max_tokens: "{{maxTokens}}" },
    params: [P("prompt", "Vraag / opdracht", { type: "text" as const, required: true }), P("system", "Systeeminstructie", { type: "text" as const }), P("model", "Model", { default: model }), num("temperature", "Temperatuur"), num("maxTokens", "Max. tokens")] },
  { id: "chat.completions", resource: "Chat", label: "Chat (berichtenlijst)", method: "POST" as const, path: "/chat/completions",
    params: [P("model", "Model", { default: model }), json("messages", "Berichten", { required: true, placeholder: '[{"role":"user","content":"Vat samen: {{tekst}}"}]' }), num("temperature", "Temperatuur"), json("response_format", "Antwoordformaat", { placeholder: '{"type":"json_object"}' })] }
];

// AI, data & opslag, content, social media, tijd & HR, beveiliging en overig.
export const MORE: PluginDef[] = [
  // ------------------------------------------------------------ AI
  {
    id: "openai", name: "OpenAI", category: "AI", description: "Chat, embeddings, afbeeldingen en moderatie", color: "#10a37f",
    website: "https://openai.com", docs: "https://platform.openai.com/docs/api-reference",
    baseUrl: "https://api.openai.com/v1", auth: { type: "bearer", label: "API-key" }, test: "models",
    operations: [
      ...chat("gpt-4o-mini"),
      { id: "embedding", resource: "Embedding", label: "Embedding maken", method: "POST", path: "/embeddings", output: "data.0.embedding", params: [P("input", "Tekst", { type: "text", required: true }), P("model", "Model", { default: "text-embedding-3-small" })] },
      { id: "image.generate", resource: "Afbeelding", label: "Afbeelding genereren", method: "POST", path: "/images/generations", output: "data", params: [P("prompt", "Omschrijving", { type: "text", required: true }), P("model", "Model", { default: "gpt-image-1" }), P("size", "Formaat", { default: "1024x1024" })] },
      { id: "moderation", resource: "Moderatie", label: "Tekst modereren", method: "POST", path: "/moderations", output: "results.0", params: [P("input", "Tekst", { type: "text", required: true }), P("model", "Model", { default: "omni-moderation-latest" })] },
      { id: "models", resource: "Model", label: "Modellen", method: "GET", path: "/models", output: "data" }
    ]
  },
  {
    id: "mistral-ai", name: "Mistral AI", category: "AI", description: "Chat-completions en embeddings", color: "#fa520f",
    website: "https://mistral.ai", docs: "https://docs.mistral.ai/api/",
    baseUrl: "https://api.mistral.ai/v1", auth: { type: "bearer", label: "API-key" }, test: "models",
    operations: [...chat("mistral-small-latest"), { id: "embedding", resource: "Embedding", label: "Embeddings", method: "POST", path: "/embeddings", output: "data", params: [P("input", "Teksten", { format: "list", required: true }), P("model", "Model", { default: "mistral-embed" })] }, { id: "models", resource: "Model", label: "Modellen", method: "GET", path: "/models", output: "data" }]
  },
  {
    id: "perplexity", name: "Perplexity", category: "AI", description: "Vragen beantwoorden met bronnen", color: "#20808d",
    website: "https://perplexity.ai", docs: "https://docs.perplexity.ai/api-reference/chat-completions",
    baseUrl: "https://api.perplexity.ai", auth: { type: "bearer", label: "API-key" },
    operations: [
      { id: "ask", resource: "Chat", label: "Vraag met bronnen", method: "POST", path: "/chat/completions", body: { model: "{{model}}", messages: [{ role: "user", content: "{{prompt}}" }] }, params: [P("prompt", "Vraag", { type: "text", required: true }), P("model", "Model", { default: "sonar" })] },
      ...chat("sonar").slice(1)
    ]
  },
  {
    id: "deepl", name: "DeepL", category: "AI", description: "Tekst vertalen", color: "#0f2b46",
    website: "https://deepl.com", docs: "https://developers.deepl.com/docs/api-reference/translate",
    baseUrl: "https://{{host}}/v2", auth: { type: "headers", headers: { Authorization: "DeepL-Auth-Key {{apiKey}}" }, fields: [{ key: "apiKey", label: "API-key", secret: true }] },
    fields: [{ key: "host", label: "API-host", default: "api-free.deepl.com", placeholder: "api.deepl.com voor Pro" }], test: "usage",
    operations: [
      { id: "translate", resource: "Vertaling", label: "Vertalen", method: "POST", path: "/translate", output: "translations", body: { text: ["{{text}}"], target_lang: "{{target}}", source_lang: "{{source}}", formality: "{{formality}}" },
        params: [P("text", "Tekst", { type: "text", required: true }), P("target", "Naar taal", { default: "EN-GB" }), P("source", "Van taal (leeg = detecteren)"), P("formality", "Formeel", { options: ["default", "more", "less", "prefer_more", "prefer_less"] })] },
      { id: "languages", resource: "Taal", label: "Talen", method: "GET", path: "/languages", params: [q("type", "Type", { default: "target" })] },
      { id: "usage", resource: "Account", label: "Verbruik", method: "GET", path: "/usage" }
    ]
  },
  {
    id: "jina-ai", name: "Jina AI", category: "AI", description: "Webpagina's lezen en zoeken voor AI", color: "#009191",
    website: "https://jina.ai", docs: "https://jina.ai/reader",
    baseUrl: "https://r.jina.ai", auth: { type: "bearer", label: "API-key" },
    operations: [
      { id: "reader", resource: "Lezer", label: "Webpagina als tekst", method: "GET", path: "/{{url}}", params: [path("url", "URL", { format: "raw", placeholder: "https://voorbeeld.nl/artikel" })] },
      { id: "search", resource: "Zoeken", label: "Zoeken op het web", method: "GET", baseUrl: "https://s.jina.ai", path: "/{{query}}", params: [path("query", "Zoekvraag")] }
    ]
  },
  {
    id: "mindee", name: "Mindee", category: "AI", description: "Facturen en bonnen uitlezen", color: "#fd3246",
    website: "https://mindee.com", docs: "https://developers.mindee.com/docs",
    baseUrl: "https://api.mindee.net/v1", auth: { type: "headers", headers: { Authorization: "Token {{apiKey}}" }, fields: [{ key: "apiKey", label: "API-key", secret: true }] },
    operations: [
      { id: "invoice.parse", resource: "Document", label: "Factuur uitlezen (URL/base64)", method: "POST", path: "/products/mindee/invoices/v4/predict", output: "document.inference.prediction", params: [P("document", "Document (URL of base64)", { required: true })] },
      { id: "receipt.parse", resource: "Document", label: "Bon uitlezen (URL/base64)", method: "POST", path: "/products/mindee/expense_receipts/v5/predict", output: "document.inference.prediction", params: [P("document", "Document (URL of base64)", { required: true })] }
    ]
  },
  // ------------------------------------------------------------ Data & opslag
  {
    id: "supabase", name: "Supabase", category: "Data & opslag", description: "Rijen in Supabase (Postgres) via de REST-API", color: "#3ecf8e",
    website: "https://supabase.com", docs: "https://supabase.com/docs/guides/api",
    baseUrl: "{{url}}/rest/v1", auth: { type: "headers", headers: { apikey: "{{serviceKey}}", Authorization: "Bearer {{serviceKey}}" }, fields: [{ key: "serviceKey", label: "Service role key (of anon key)", secret: true }] },
    fields: [urlField("Project-URL", "https://xyz.supabase.co")],
    operations: [
      { id: "row.select", resource: "Rij", label: "Rijen lezen", method: "GET", path: "/{{table}}", params: [path("table", "Tabel"), q("select", "Kolommen", { default: "*" }), P("filter", "Filter (PostgREST)", { in: "rawQuery", placeholder: "status=eq.open&order=created_at.desc&limit=50" })] },
      { id: "row.insert", resource: "Rij", label: "Rij(en) toevoegen", method: "POST", path: "/{{table}}", bodyParam: "rows", params: [path("table", "Tabel"), json("rows", "Rij of rijen", { required: true }), P("Prefer", "Antwoord", { in: "header", default: "return=representation" })] },
      { id: "row.upsert", resource: "Rij", label: "Rij(en) upserten", method: "POST", path: "/{{table}}", bodyParam: "rows", params: [path("table", "Tabel"), json("rows", "Rij of rijen", { required: true }), q("on_conflict", "Sleutelkolom(men)"), P("Prefer", "Gedrag", { in: "header", default: "resolution=merge-duplicates,return=representation" })] },
      { id: "row.update", resource: "Rij", label: "Rijen bijwerken", method: "PATCH", path: "/{{table}}", bodyParam: "values", params: [path("table", "Tabel"), P("filter", "Filter (verplicht)", { in: "rawQuery", required: true, placeholder: "id=eq.5" }), json("values", "Nieuwe waarden", { required: true }), P("Prefer", "Antwoord", { in: "header", default: "return=representation" })] },
      { id: "row.delete", resource: "Rij", label: "Rijen verwijderen", method: "DELETE", path: "/{{table}}", params: [path("table", "Tabel"), P("filter", "Filter (verplicht)", { in: "rawQuery", required: true, placeholder: "id=eq.5" })] },
      { id: "rpc", resource: "Functie", label: "Database-functie (RPC)", method: "POST", path: "/rpc/{{fn}}", bodyParam: "args", params: [path("fn", "Functie"), json("args", "Argumenten", { default: {} })] }
    ]
  },
  {
    id: "baserow", name: "Baserow", category: "Data & opslag", description: "Rijen in Baserow-tabellen", color: "#5190ef",
    website: "https://baserow.io", docs: "https://baserow.io/api-docs",
    baseUrl: "{{url}}/api", auth: { type: "headers", headers: { Authorization: "Token {{token}}" }, fields: [{ key: "token", label: "Database-token", secret: true }] }, fields: [{ key: "url", label: "URL", default: "https://api.baserow.io" }],
    operations: [
      { id: "row.list", resource: "Rij", label: "Rijen", method: "GET", path: "/database/rows/table/{{tableId}}/", output: "results", params: [path("tableId", "Tabel-ID"), q("user_field_names", "Veldnamen", { default: "true" }), q("search", "Zoektekst"), q("size", "Aantal", { default: "100" })] },
      { id: "row.get", resource: "Rij", label: "Rij ophalen", method: "GET", path: "/database/rows/table/{{tableId}}/{{rowId}}/", params: [path("tableId", "Tabel-ID"), path("rowId", "Rij-ID"), q("user_field_names", "Veldnamen", { default: "true" })] },
      { id: "row.create", resource: "Rij", label: "Rij maken", method: "POST", path: "/database/rows/table/{{tableId}}/", bodyParam: "fields", params: [path("tableId", "Tabel-ID"), json("fields", "Velden", { required: true }), q("user_field_names", "Veldnamen", { default: "true" })] },
      { id: "row.update", resource: "Rij", label: "Rij bijwerken", method: "PATCH", path: "/database/rows/table/{{tableId}}/{{rowId}}/", bodyParam: "fields", params: [path("tableId", "Tabel-ID"), path("rowId", "Rij-ID"), json("fields", "Velden", { required: true }), q("user_field_names", "Veldnamen", { default: "true" })] },
      { id: "row.delete", resource: "Rij", label: "Rij verwijderen", method: "DELETE", path: "/database/rows/table/{{tableId}}/{{rowId}}/", params: [path("tableId", "Tabel-ID"), path("rowId", "Rij-ID")] }
    ]
  },
  {
    id: "nocodb", name: "NocoDB", category: "Data & opslag", description: "Rijen in NocoDB-tabellen", color: "#3366ff",
    website: "https://nocodb.com", docs: "https://data-apis-v2.nocodb.com",
    baseUrl: "{{url}}/api/v2", auth: { type: "headers", headers: { "xc-token": "{{token}}" }, fields: [{ key: "token", label: "API-token", secret: true }] }, fields: [{ key: "url", label: "URL", default: "https://app.nocodb.com" }],
    operations: [
      { id: "record.list", resource: "Record", label: "Records", method: "GET", path: "/tables/{{tableId}}/records", output: "list", params: [path("tableId", "Tabel-ID"), q("where", "Filter", { placeholder: "(Status,eq,Open)" }), q("limit", "Aantal", { default: "50" })] },
      { id: "record.get", resource: "Record", label: "Record ophalen", method: "GET", path: "/tables/{{tableId}}/records/{{id}}", params: [path("tableId", "Tabel-ID"), path("id", "Record-ID")] },
      { id: "record.create", resource: "Record", label: "Record maken", method: "POST", path: "/tables/{{tableId}}/records", bodyParam: "fields", params: [path("tableId", "Tabel-ID"), json("fields", "Velden", { required: true })] },
      { id: "record.update", resource: "Record", label: "Record bijwerken (met Id)", method: "PATCH", path: "/tables/{{tableId}}/records", bodyParam: "fields", params: [path("tableId", "Tabel-ID"), json("fields", "Velden inclusief Id", { required: true, placeholder: '{"Id":5,"Status":"Klaar"}' })] },
      { id: "record.delete", resource: "Record", label: "Record verwijderen", method: "DELETE", path: "/tables/{{tableId}}/records", body: { Id: "{{id}}" }, params: [path("tableId", "Tabel-ID"), num("id", "Record-ID", { required: true })] }
    ]
  },
  {
    id: "grist", name: "Grist", category: "Data & opslag", description: "Records in Grist-documenten", color: "#16b378",
    website: "https://getgrist.com", docs: "https://support.getgrist.com/api/",
    baseUrl: "{{url}}/api", auth: { type: "bearer", label: "API-key" }, fields: [{ key: "url", label: "URL", default: "https://docs.getgrist.com" }],
    operations: [
      { id: "record.list", resource: "Record", label: "Records", method: "GET", path: "/docs/{{docId}}/tables/{{tableId}}/records", output: "records", params: [path("docId", "Document-ID"), path("tableId", "Tabel"), q("filter", "Filter (JSON)"), q("limit", "Aantal")] },
      { id: "record.add", resource: "Record", label: "Record toevoegen", method: "POST", path: "/docs/{{docId}}/tables/{{tableId}}/records", body: { records: [{ fields: "{{fields}}" }] }, params: [path("docId", "Document-ID"), path("tableId", "Tabel"), json("fields", "Velden", { required: true })] },
      { id: "record.update", resource: "Record", label: "Record bijwerken", method: "PATCH", path: "/docs/{{docId}}/tables/{{tableId}}/records", body: { records: [{ id: "{{id}}", fields: "{{fields}}" }] }, params: [path("docId", "Document-ID"), path("tableId", "Tabel"), num("id", "Record-ID", { required: true }), json("fields", "Velden", { required: true })] }
    ]
  },
  {
    id: "coda", name: "Coda", category: "Productiviteit", description: "Tabellen in Coda-docs", color: "#f46a54",
    website: "https://coda.io", docs: "https://coda.io/developers/apis/v1",
    baseUrl: "https://coda.io/apis/v1", auth: { type: "bearer", label: "API-token" }, test: "whoami",
    operations: [
      { id: "doc.list", resource: "Doc", label: "Docs", method: "GET", path: "/docs", output: "items" },
      { id: "row.list", resource: "Rij", label: "Rijen", method: "GET", path: "/docs/{{docId}}/tables/{{tableId}}/rows", output: "items", params: [path("docId", "Doc-ID"), path("tableId", "Tabel"), q("useColumnNames", "Kolomnamen", { default: "true" }), q("query", "Filter", { placeholder: '"Status":"Open"' })] },
      { id: "row.upsert", resource: "Rij", label: "Rijen toevoegen/upserten", method: "POST", path: "/docs/{{docId}}/tables/{{tableId}}/rows", body: { rows: "{{rows}}", keyColumns: "{{keyColumns}}" }, params: [path("docId", "Doc-ID"), path("tableId", "Tabel"), json("rows", "Rijen", { required: true, placeholder: '[{"cells":[{"column":"Naam","value":"Jan"}]}]' }), P("keyColumns", "Sleutelkolommen", { format: "list" })] },
      { id: "whoami", resource: "Account", label: "Mijn account", method: "GET", path: "/whoami" }
    ]
  },
  {
    id: "quickbase", name: "Quickbase", category: "Data & opslag", description: "Records en velden", color: "#74489d",
    website: "https://quickbase.com", docs: "https://developer.quickbase.com",
    baseUrl: "https://api.quickbase.com/v1", auth: { type: "headers", headers: { "QB-Realm-Hostname": "{{realm}}", Authorization: "QB-USER-TOKEN {{userToken}}" }, fields: [{ key: "realm", label: "Realm-host", placeholder: "bedrijf.quickbase.com" }, { key: "userToken", label: "User token", secret: true }] },
    operations: [
      { id: "record.query", resource: "Record", label: "Records opvragen", method: "POST", path: "/records/query", output: "data", params: [P("from", "Tabel-ID", { required: true }), P("select", "Velden (ID's)", { format: "list", type: "number" }), P("where", "Filter", { placeholder: "{6.EX.'Open'}" })] },
      { id: "record.upsert", resource: "Record", label: "Records toevoegen/bijwerken", method: "POST", path: "/records", params: [P("to", "Tabel-ID", { required: true }), json("data", "Records", { required: true, placeholder: '[{"6":{"value":"Jan"}}]' })] }
    ]
  },
  {
    id: "elasticsearch", name: "Elasticsearch", category: "Data & opslag", description: "Documenten indexeren en zoeken", color: "#00bfb3",
    website: "https://elastic.co", docs: "https://www.elastic.co/docs/api/doc/elasticsearch",
    baseUrl: "{{url}}", auth: { type: "headers", headers: { Authorization: "ApiKey {{apiKey}}" }, fields: [{ key: "apiKey", label: "API-key (base64)", secret: true }] }, fields: [urlField("Cluster-URL")], test: "info",
    operations: [
      { id: "document.index", resource: "Document", label: "Document indexeren", method: "POST", path: "/{{index}}/_doc", bodyParam: "document", params: [path("index", "Index"), json("document", "Document", { required: true })] },
      { id: "document.put", resource: "Document", label: "Document met ID opslaan", method: "PUT", path: "/{{index}}/_doc/{{id}}", bodyParam: "document", params: [path("index", "Index"), path("id", "ID"), json("document", "Document", { required: true })] },
      { id: "document.get", resource: "Document", label: "Document ophalen", method: "GET", path: "/{{index}}/_doc/{{id}}", params: [path("index", "Index"), path("id", "ID")] },
      { id: "search", resource: "Zoeken", label: "Zoeken", method: "POST", path: "/{{index}}/_search", output: "hits.hits", body: { query: "{{query}}", size: "{{size}}" }, params: [path("index", "Index"), json("query", "Query", { required: true, placeholder: '{"match":{"klant":"Jansen"}}' }), num("size", "Aantal", { default: 20 })] },
      { id: "document.delete", resource: "Document", label: "Document verwijderen", method: "DELETE", path: "/{{index}}/_doc/{{id}}", params: [path("index", "Index"), path("id", "ID")] },
      { id: "info", resource: "Cluster", label: "Clusterinfo", method: "GET", path: "/" }
    ]
  },
  {
    id: "dropbox", name: "Dropbox", category: "Bestanden", description: "Bestanden en mappen", color: "#0061ff",
    website: "https://dropbox.com", docs: "https://www.dropbox.com/developers/documentation/http/documentation",
    baseUrl: "https://api.dropboxapi.com/2",
    auth: { type: "oauth2", authUrl: "https://www.dropbox.com/oauth2/authorize", tokenUrl: "https://api.dropboxapi.com/oauth2/token", scopes: ["files.metadata.read", "files.content.write", "files.content.read", "sharing.write", "account_info.read"], authParams: { token_access_type: "offline" } }, test: "account",
    operations: [
      { id: "folder.list", resource: "Map", label: "Inhoud van map", method: "POST", path: "/files/list_folder", output: "entries", params: [P("path", "Pad (leeg = root)", { default: "" }), bool("recursive", "Recursief", { default: false }), num("limit", "Aantal", { default: 200 })] },
      { id: "folder.create", resource: "Map", label: "Map maken", method: "POST", path: "/files/create_folder_v2", params: [P("path", "Pad", { required: true, placeholder: "/Facturen/2026" }), bool("autorename", "Hernoemen bij bestaan", { default: false })] },
      { id: "file.move", resource: "Bestand", label: "Verplaatsen/hernoemen", method: "POST", path: "/files/move_v2", params: [P("from_path", "Van", { required: true }), P("to_path", "Naar", { required: true })] },
      { id: "file.copy", resource: "Bestand", label: "Kopiëren", method: "POST", path: "/files/copy_v2", params: [P("from_path", "Van", { required: true }), P("to_path", "Naar", { required: true })] },
      { id: "file.delete", resource: "Bestand", label: "Verwijderen", method: "POST", path: "/files/delete_v2", params: [P("path", "Pad", { required: true })] },
      { id: "file.search", resource: "Bestand", label: "Zoeken", method: "POST", path: "/files/search_v2", output: "matches", params: [P("query", "Zoektekst", { required: true })] },
      { id: "link.create", resource: "Deellink", label: "Deellink maken", method: "POST", path: "/sharing/create_shared_link_with_settings", params: [P("path", "Pad", { required: true })] },
      { id: "account", resource: "Account", label: "Mijn account", method: "POST", path: "/users/get_current_account" }
    ]
  },
  {
    id: "box", name: "Box", category: "Bestanden", description: "Bestanden en mappen", color: "#0061d5",
    website: "https://box.com", docs: "https://developer.box.com/reference/",
    baseUrl: "https://api.box.com/2.0", auth: { type: "oauth2", authUrl: "https://account.box.com/api/oauth2/authorize", tokenUrl: "https://api.box.com/oauth2/token", scopes: [] }, test: "me",
    operations: [
      { id: "folder.items", resource: "Map", label: "Inhoud van map", method: "GET", path: "/folders/{{folderId}}/items", output: "entries", params: [path("folderId", "Map-ID", { default: "0" })] },
      { id: "folder.create", resource: "Map", label: "Map maken", method: "POST", path: "/folders", body: { name: "{{name}}", parent: { id: "{{parentId}}" } }, params: [P("name", "Naam", { required: true }), P("parentId", "Bovenliggende map-ID", { default: "0" })] },
      { id: "file.get", resource: "Bestand", label: "Bestandsinfo", method: "GET", path: "/files/{{fileId}}", params: [path("fileId", "Bestand-ID")] },
      { id: "file.delete", resource: "Bestand", label: "Bestand verwijderen", method: "DELETE", path: "/files/{{fileId}}", params: [path("fileId", "Bestand-ID")] },
      { id: "search", resource: "Zoeken", label: "Zoeken", method: "GET", path: "/search", output: "entries", params: [q("query", "Zoektekst", { required: true })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me" }
    ]
  },
  // ------------------------------------------------------------ Content & CMS
  {
    id: "wordpress", name: "WordPress", category: "Content & CMS", description: "Posts, pagina's en gebruikers", color: "#21759b",
    website: "https://wordpress.org", docs: "https://developer.wordpress.org/rest-api/reference/",
    baseUrl: "{{url}}/wp-json/wp/v2", auth: { type: "basic", userLabel: "Gebruiker", passLabel: "Application password" }, fields: [urlField("Site-URL")], test: "me",
    operations: [
      { id: "post.create", resource: "Post", label: "Post maken", method: "POST", path: "/posts", params: [P("title", "Titel", { required: true }), P("content", "Inhoud (HTML)", { type: "text" }), P("excerpt", "Samenvatting"), P("status", "Status", { default: "draft", options: ["draft", "publish", "pending", "private"] }), P("categories", "Categorie-ID's", { format: "list", type: "number" }), P("tags", "Tag-ID's", { format: "list", type: "number" })] },
      { id: "post.update", resource: "Post", label: "Post bijwerken", method: "POST", path: "/posts/{{id}}", params: [path("id", "Post-ID"), P("title", "Titel"), P("content", "Inhoud", { type: "text" }), P("status", "Status", { options: ["draft", "publish", "pending", "private"] })] },
      { id: "post.list", resource: "Post", label: "Posts", method: "GET", path: "/posts", params: [q("search", "Zoektekst"), q("status", "Status", { default: "publish" }), q("per_page", "Aantal", { default: "10" })] },
      { id: "post.get", resource: "Post", label: "Post ophalen", method: "GET", path: "/posts/{{id}}", params: [path("id", "Post-ID")] },
      { id: "post.delete", resource: "Post", label: "Post verwijderen", method: "DELETE", path: "/posts/{{id}}", params: [path("id", "Post-ID"), q("force", "Definitief", { default: "false" })] },
      { id: "page.create", resource: "Pagina", label: "Pagina maken", method: "POST", path: "/pages", params: [P("title", "Titel", { required: true }), P("content", "Inhoud (HTML)", { type: "text" }), P("status", "Status", { default: "draft" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me" }
    ]
  },
  {
    id: "webflow", name: "Webflow", category: "Content & CMS", description: "CMS-items en sites", color: "#4353ff",
    website: "https://webflow.com", docs: "https://developers.webflow.com/data/reference",
    baseUrl: "https://api.webflow.com/v2", auth: { type: "bearer", label: "Site-token" }, test: "site.list",
    operations: [
      { id: "site.list", resource: "Site", label: "Sites", method: "GET", path: "/sites", output: "sites" },
      { id: "collection.list", resource: "Collectie", label: "Collecties", method: "GET", path: "/sites/{{siteId}}/collections", output: "collections", params: [path("siteId", "Site-ID")] },
      { id: "item.list", resource: "Item", label: "Items", method: "GET", path: "/collections/{{collectionId}}/items", output: "items", params: [path("collectionId", "Collectie-ID")] },
      { id: "item.create", resource: "Item", label: "Item maken", method: "POST", path: "/collections/{{collectionId}}/items", params: [path("collectionId", "Collectie-ID"), json("fieldData", "Velden", { required: true, placeholder: '{"name":"Titel","slug":"titel"}' }), bool("isDraft", "Concept", { default: true })] },
      { id: "item.update", resource: "Item", label: "Item bijwerken", method: "PATCH", path: "/collections/{{collectionId}}/items/{{itemId}}", params: [path("collectionId", "Collectie-ID"), path("itemId", "Item-ID"), json("fieldData", "Velden", { required: true })] },
      { id: "site.publish", resource: "Site", label: "Site publiceren", method: "POST", path: "/sites/{{siteId}}/publish", params: [path("siteId", "Site-ID"), bool("publishToWebflowSubdomain", "Op webflow.io", { default: true })] }
    ]
  },
  {
    id: "contentful", name: "Contentful", category: "Content & CMS", description: "Entries en assets (Delivery API)", color: "#2478cc",
    website: "https://contentful.com", docs: "https://www.contentful.com/developers/docs/references/content-delivery-api/",
    baseUrl: "https://cdn.contentful.com/spaces/{{spaceId}}/environments/{{environment}}", auth: { type: "bearer", label: "Content Delivery-token" },
    fields: [{ key: "spaceId", label: "Space-ID" }, { key: "environment", label: "Environment", default: "master" }],
    operations: [
      { id: "entry.list", resource: "Entry", label: "Entries", method: "GET", path: "/entries", output: "items", params: [q("content_type", "Contenttype"), q("limit", "Aantal", { default: "100" }), q("locale", "Taal")] },
      { id: "entry.get", resource: "Entry", label: "Entry ophalen", method: "GET", path: "/entries/{{id}}", params: [path("id", "Entry-ID")] },
      { id: "asset.list", resource: "Asset", label: "Assets", method: "GET", path: "/assets", output: "items" }
    ]
  },
  {
    id: "strapi", name: "Strapi", category: "Content & CMS", description: "Entries (headless CMS, v4/v5)", color: "#4945ff",
    website: "https://strapi.io", docs: "https://docs.strapi.io/dev-docs/api/rest",
    baseUrl: "{{url}}/api", auth: { type: "bearer", label: "API-token" }, fields: [urlField("Strapi-URL")],
    operations: [
      { id: "entry.list", resource: "Entry", label: "Entries", method: "GET", path: "/{{collection}}", output: "data", params: [path("collection", "Collectie (meervoud)", { placeholder: "articles" }), P("query", "Filters", { in: "rawQuery", placeholder: "filters[slug][$eq]=hallo&populate=*" })] },
      { id: "entry.get", resource: "Entry", label: "Entry ophalen", method: "GET", path: "/{{collection}}/{{id}}", output: "data", params: [path("collection", "Collectie"), path("id", "ID")] },
      { id: "entry.create", resource: "Entry", label: "Entry maken", method: "POST", path: "/{{collection}}", output: "data", body: { data: "{{data}}" }, params: [path("collection", "Collectie"), json("data", "Velden", { required: true })] },
      { id: "entry.update", resource: "Entry", label: "Entry bijwerken", method: "PUT", path: "/{{collection}}/{{id}}", output: "data", body: { data: "{{data}}" }, params: [path("collection", "Collectie"), path("id", "ID"), json("data", "Velden", { required: true })] },
      { id: "entry.delete", resource: "Entry", label: "Entry verwijderen", method: "DELETE", path: "/{{collection}}/{{id}}", params: [path("collection", "Collectie"), path("id", "ID")] }
    ]
  },
  {
    id: "storyblok", name: "Storyblok", category: "Content & CMS", description: "Stories (Content Delivery API)", color: "#09b3af",
    website: "https://storyblok.com", docs: "https://www.storyblok.com/docs/api/content-delivery/v2",
    baseUrl: "https://{{host}}/v2/cdn", auth: { type: "apiKey", in: "query", name: "token", label: "Public/preview-token" }, fields: [{ key: "host", label: "API-host", default: "api.storyblok.com", placeholder: "api-us.storyblok.com" }],
    operations: [
      { id: "story.list", resource: "Story", label: "Stories", method: "GET", path: "/stories", output: "stories", params: [q("starts_with", "Map"), q("version", "Versie", { default: "published", options: ["published", "draft"] }), q("per_page", "Aantal", { default: "25" })] },
      { id: "story.get", resource: "Story", label: "Story ophalen", method: "GET", path: "/stories/{{slug}}", output: "story", params: [path("slug", "Slug", { format: "raw" }), q("version", "Versie", { default: "published" })] }
    ]
  },
  {
    id: "bannerbear", name: "Bannerbear", category: "Content & CMS", description: "Afbeeldingen genereren uit templates", color: "#1d1d1f",
    website: "https://bannerbear.com", docs: "https://developers.bannerbear.com",
    baseUrl: "https://api.bannerbear.com/v2", auth: { type: "bearer", label: "API-key" }, test: "template.list",
    operations: [
      { id: "image.create", resource: "Afbeelding", label: "Afbeelding maken", method: "POST", path: "/images", params: [P("template", "Template-ID", { required: true }), json("modifications", "Aanpassingen", { required: true, placeholder: '[{"name":"titel","text":"{{titel}}"}]' }), P("webhook_url", "Webhook bij klaar")] },
      { id: "image.get", resource: "Afbeelding", label: "Afbeelding ophalen", method: "GET", path: "/images/{{uid}}", params: [path("uid", "Afbeelding-UID")] },
      { id: "template.list", resource: "Template", label: "Templates", method: "GET", path: "/templates" }
    ]
  },
  {
    id: "apitemplate-io", name: "APITemplate.io", category: "Content & CMS", description: "PDF's en afbeeldingen uit templates", color: "#5b3cc4",
    website: "https://apitemplate.io", docs: "https://apitemplate.io/apiv2/",
    baseUrl: "https://{{host}}/v2", auth: { type: "apiKey", in: "header", name: "X-API-KEY", label: "API-key" }, fields: [{ key: "host", label: "API-host", default: "rest.apitemplate.io", placeholder: "rest-de.apitemplate.io (EU)" }], test: "template.list",
    operations: [
      { id: "pdf.create", resource: "PDF", label: "PDF maken", method: "POST", path: "/create-pdf", bodyParam: "data", params: [q("template_id", "Template-ID", { required: true }), json("data", "Data", { required: true })] },
      { id: "image.create", resource: "Afbeelding", label: "Afbeelding maken", method: "POST", path: "/create-image", bodyParam: "data", params: [q("template_id", "Template-ID", { required: true }), json("data", "Data", { required: true })] },
      { id: "template.list", resource: "Template", label: "Templates", method: "GET", path: "/list-templates", output: "templates" }
    ]
  },
  // ------------------------------------------------------------ Social media
  {
    id: "facebook-graph", name: "Facebook Graph API", category: "Social media", description: "Pagina's, posts en objecten via de Graph API", color: "#1877f2",
    website: "https://developers.facebook.com", docs: "https://developers.facebook.com/docs/graph-api/reference",
    baseUrl: "https://graph.facebook.com/{{version}}", auth: { type: "bearer", label: "Access token (pagina- of systeemgebruiker)" }, fields: [{ key: "version", label: "API-versie", default: "v21.0" }], test: "me",
    operations: [
      { id: "page.post", resource: "Pagina", label: "Post op pagina", method: "POST", path: "/{{pageId}}/feed", params: [path("pageId", "Pagina-ID"), P("message", "Tekst", { type: "text", required: true }), P("link", "Link"), bool("published", "Direct publiceren", { default: true })] },
      { id: "page.photo", resource: "Pagina", label: "Foto posten (URL)", method: "POST", path: "/{{pageId}}/photos", params: [path("pageId", "Pagina-ID"), P("url", "Foto-URL", { required: true }), P("caption", "Bijschrift")] },
      { id: "page.posts", resource: "Pagina", label: "Posts van pagina", method: "GET", path: "/{{pageId}}/posts", output: "data", params: [path("pageId", "Pagina-ID"), q("fields", "Velden", { default: "id,message,created_time,permalink_url" }), q("limit", "Aantal", { default: "25" })] },
      { id: "node.get", resource: "Object", label: "Object ophalen", method: "GET", path: "/{{node}}", params: [path("node", "Node-ID of pad", { format: "raw" }), q("fields", "Velden")] },
      { id: "edge.get", resource: "Object", label: "Relatie (edge) ophalen", method: "GET", path: "/{{node}}/{{edge}}", output: "data", params: [path("node", "Node-ID"), path("edge", "Edge", { placeholder: "posts, comments, insights" }), q("fields", "Velden"), q("limit", "Aantal", { default: "25" })] },
      { id: "edge.post", resource: "Object", label: "Relatie aanmaken (POST)", method: "POST", path: "/{{node}}/{{edge}}", bodyParam: "data", params: [path("node", "Node-ID"), path("edge", "Edge"), json("data", "Data", { required: true })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/me" }
    ]
  },
  {
    id: "linkedin", name: "LinkedIn", category: "Social media", description: "Posts plaatsen", color: "#0a66c2",
    website: "https://linkedin.com", docs: "https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api",
    baseUrl: "https://api.linkedin.com", auth: { type: "oauth2", authUrl: "https://www.linkedin.com/oauth/v2/authorization", tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken", scopes: ["openid", "profile", "email", "w_member_social"] },
    headers: { "LinkedIn-Version": "202409", "X-Restli-Protocol-Version": "2.0.0" }, test: "userinfo",
    operations: [
      { id: "post.create", resource: "Post", label: "Post plaatsen", method: "POST", path: "/rest/posts", body: { author: "{{author}}", commentary: "{{text}}", visibility: "{{visibility}}", distribution: { feedDistribution: "MAIN_FEED" }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false },
        params: [P("author", "Auteur (urn:li:person:… of urn:li:organization:…)", { required: true }), P("text", "Tekst", { type: "text", required: true }), P("visibility", "Zichtbaarheid", { default: "PUBLIC", options: ["PUBLIC", "CONNECTIONS"] })] },
      { id: "userinfo", resource: "Account", label: "Mijn profiel (sub = persoons-ID)", method: "GET", path: "/v2/userinfo" }
    ]
  },
  {
    id: "x-twitter", name: "X (Twitter)", category: "Social media", description: "Posts plaatsen, zoeken en verwijderen (API v2)", color: "#000000",
    website: "https://x.com", docs: "https://docs.x.com/x-api/introduction",
    baseUrl: "https://api.x.com/2", auth: { type: "bearer", label: "User access token (OAuth 2.0) of app-token (alleen lezen)" }, test: "me",
    operations: [
      { id: "post.create", resource: "Post", label: "Post plaatsen", method: "POST", path: "/tweets", params: [P("text", "Tekst", { type: "text", required: true }), P("reply.in_reply_to_tweet_id", "Antwoord op (ID)")] },
      { id: "post.delete", resource: "Post", label: "Post verwijderen", method: "DELETE", path: "/tweets/{{id}}", params: [path("id", "Post-ID")] },
      { id: "post.search", resource: "Post", label: "Recente posts zoeken", method: "GET", path: "/tweets/search/recent", output: "data", params: [q("query", "Zoekvraag", { required: true }), q("max_results", "Aantal (10-100)", { default: "10" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me", output: "data" }
    ]
  },
  {
    id: "reddit", name: "Reddit", category: "Social media", description: "Posts en reacties", color: "#ff4500",
    website: "https://reddit.com", docs: "https://www.reddit.com/dev/api/",
    baseUrl: "https://oauth.reddit.com", auth: { type: "oauth2", authUrl: "https://www.reddit.com/api/v1/authorize", tokenUrl: "https://www.reddit.com/api/v1/access_token", tokenAuth: "basic", scopes: ["identity", "submit", "read"], authParams: { duration: "permanent" } }, test: "me",
    operations: [
      { id: "post.submit", resource: "Post", label: "Post plaatsen", method: "POST", path: "/api/submit", bodyType: "form", params: [P("sr", "Subreddit", { required: true }), P("title", "Titel", { required: true }), P("kind", "Soort", { default: "self", options: ["self", "link"] }), P("text", "Tekst", { type: "text" }), P("url", "Link")] },
      { id: "subreddit.new", resource: "Subreddit", label: "Nieuwe posts", method: "GET", path: "/r/{{subreddit}}/new", output: "data.children", params: [path("subreddit", "Subreddit"), q("limit", "Aantal", { default: "25" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/api/v1/me" }
    ]
  },
  {
    id: "spotify", name: "Spotify", category: "Overig", description: "Afspeellijsten en nummers", color: "#1db954",
    website: "https://spotify.com", docs: "https://developer.spotify.com/documentation/web-api",
    baseUrl: "https://api.spotify.com/v1", auth: { type: "oauth2", authUrl: "https://accounts.spotify.com/authorize", tokenUrl: "https://accounts.spotify.com/api/token", tokenAuth: "basic", scopes: ["playlist-modify-private", "playlist-modify-public", "playlist-read-private", "user-read-email"] }, test: "me",
    operations: [
      { id: "search", resource: "Zoeken", label: "Zoeken", method: "GET", path: "/search", params: [q("q", "Zoektekst", { required: true }), q("type", "Type", { default: "track" }), q("limit", "Aantal", { default: "10" })] },
      { id: "playlist.list", resource: "Afspeellijst", label: "Mijn afspeellijsten", method: "GET", path: "/me/playlists", output: "items" },
      { id: "playlist.add", resource: "Afspeellijst", label: "Nummers toevoegen", method: "POST", path: "/playlists/{{playlistId}}/tracks", params: [path("playlistId", "Afspeellijst-ID"), P("uris", "Spotify-URI's", { format: "list", required: true, placeholder: "spotify:track:…" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/me" }
    ]
  },
  {
    id: "strava", name: "Strava", category: "Overig", description: "Activiteiten", color: "#fc4c02",
    website: "https://strava.com", docs: "https://developers.strava.com/docs/reference/",
    baseUrl: "https://www.strava.com/api/v3", auth: { type: "oauth2", authUrl: "https://www.strava.com/oauth/authorize", tokenUrl: "https://www.strava.com/oauth/token", scopes: ["read", "activity:read_all"], scopeSeparator: "," }, test: "athlete",
    operations: [
      { id: "activity.list", resource: "Activiteit", label: "Mijn activiteiten", method: "GET", path: "/athlete/activities", params: [q("per_page", "Aantal", { default: "30" }), q("after", "Na (epoch)")] },
      { id: "activity.get", resource: "Activiteit", label: "Activiteit ophalen", method: "GET", path: "/activities/{{id}}", params: [path("id", "Activiteit-ID")] },
      { id: "athlete", resource: "Account", label: "Mijn profiel", method: "GET", path: "/athlete" }
    ]
  },
  // ------------------------------------------------------------ Tijd, HR en vergaderen
  {
    id: "zoom", name: "Zoom", category: "Communicatie", description: "Vergaderingen plannen en beheren", color: "#0b5cff",
    website: "https://zoom.us", docs: "https://developers.zoom.us/docs/api/",
    baseUrl: "https://api.zoom.us/v2", auth: { type: "oauth2", authUrl: "https://zoom.us/oauth/authorize", tokenUrl: "https://zoom.us/oauth/token", tokenAuth: "basic", scopes: [] }, test: "me",
    operations: [
      { id: "meeting.create", resource: "Vergadering", label: "Vergadering plannen", method: "POST", path: "/users/me/meetings", params: [P("topic", "Onderwerp", { required: true }), num("type", "Type (2 = gepland)", { default: 2 }), P("start_time", "Start (ISO)", { required: true }), num("duration", "Duur (min)", { default: 30 }), P("timezone", "Tijdzone", { default: "Europe/Amsterdam" }), P("agenda", "Agenda", { type: "text" })] },
      { id: "meeting.list", resource: "Vergadering", label: "Vergaderingen", method: "GET", path: "/users/me/meetings", output: "meetings", params: [q("type", "Type", { default: "upcoming" })] },
      { id: "meeting.get", resource: "Vergadering", label: "Vergadering ophalen", method: "GET", path: "/meetings/{{id}}", params: [path("id", "Vergadering-ID")] },
      { id: "meeting.delete", resource: "Vergadering", label: "Vergadering verwijderen", method: "DELETE", path: "/meetings/{{id}}", params: [path("id", "Vergadering-ID")] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me" }
    ]
  },
  {
    id: "harvest", name: "Harvest", category: "Productiviteit", description: "Tijdregistratie, projecten en facturen", color: "#fa5d00",
    website: "https://getharvest.com", docs: "https://help.getharvest.com/api-v2/",
    baseUrl: "https://api.harvestapp.com/v2", auth: { type: "headers", headers: { Authorization: "Bearer {{token}}", "Harvest-Account-Id": "{{accountId}}" }, fields: [{ key: "token", label: "Personal access token", secret: true }, { key: "accountId", label: "Account-ID" }] }, test: "me",
    operations: [
      { id: "time.list", resource: "Tijd", label: "Tijdregistraties", method: "GET", path: "/time_entries", output: "time_entries", params: [q("from", "Vanaf (JJJJ-MM-DD)"), q("to", "Tot"), q("project_id", "Project-ID")] },
      { id: "time.create", resource: "Tijd", label: "Tijd registreren", method: "POST", path: "/time_entries", params: [num("project_id", "Project-ID", { required: true }), num("task_id", "Taak-ID", { required: true }), P("spent_date", "Datum", { required: true }), num("hours", "Uren"), P("notes", "Notitie")] },
      { id: "project.list", resource: "Project", label: "Projecten", method: "GET", path: "/projects", output: "projects", params: [q("is_active", "Actief", { default: "true" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me" }
    ]
  },
  {
    id: "clockify", name: "Clockify", category: "Productiviteit", description: "Tijdregistratie en projecten", color: "#03a9f4",
    website: "https://clockify.me", docs: "https://docs.clockify.me",
    baseUrl: "https://api.clockify.me/api/v1", auth: { type: "apiKey", in: "header", name: "X-Api-Key", label: "API-key" }, test: "workspace.list",
    operations: [
      { id: "time.create", resource: "Tijd", label: "Tijd registreren", method: "POST", path: "/workspaces/{{workspaceId}}/time-entries", params: [path("workspaceId", "Workspace-ID"), P("start", "Start (ISO)", { required: true }), P("end", "Einde (ISO)"), P("description", "Omschrijving"), P("projectId", "Project-ID")] },
      { id: "project.list", resource: "Project", label: "Projecten", method: "GET", path: "/workspaces/{{workspaceId}}/projects", params: [path("workspaceId", "Workspace-ID")] },
      { id: "workspace.list", resource: "Workspace", label: "Workspaces", method: "GET", path: "/workspaces" }
    ]
  },
  {
    id: "toggl", name: "Toggl Track", category: "Productiviteit", description: "Tijdregistratie", color: "#e57cd8",
    website: "https://toggl.com", docs: "https://engineering.toggl.com/docs/",
    baseUrl: "https://api.track.toggl.com/api/v9", auth: { type: "basic", userLabel: "API-token", passLabel: "api_token (letterlijk)" }, test: "me",
    operations: [
      { id: "time.list", resource: "Tijd", label: "Mijn tijdregistraties", method: "GET", path: "/me/time_entries", params: [q("start_date", "Vanaf (JJJJ-MM-DD)"), q("end_date", "Tot")] },
      { id: "time.create", resource: "Tijd", label: "Tijd registreren", method: "POST", path: "/workspaces/{{workspaceId}}/time_entries", body: { description: "{{description}}", start: "{{start}}", duration: "{{duration}}", workspace_id: "{{workspaceNum}}", project_id: "{{projectId}}", created_with: "AIP" },
        params: [path("workspaceId", "Workspace-ID"), num("workspaceNum", "Workspace-ID (nogmaals, getal)", { required: true }), P("description", "Omschrijving"), P("start", "Start (ISO)", { required: true }), num("duration", "Duur (seconden)", { required: true }), num("projectId", "Project-ID")] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/me" }
    ]
  },
  {
    id: "bamboohr", name: "BambooHR", category: "HR", description: "Medewerkers en rapporten", color: "#73c41d",
    website: "https://bamboohr.com", docs: "https://documentation.bamboohr.com/reference",
    baseUrl: "https://api.bamboohr.com/api/gateway.php/{{company}}/v1", auth: { type: "basic", userLabel: "API-key", passLabel: "x (willekeurig)" }, fields: [{ key: "company", label: "Bedrijfsdomein", placeholder: "bedrijf (van bedrijf.bamboohr.com)" }], test: "employee.directory",
    operations: [
      { id: "employee.directory", resource: "Medewerker", label: "Medewerkersoverzicht", method: "GET", path: "/employees/directory", output: "employees" },
      { id: "employee.get", resource: "Medewerker", label: "Medewerker ophalen", method: "GET", path: "/employees/{{id}}", params: [path("id", "Medewerker-ID"), q("fields", "Velden", { default: "firstName,lastName,workEmail,jobTitle,department,hireDate" })] },
      { id: "employee.create", resource: "Medewerker", label: "Medewerker toevoegen", method: "POST", path: "/employees", params: [P("firstName", "Voornaam", { required: true }), P("lastName", "Achternaam", { required: true }), P("workEmail", "Werk-e-mail"), P("hireDate", "Startdatum")] },
      { id: "timeoff.list", resource: "Verlof", label: "Verlofaanvragen", method: "GET", path: "/time_off/requests", params: [q("start", "Vanaf", { required: true }), q("end", "Tot", { required: true })] }
    ]
  },
  {
    id: "workable", name: "Workable", category: "HR", description: "Vacatures en kandidaten", color: "#00b2a9",
    website: "https://workable.com", docs: "https://workable.readme.io/reference",
    baseUrl: "https://{{subdomain}}.workable.com/spi/v3", auth: { type: "bearer", label: "API-token" }, fields: [{ key: "subdomain", label: "Subdomein" }], test: "job.list",
    operations: [
      { id: "job.list", resource: "Vacature", label: "Vacatures", method: "GET", path: "/jobs", output: "jobs", params: [q("state", "Status", { default: "published" })] },
      { id: "candidate.list", resource: "Kandidaat", label: "Kandidaten", method: "GET", path: "/candidates", output: "candidates", params: [q("shortcode", "Vacaturecode"), q("created_after", "Na (ISO)")] },
      { id: "candidate.create", resource: "Kandidaat", label: "Kandidaat toevoegen", method: "POST", path: "/jobs/{{shortcode}}/candidates", body: { candidate: { name: "{{name}}", email: "{{email}}", phone: "{{phone}}" }, sourced: true }, params: [path("shortcode", "Vacaturecode"), P("name", "Naam", { required: true }), P("email", "E-mail", { required: true }), P("phone", "Telefoon")] }
    ]
  },
  // ------------------------------------------------------------ Beveiliging
  {
    id: "okta", name: "Okta", category: "Beveiliging", description: "Gebruikers beheren", color: "#007dc1",
    website: "https://okta.com", docs: "https://developer.okta.com/docs/api/",
    baseUrl: "https://{{domain}}/api/v1", auth: { type: "headers", headers: { Authorization: "SSWS {{apiToken}}" }, fields: [{ key: "apiToken", label: "API-token", secret: true }] }, fields: [{ key: "domain", label: "Okta-domein", placeholder: "bedrijf.okta.com" }], test: "user.list",
    operations: [
      { id: "user.list", resource: "Gebruiker", label: "Gebruikers", method: "GET", path: "/users", params: [q("q", "Zoektekst"), q("limit", "Aantal", { default: "50" })] },
      { id: "user.get", resource: "Gebruiker", label: "Gebruiker ophalen", method: "GET", path: "/users/{{id}}", params: [path("id", "ID of login")] },
      { id: "user.create", resource: "Gebruiker", label: "Gebruiker maken", method: "POST", path: "/users", params: [q("activate", "Direct activeren", { default: "true" }), P("profile.firstName", "Voornaam", { required: true }), P("profile.lastName", "Achternaam", { required: true }), P("profile.email", "E-mail", { required: true }), P("profile.login", "Login", { required: true })] },
      { id: "user.deactivate", resource: "Gebruiker", label: "Gebruiker deactiveren", method: "POST", path: "/users/{{id}}/lifecycle/deactivate", params: [path("id", "Gebruiker-ID")] }
    ]
  },
  {
    id: "urlscan-io", name: "urlscan.io", category: "Beveiliging", description: "URL's scannen", color: "#e46b2a",
    website: "https://urlscan.io", docs: "https://urlscan.io/docs/api/",
    baseUrl: "https://urlscan.io/api/v1", auth: { type: "apiKey", in: "header", name: "API-Key", label: "API-key" },
    operations: [
      { id: "scan.submit", resource: "Scan", label: "URL scannen", method: "POST", path: "/scan/", params: [P("url", "URL", { required: true }), P("visibility", "Zichtbaarheid", { default: "private", options: ["public", "unlisted", "private"] }), P("tags", "Tags", { format: "list" })] },
      { id: "scan.result", resource: "Scan", label: "Resultaat ophalen", method: "GET", path: "/result/{{uuid}}/", params: [path("uuid", "Scan-UUID")] },
      { id: "search", resource: "Zoeken", label: "Zoeken", method: "GET", path: "/search/", output: "results", params: [q("q", "Zoekvraag", { required: true, placeholder: "domain:voorbeeld.nl" })] }
    ]
  },
  {
    id: "thehive", name: "TheHive", category: "Beveiliging", description: "Cases en alerts (v5)", color: "#f3c338",
    website: "https://strangebee.com/thehive", docs: "https://docs.strangebee.com/thehive/api-docs/",
    baseUrl: "{{url}}/api/v1", auth: { type: "bearer", label: "API-key" }, fields: [urlField("TheHive-URL")],
    operations: [
      { id: "alert.create", resource: "Alert", label: "Alert maken", method: "POST", path: "/alert", params: [P("type", "Type", { required: true, default: "aip" }), P("source", "Bron", { required: true, default: "integratieplatform" }), P("sourceRef", "Bronreferentie (uniek)", { required: true }), P("title", "Titel", { required: true }), P("description", "Omschrijving", { type: "text", required: true }), num("severity", "Ernst (1-4)", { default: 2 })] },
      { id: "case.create", resource: "Case", label: "Case maken", method: "POST", path: "/case", params: [P("title", "Titel", { required: true }), P("description", "Omschrijving", { type: "text", required: true }), num("severity", "Ernst (1-4)", { default: 2 })] }
    ]
  },
  {
    id: "misp", name: "MISP", category: "Beveiliging", description: "Threat-intelligence: events en attributen", color: "#6c6c6c",
    website: "https://misp-project.org", docs: "https://www.misp-project.org/openapi/",
    baseUrl: "{{url}}", auth: { type: "headers", headers: { Authorization: "{{apiKey}}" }, fields: [{ key: "apiKey", label: "Auth key", secret: true }] }, fields: [urlField("MISP-URL")],
    operations: [
      { id: "event.list", resource: "Event", label: "Events", method: "GET", path: "/events/index" },
      { id: "attribute.search", resource: "Attribuut", label: "Attributen zoeken", method: "POST", path: "/attributes/restSearch", output: "response.Attribute", params: [P("value", "Waarde (IP, domein, hash …)", { required: true }), P("type", "Type")] },
      { id: "event.create", resource: "Event", label: "Event maken", method: "POST", path: "/events/add", params: [P("info", "Omschrijving", { required: true }), P("threat_level_id", "Dreigingsniveau (1-4)", { default: "2" }), P("distribution", "Verspreiding (0-3)", { default: "0" })] }
    ]
  },
  // ------------------------------------------------------------ Overig
  {
    id: "openweathermap", name: "OpenWeatherMap", category: "Overig", description: "Actueel weer en voorspellingen", color: "#eb6e4b",
    website: "https://openweathermap.org", docs: "https://openweathermap.org/api",
    baseUrl: "https://api.openweathermap.org/data/2.5", auth: { type: "apiKey", in: "query", name: "appid", label: "API-key" }, test: "weather.current",
    operations: [
      { id: "weather.current", resource: "Weer", label: "Actueel weer", method: "GET", path: "/weather", params: [q("q", "Plaats", { default: "Amsterdam,nl" }), q("lat", "Breedtegraad"), q("lon", "Lengtegraad"), q("units", "Eenheden", { default: "metric" }), q("lang", "Taal", { default: "nl" })] },
      { id: "weather.forecast", resource: "Weer", label: "Verwachting (5 dagen)", method: "GET", path: "/forecast", output: "list", params: [q("q", "Plaats", { default: "Amsterdam,nl" }), q("units", "Eenheden", { default: "metric" }), q("cnt", "Aantal tijdvakken", { default: "8" }), q("lang", "Taal", { default: "nl" })] }
    ]
  },
  {
    id: "nasa", name: "NASA", category: "Overig", description: "Open data van NASA", color: "#0b3d91",
    website: "https://api.nasa.gov", docs: "https://api.nasa.gov",
    baseUrl: "https://api.nasa.gov", auth: { type: "apiKey", in: "query", name: "api_key", label: "API-key (of DEMO_KEY)" }, test: "apod",
    operations: [
      { id: "apod", resource: "Foto", label: "Astronomiefoto van de dag", method: "GET", path: "/planetary/apod", params: [q("date", "Datum (JJJJ-MM-DD)")] },
      { id: "neo.feed", resource: "Planetoïde", label: "Planetoïden dichtbij", method: "GET", path: "/neo/rest/v1/feed", params: [q("start_date", "Vanaf", { required: true }), q("end_date", "Tot")] }
    ]
  },
  {
    id: "hacker-news", name: "Hacker News", category: "Overig", description: "Artikelen en gebruikers", color: "#ff6600",
    website: "https://news.ycombinator.com", docs: "https://github.com/HackerNews/API",
    baseUrl: "https://hacker-news.firebaseio.com/v0", auth: { type: "none" }, test: "top",
    operations: [
      { id: "top", resource: "Artikel", label: "Topartikelen (ID's)", method: "GET", path: "/topstories.json" },
      { id: "item.get", resource: "Artikel", label: "Artikel ophalen", method: "GET", path: "/item/{{id}}.json", params: [path("id", "Artikel-ID")] },
      { id: "user.get", resource: "Gebruiker", label: "Gebruiker", method: "GET", path: "/user/{{id}}.json", params: [path("id", "Gebruikersnaam")] }
    ]
  },
  {
    id: "raindrop", name: "Raindrop", category: "Productiviteit", description: "Bladwijzers en collecties", color: "#1988e0",
    website: "https://raindrop.io", docs: "https://developer.raindrop.io",
    baseUrl: "https://api.raindrop.io/rest/v1", auth: { type: "bearer", label: "Test-token / access token" }, test: "collection.list",
    operations: [
      { id: "bookmark.create", resource: "Bladwijzer", label: "Bladwijzer toevoegen", method: "POST", path: "/raindrop", body: { link: "{{link}}", title: "{{title}}", tags: "{{tags}}", collection: { $id: "{{collectionId}}" } }, params: [P("link", "URL", { required: true }), P("title", "Titel"), P("tags", "Tags", { format: "list" }), num("collectionId", "Collectie-ID")] },
      { id: "bookmark.list", resource: "Bladwijzer", label: "Bladwijzers in collectie", method: "GET", path: "/raindrops/{{collectionId}}", output: "items", params: [path("collectionId", "Collectie-ID (0 = alle)", { default: "0" }), q("search", "Zoektekst")] },
      { id: "collection.list", resource: "Collectie", label: "Collecties", method: "GET", path: "/collections", output: "items" }
    ]
  },
  {
    id: "beeminder", name: "Beeminder", category: "Productiviteit", description: "Doelen en datapunten", color: "#f5b917",
    website: "https://beeminder.com", docs: "https://api.beeminder.com",
    baseUrl: "https://www.beeminder.com/api/v1", auth: { type: "apiKey", in: "query", name: "auth_token", label: "Auth-token" }, test: "user",
    operations: [
      { id: "datapoint.create", resource: "Datapunt", label: "Datapunt toevoegen", method: "POST", path: "/users/me/goals/{{goal}}/datapoints.json", params: [path("goal", "Doel (slug)"), num("value", "Waarde", { required: true }), P("comment", "Opmerking")] },
      { id: "goal.list", resource: "Doel", label: "Doelen", method: "GET", path: "/users/me/goals.json" },
      { id: "user", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me.json" }
    ]
  },
  {
    id: "oura", name: "Oura", category: "Overig", description: "Slaap- en activiteitsdata", color: "#2f4a73",
    website: "https://ouraring.com", docs: "https://cloud.ouraring.com/v2/docs",
    baseUrl: "https://api.ouraring.com/v2/usercollection", auth: { type: "bearer", label: "Personal access token" }, test: "info",
    operations: [
      { id: "sleep", resource: "Slaap", label: "Dagelijkse slaap", method: "GET", path: "/daily_sleep", output: "data", params: [q("start_date", "Vanaf"), q("end_date", "Tot")] },
      { id: "activity", resource: "Activiteit", label: "Dagelijkse activiteit", method: "GET", path: "/daily_activity", output: "data", params: [q("start_date", "Vanaf"), q("end_date", "Tot")] },
      { id: "info", resource: "Account", label: "Persoonsgegevens", method: "GET", path: "/personal_info" }
    ]
  },
  {
    id: "peekalink", name: "Peekalink", category: "Overig", description: "Linkvoorbeelden ophalen", color: "#6b46c1",
    website: "https://peekalink.io", docs: "https://docs.peekalink.io",
    baseUrl: "https://api.peekalink.io", auth: { type: "apiKey", in: "header", name: "X-API-Key", label: "API-key" },
    operations: [{ id: "preview", resource: "Link", label: "Linkvoorbeeld", method: "POST", path: "/", params: [P("link", "URL", { required: true })] }]
  },
  {
    id: "yourls", name: "Yourls", category: "Marketing", description: "Links inkorten met je eigen Yourls-server", color: "#1b7ac7",
    website: "https://yourls.org", docs: "https://yourls.org/docs/guide/advanced/api",
    baseUrl: "{{url}}/yourls-api.php", auth: { type: "query", query: { signature: "{{signature}}", format: "json" }, fields: [{ key: "signature", label: "Signature-token", secret: true }] }, fields: [urlField("Yourls-URL")],
    operations: [
      { id: "shorten", resource: "Link", label: "Link inkorten", method: "GET", path: "", params: [q("action", "Actie", { default: "shorturl" }), q("url", "Lange URL", { required: true }), q("keyword", "Eigen code")] },
      { id: "stats", resource: "Link", label: "Statistieken", method: "GET", path: "", params: [q("action", "Actie", { default: "url-stats" }), q("shorturl", "Korte URL of code", { required: true })] }
    ]
  }
];
