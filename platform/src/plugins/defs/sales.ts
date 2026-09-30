import type { PluginDef } from "../types";
import { GS, P, bool, google, json, num, path, q, urlField } from "./_shared";

// Batch 2: verkoop, marketing, verrijking en webinars.

export const SALES: PluginDef[] = [
  // ---------------------------------------------------------------- CRM
  { id: "agile-crm", name: "Agile CRM", category: "Verkoop & CRM", description: "Contacten, bedrijven en deals", color: "#1d6fb8", website: "https://agilecrm.com", docs: "https://github.com/agilecrm/rest-api",
    baseUrl: "https://{{domain}}.agilecrm.com/dev/api", fields: [{ key: "domain", label: "Subdomein", placeholder: "bedrijf (van bedrijf.agilecrm.com)" }],
    auth: { type: "basic", userLabel: "E-mail van de gebruiker", passLabel: "REST API-key", help: "Agile CRM → Admin Settings → API & Analytics → REST API key." }, test: "contact.list",
    operations: [
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/contacts",
        body: { properties: [{ $if: "{{firstName}}", type: "SYSTEM", name: "first_name", value: "{{firstName}}" }, { $if: "{{lastName}}", type: "SYSTEM", name: "last_name", value: "{{lastName}}" }, { $if: "{{email}}", type: "SYSTEM", name: "email", subtype: "work", value: "{{email}}" }, { $if: "{{phone}}", type: "SYSTEM", name: "phone", subtype: "work", value: "{{phone}}" }, { $if: "{{company}}", type: "SYSTEM", name: "company", value: "{{company}}" }], tags: "{{tags}}", lead_score: "{{score}}" },
        params: [P("firstName", "Voornaam"), P("lastName", "Achternaam"), P("email", "E-mail", { required: true }), P("phone", "Telefoon"), P("company", "Bedrijf"), P("tags", "Tags", { format: "list" }), num("score", "Leadscore")] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/contacts/{{id}}", params: [path("id", "Contact-ID")] },
      { id: "contact.byEmail", resource: "Contact", label: "Contact op e-mail", method: "GET", path: "/contacts/search/email/{{email}}", params: [path("email", "E-mail")] },
      { id: "contact.list", resource: "Contact", label: "Contacten", method: "GET", path: "/contacts", params: [q("page_size", "Aantal", { default: "20" }), q("cursor", "Cursor")] },
      { id: "contact.update", resource: "Contact", label: "Eigenschappen bijwerken", method: "PUT", path: "/contacts/edit-properties", params: [num("id", "Contact-ID", { required: true }), json("properties", "Eigenschappen", { required: true, placeholder: '[{"type":"SYSTEM","name":"last_name","value":"Jansen"}]' })] },
      { id: "contact.delete", resource: "Contact", label: "Contact verwijderen", method: "DELETE", path: "/contacts/{{id}}", params: [path("id", "Contact-ID")] },
      { id: "company.create", resource: "Bedrijf", label: "Bedrijf maken", method: "POST", path: "/contacts", body: { type: "COMPANY", properties: [{ type: "SYSTEM", name: "name", value: "{{name}}" }, { $if: "{{url}}", type: "SYSTEM", name: "url", value: "{{url}}" }] }, params: [P("name", "Naam", { required: true }), P("url", "Website")] },
      { id: "deal.create", resource: "Deal", label: "Deal maken", method: "POST", path: "/opportunity", params: [P("name", "Naam", { required: true }), num("expected_value", "Waarde", { required: true }), P("milestone", "Mijlpaal", { required: true, placeholder: "Open, Won, Lost" }), num("probability", "Kans (%)", { default: 50 }), num("close_date", "Sluitdatum (unix)"), P("contact_ids", "Contact-ID's", { format: "list" })] },
      { id: "deal.list", resource: "Deal", label: "Deals", method: "GET", path: "/opportunity", params: [q("page_size", "Aantal", { default: "20" })] },
      { id: "deal.delete", resource: "Deal", label: "Deal verwijderen", method: "DELETE", path: "/opportunity/{{id}}", params: [path("id", "Deal-ID")] }
    ] },
  { id: "freshworks-crm", name: "Freshworks CRM", category: "Verkoop & CRM", description: "Contacten, accounts, deals en taken (Freshsales)", color: "#f26d21", website: "https://freshworks.com/crm", docs: "https://developers.freshworks.com/crm/api/",
    baseUrl: "https://{{domain}}.myfreshworks.com/crm/sales/api", fields: [{ key: "domain", label: "Subdomein", placeholder: "bedrijf (van bedrijf.myfreshworks.com)" }],
    auth: { type: "headers", headers: { Authorization: "Token token={{apiKey}}" }, fields: [{ key: "apiKey", label: "API-key", secret: true }], help: "Profielinstellingen → API Settings → API-key." }, test: "owners",
    operations: [
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/contacts", output: "contact", params: [P("contact.first_name", "Voornaam"), P("contact.last_name", "Achternaam"), P("contact.email", "E-mail", { required: true }), P("contact.mobile_number", "Mobiel"), P("contact.job_title", "Functie"), num("contact.sales_account_id", "Account-ID")] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/contacts/{{id}}", output: "contact", params: [path("id", "Contact-ID")] },
      { id: "contact.update", resource: "Contact", label: "Contact bijwerken", method: "PUT", path: "/contacts/{{id}}", output: "contact", body: { contact: "{{fields}}" }, params: [path("id", "Contact-ID"), json("fields", "Velden", { required: true, placeholder: '{"job_title":"Inkoper"}' })] },
      { id: "contact.delete", resource: "Contact", label: "Contact verwijderen", method: "DELETE", path: "/contacts/{{id}}", params: [path("id", "Contact-ID")] },
      { id: "search", resource: "Zoeken", label: "Zoeken", method: "GET", path: "/search", params: [q("q", "Zoekterm", { required: true }), q("include", "In", { default: "contact,sales_account,deal" })] },
      { id: "account.create", resource: "Account", label: "Account maken", method: "POST", path: "/sales_accounts", output: "sales_account", params: [P("sales_account.name", "Naam", { required: true }), P("sales_account.website", "Website"), P("sales_account.phone", "Telefoon")] },
      { id: "deal.create", resource: "Deal", label: "Deal maken", method: "POST", path: "/deals", output: "deal", params: [P("deal.name", "Naam", { required: true }), num("deal.amount", "Bedrag"), num("deal.sales_account_id", "Account-ID"), num("deal.deal_stage_id", "Fase-ID")] },
      { id: "task.create", resource: "Taak", label: "Taak maken", method: "POST", path: "/tasks", output: "task", params: [P("task.title", "Titel", { required: true }), P("task.due_date", "Deadline (ISO)", { required: true }), num("task.targetable_id", "Gekoppeld aan (ID)", { required: true }), P("task.targetable_type", "Type", { options: ["Contact", "SalesAccount", "Deal"], default: "Contact" }), P("task.description", "Omschrijving")] },
      { id: "owners", resource: "Account", label: "Gebruikers", method: "GET", path: "/selector/owners", output: "users" }
    ] },
  { id: "gong", name: "Gong", category: "Verkoop & CRM", description: "Gesprekken, transcripties en gebruikers", color: "#8039df", website: "https://gong.io", docs: "https://gong.app.gong.io/settings/api/documentation",
    baseUrl: "{{url}}/v2", fields: [{ key: "url", label: "API-adres", default: "https://api.gong.io", placeholder: "https://api.gong.io of je eigen api-adres uit Gong" }],
    auth: { type: "basic", userLabel: "Access key", passLabel: "Access key secret", help: "Gong → Company settings → API → Create key." }, test: "users",
    operations: [
      { id: "users", resource: "Gebruiker", label: "Gebruikers", method: "GET", path: "/users", output: "users", params: [q("cursor", "Cursor")] },
      { id: "call.list", resource: "Gesprek", label: "Gesprekken", method: "GET", path: "/calls", output: "calls", params: [q("fromDateTime", "Vanaf (ISO)"), q("toDateTime", "Tot (ISO)"), q("cursor", "Cursor")] },
      { id: "call.get", resource: "Gesprek", label: "Gesprek ophalen", method: "GET", path: "/calls/{{id}}", output: "call", params: [path("id", "Gesprek-ID")] },
      { id: "call.extensive", resource: "Gesprek", label: "Gesprekken met details", method: "POST", path: "/calls/extensive", output: "calls", body: { filter: { callIds: "{{callIds}}", fromDateTime: "{{fromDateTime}}", toDateTime: "{{toDateTime}}" }, contentSelector: { exposedFields: { parties: true, content: { brief: true, topics: true, trackers: true } } } },
        params: [P("callIds", "Gesprek-ID's", { format: "list" }), P("fromDateTime", "Vanaf (ISO)"), P("toDateTime", "Tot (ISO)")] },
      { id: "call.transcript", resource: "Gesprek", label: "Transcriptie", method: "POST", path: "/calls/transcript", output: "callTranscripts", body: { filter: { callIds: "{{callIds}}" } }, params: [P("callIds", "Gesprek-ID's", { required: true, format: "list" })] }
    ] },
  { id: "highlevel", name: "HighLevel", category: "Verkoop & CRM", description: "Contacten, kansen, taken en agenda's", color: "#188bf6", website: "https://gohighlevel.com", docs: "https://highlevel.stoplight.io/docs/integrations/",
    baseUrl: "https://services.leadconnectorhq.com", fields: [{ key: "locationId", label: "Location-ID (sub-account)" }],
    auth: { type: "bearer", label: "Private integration token", help: "Sub-account → Settings → Private Integrations → token met de benodigde scopes." }, headers: { Version: "2021-07-28" }, test: "location",
    operations: [
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/contacts/", output: "contact", body: { locationId: "{{locationId}}", firstName: "{{firstName}}", lastName: "{{lastName}}", email: "{{email}}", phone: "{{phone}}", companyName: "{{companyName}}", tags: "{{tags}}", source: "{{source}}" },
        params: [P("firstName", "Voornaam"), P("lastName", "Achternaam"), P("email", "E-mail"), P("phone", "Telefoon"), P("companyName", "Bedrijf"), P("tags", "Tags", { format: "list" }), P("source", "Bron")] },
      { id: "contact.upsert", resource: "Contact", label: "Contact bijwerken of maken", method: "POST", path: "/contacts/upsert", output: "contact", body: { locationId: "{{locationId}}", email: "{{email}}", phone: "{{phone}}", firstName: "{{firstName}}", lastName: "{{lastName}}", tags: "{{tags}}" },
        params: [P("email", "E-mail"), P("phone", "Telefoon"), P("firstName", "Voornaam"), P("lastName", "Achternaam"), P("tags", "Tags", { format: "list" })] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/contacts/{{id}}", output: "contact", params: [path("id", "Contact-ID")] },
      { id: "contact.update", resource: "Contact", label: "Contact bijwerken", method: "PUT", path: "/contacts/{{id}}", output: "contact", bodyParam: "fields", params: [path("id", "Contact-ID"), json("fields", "Velden", { required: true, placeholder: '{"lastName":"Jansen"}' })] },
      { id: "contact.delete", resource: "Contact", label: "Contact verwijderen", method: "DELETE", path: "/contacts/{{id}}", params: [path("id", "Contact-ID")] },
      { id: "contact.search", resource: "Contact", label: "Contacten zoeken", method: "POST", path: "/contacts/search", output: "contacts", body: { locationId: "{{locationId}}", query: "{{query}}", pageLimit: "{{limit}}" }, params: [P("query", "Zoekterm"), num("limit", "Aantal", { default: 20 })] },
      { id: "opportunity.create", resource: "Kans", label: "Kans maken", method: "POST", path: "/opportunities/", output: "opportunity", body: { locationId: "{{locationId}}", pipelineId: "{{pipelineId}}", pipelineStageId: "{{pipelineStageId}}", name: "{{name}}", status: "{{status}}", contactId: "{{contactId}}", monetaryValue: "{{value}}" },
        params: [P("pipelineId", "Pipeline-ID", { required: true }), P("pipelineStageId", "Fase-ID"), P("name", "Naam", { required: true }), P("status", "Status", { options: ["open", "won", "lost", "abandoned"], default: "open" }), P("contactId", "Contact-ID", { required: true }), num("value", "Waarde")] },
      { id: "task.create", resource: "Taak", label: "Taak maken", method: "POST", path: "/contacts/{{contactId}}/tasks", output: "task", params: [path("contactId", "Contact-ID"), P("title", "Titel", { required: true }), P("body", "Omschrijving"), P("dueDate", "Deadline (ISO)", { required: true }), bool("completed", "Afgerond", { default: false })] },
      { id: "location", resource: "Account", label: "Sub-account", method: "GET", path: "/locations/{{locationId}}", output: "location" }
    ] },
  { id: "keap", name: "Keap", category: "Verkoop & CRM", description: "Contacten, bedrijven, tags, notities en bestellingen", color: "#36a635", website: "https://keap.com", docs: "https://developer.keap.com/docs/rest/",
    baseUrl: "https://api.infusionsoft.com/crm/rest/v1", auth: { type: "apiKey", in: "header", name: "X-Keap-API-Key", label: "Personal access token / service account key", help: "Keap → Settings → API → Personal Access Token of Service Account Key." }, test: "profile",
    operations: [
      { id: "contact.upsert", resource: "Contact", label: "Contact maken of bijwerken (op e-mail)", method: "PUT", path: "/contacts", body: { duplicate_option: "Email", given_name: "{{firstName}}", family_name: "{{lastName}}", email_addresses: [{ $if: "{{email}}", email: "{{email}}", field: "EMAIL1" }], phone_numbers: [{ $if: "{{phone}}", number: "{{phone}}", field: "PHONE1" }], job_title: "{{jobTitle}}" },
        params: [P("email", "E-mail", { required: true }), P("firstName", "Voornaam"), P("lastName", "Achternaam"), P("phone", "Telefoon"), P("jobTitle", "Functie")] },
      { id: "contact.list", resource: "Contact", label: "Contacten", method: "GET", path: "/contacts", output: "contacts", params: [q("email", "E-mail"), q("limit", "Aantal", { default: "50" }), q("offset", "Vanaf")] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/contacts/{{id}}", params: [path("id", "Contact-ID"), q("optional_properties", "Extra velden")] },
      { id: "contact.delete", resource: "Contact", label: "Contact verwijderen", method: "DELETE", path: "/contacts/{{id}}", params: [path("id", "Contact-ID")] },
      { id: "contact.tag", resource: "Contact", label: "Tags toevoegen", method: "POST", path: "/contacts/{{id}}/tags", params: [path("id", "Contact-ID"), P("tagIds", "Tag-ID's", { required: true, format: "list", type: "number" })] },
      { id: "tag.list", resource: "Tag", label: "Tags", method: "GET", path: "/tags", output: "tags" },
      { id: "company.create", resource: "Bedrijf", label: "Bedrijf maken", method: "POST", path: "/companies", params: [P("company_name", "Naam", { required: true }), P("website", "Website"), P("email_address", "E-mail")] },
      { id: "note.create", resource: "Notitie", label: "Notitie toevoegen", method: "POST", path: "/notes", params: [num("contact_id", "Contact-ID", { required: true }), P("title", "Titel", { required: true }), P("body", "Tekst", { type: "text" })] },
      { id: "order.list", resource: "Bestelling", label: "Bestellingen", method: "GET", path: "/orders", output: "orders", params: [q("contact_id", "Contact-ID"), q("paid", "Betaald"), q("limit", "Aantal")] },
      { id: "profile", resource: "Account", label: "Accountprofiel", method: "GET", path: "/account/profile" }
    ] },
  { id: "monica-crm", name: "Monica CRM", category: "Verkoop & CRM", description: "Persoonlijke CRM: contacten, activiteiten, notities en taken", color: "#325776", website: "https://monicahq.com", docs: "https://www.monicahq.com/api",
    baseUrl: "{{url}}/api", fields: [{ key: "url", label: "Adres", default: "https://app.monicahq.com", placeholder: "https://app.monicahq.com of eigen server" }], auth: { type: "bearer", label: "API-token", help: "Monica → Settings → API → Personal access token." }, test: "me",
    operations: [
      { id: "contact.list", resource: "Contact", label: "Contacten zoeken", method: "GET", path: "/contacts", output: "data", params: [q("query", "Zoekterm"), q("limit", "Aantal", { default: "30" })] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/contacts/{{id}}", output: "data", params: [path("id", "Contact-ID")] },
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/contacts", output: "data", body: { first_name: "{{firstName}}", last_name: "{{lastName}}", nickname: "{{nickname}}", gender_id: "{{genderId}}", is_birthdate_known: false, is_deceased: false, is_deceased_date_known: false },
        params: [P("firstName", "Voornaam", { required: true }), P("lastName", "Achternaam"), P("nickname", "Bijnaam"), num("genderId", "Gender-ID", { default: 3 })] },
      { id: "contact.delete", resource: "Contact", label: "Contact verwijderen", method: "DELETE", path: "/contacts/{{id}}", params: [path("id", "Contact-ID")] },
      { id: "activity.create", resource: "Activiteit", label: "Activiteit vastleggen", method: "POST", path: "/activities", output: "data", params: [num("activity_type_id", "Type-ID", { required: true }), P("summary", "Samenvatting", { required: true }), P("description", "Omschrijving"), P("happened_at", "Datum (JJJJ-MM-DD)", { required: true }), P("contacts", "Contact-ID's", { required: true, format: "list", type: "number" })] },
      { id: "note.create", resource: "Notitie", label: "Notitie toevoegen", method: "POST", path: "/notes", output: "data", params: [num("contact_id", "Contact-ID", { required: true }), P("body", "Tekst", { type: "text", required: true }), bool("is_favorited", "Favoriet", { default: false })] },
      { id: "task.create", resource: "Taak", label: "Taak maken", method: "POST", path: "/tasks", output: "data", params: [num("contact_id", "Contact-ID", { required: true }), P("title", "Titel", { required: true }), P("description", "Omschrijving"), bool("completed", "Afgerond", { default: false })] },
      { id: "reminder.create", resource: "Herinnering", label: "Herinnering maken", method: "POST", path: "/reminders", output: "data", params: [num("contact_id", "Contact-ID", { required: true }), P("title", "Titel", { required: true }), P("initial_date", "Datum (JJJJ-MM-DD)", { required: true }), P("frequency_type", "Herhaling", { options: ["one_time", "week", "month", "year"], default: "one_time" }), num("frequency_number", "Elke", { default: 1 })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/me", output: "data" }
    ] },
  { id: "salesmate", name: "Salesmate", category: "Verkoop & CRM", description: "Contacten, bedrijven en deals", color: "#1167f3", website: "https://salesmate.io", docs: "https://apidocs.salesmate.io/",
    baseUrl: "https://{{linkname}}.salesmate.io/apis", fields: [{ key: "linkname", label: "Linknaam", placeholder: "bedrijf (van bedrijf.salesmate.io)" }],
    auth: { type: "headers", headers: { accessToken: "{{token}}", "x-linkname": "{{linkname}}.salesmate.io" }, fields: [{ key: "token", label: "Session token", secret: true }], help: "Salesmate → Mijn account → Access key (session token)." },
    operations: [
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/contact/v4", output: "Data", params: [P("firstName", "Voornaam"), P("lastName", "Achternaam", { required: true }), P("email", "E-mail"), P("mobile", "Mobiel"), P("company", "Bedrijf"), num("owner", "Eigenaar-ID", { required: true })] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/contact/v4/{{id}}", output: "Data", params: [path("id", "Contact-ID")] },
      { id: "contact.update", resource: "Contact", label: "Contact bijwerken", method: "PUT", path: "/contact/v4/{{id}}", output: "Data", bodyParam: "fields", params: [path("id", "Contact-ID"), json("fields", "Velden", { required: true })] },
      { id: "contact.delete", resource: "Contact", label: "Contact verwijderen", method: "DELETE", path: "/contact/v4/{{id}}", params: [path("id", "Contact-ID")] },
      { id: "company.create", resource: "Bedrijf", label: "Bedrijf maken", method: "POST", path: "/company/v4", output: "Data", params: [P("name", "Naam", { required: true }), P("website", "Website"), num("owner", "Eigenaar-ID", { required: true })] },
      { id: "deal.create", resource: "Deal", label: "Deal maken", method: "POST", path: "/deal/v4", output: "Data", params: [P("title", "Titel", { required: true }), num("owner", "Eigenaar-ID", { required: true }), num("primaryContact", "Contact-ID", { required: true }), P("pipeline", "Pipeline", { required: true }), P("stage", "Fase", { required: true }), P("currency", "Valuta", { default: "EUR" }), P("status", "Status", { options: ["Open", "Won", "Lost"], default: "Open" }), num("dealValue", "Waarde")] },
      { id: "deal.get", resource: "Deal", label: "Deal ophalen", method: "GET", path: "/deal/v4/{{id}}", output: "Data", params: [path("id", "Deal-ID")] }
    ] },
  { id: "drift", name: "Drift", category: "Klantenservice", description: "Contacten in Drift (Salesloft)", color: "#0176ff", website: "https://salesloft.com/platform/drift", docs: "https://devdocs.drift.com/docs",
    baseUrl: "https://driftapi.com", auth: { type: "bearer", label: "Access token", help: "Drift Developer → app maken → OAuth access token." }, test: "users",
    operations: [
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/contacts", output: "data", body: { attributes: { email: "{{email}}", name: "{{name}}", phone: "{{phone}}" } }, params: [P("email", "E-mail", { required: true }), P("name", "Naam"), P("phone", "Telefoon")] },
      { id: "contact.find", resource: "Contact", label: "Contact op e-mail", method: "GET", path: "/contacts", output: "data", params: [q("email", "E-mail", { required: true })] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/contacts/{{id}}", output: "data", params: [path("id", "Contact-ID")] },
      { id: "contact.update", resource: "Contact", label: "Contact bijwerken", method: "PATCH", path: "/contacts/{{id}}", output: "data", body: { attributes: "{{attributes}}" }, params: [path("id", "Contact-ID"), json("attributes", "Attributen", { required: true })] },
      { id: "contact.delete", resource: "Contact", label: "Contact verwijderen", method: "DELETE", path: "/contacts/{{id}}", params: [path("id", "Contact-ID")] },
      { id: "users", resource: "Gebruiker", label: "Gebruikers", method: "GET", path: "/users/list", output: "data" }
    ] },

  // ---------------------------------------------------------------- verrijking
  { id: "clearbit", name: "Clearbit", category: "Verkoop & CRM", description: "Bedrijfs- en persoonsgegevens verrijken", color: "#3f8ef7", website: "https://clearbit.com", docs: "https://dashboard.clearbit.com/docs",
    baseUrl: "https://person.clearbit.com", auth: { type: "bearer", label: "Secret API-key", help: "Alleen voor bestaande Clearbit-accounts (Clearbit is nu HubSpot Breeze Intelligence)." },
    operations: [
      { id: "person.find", resource: "Persoon", label: "Persoon op e-mail", method: "GET", path: "/v2/people/find", params: [q("email", "E-mail", { required: true })] },
      { id: "combined.find", resource: "Persoon", label: "Persoon + bedrijf op e-mail", method: "GET", path: "/v2/combined/find", params: [q("email", "E-mail", { required: true })] },
      { id: "company.find", resource: "Bedrijf", label: "Bedrijf op domein", method: "GET", baseUrl: "https://company.clearbit.com", path: "/v2/companies/find", params: [q("domain", "Domein", { required: true })] },
      { id: "company.suggest", resource: "Bedrijf", label: "Bedrijf zoeken (autocomplete)", method: "GET", baseUrl: "https://autocomplete.clearbit.com", path: "/v1/companies/suggest", params: [q("query", "Naam", { required: true })] }
    ] },
  { id: "dropcontact", name: "Dropcontact", category: "Verkoop & CRM", description: "Contactgegevens verrijken en e-mails vinden (EU/AVG)", color: "#0abf8c", website: "https://dropcontact.com", docs: "https://developer.dropcontact.com/",
    baseUrl: "https://api.dropcontact.com/v1", auth: { type: "apiKey", in: "header", name: "X-Access-Token", label: "API-key" },
    operations: [
      { id: "enrich", resource: "Contact", label: "Verrijking starten", method: "POST", path: "/enrich/all", description: "Asynchroon: haal het resultaat op met 'Resultaat ophalen' en de request_id.",
        body: { data: [{ email: "{{email}}", first_name: "{{firstName}}", last_name: "{{lastName}}", full_name: "{{fullName}}", company: "{{company}}", website: "{{website}}", linkedin: "{{linkedin}}" }], siren: "{{siren}}", language: "{{language}}" },
        params: [P("email", "E-mail"), P("firstName", "Voornaam"), P("lastName", "Achternaam"), P("fullName", "Volledige naam"), P("company", "Bedrijf"), P("website", "Website"), P("linkedin", "LinkedIn-URL"), bool("siren", "Franse bedrijfsgegevens (SIREN)"), P("language", "Taal", { options: ["en", "fr"], default: "en" })] },
      { id: "enrich.batch", resource: "Contact", label: "Verrijking starten (meerdere)", method: "POST", path: "/enrich/all", params: [json("data", "Contacten", { required: true, placeholder: '[{"first_name":"Jan","last_name":"Jansen","company":"Voorbeeld BV"}]' }), P("language", "Taal", { default: "en" })] },
      { id: "result", resource: "Contact", label: "Resultaat ophalen", method: "GET", path: "/enrich/all/{{requestId}}", params: [path("requestId", "Request-ID"), q("forceResults", "Ook gedeeltelijke resultaten")] }
    ] },
  { id: "uplead", name: "UpLead", category: "Verkoop & CRM", description: "Bedrijfs- en persoonsgegevens verrijken", color: "#2f63f1", website: "https://uplead.com", docs: "https://docs.uplead.com/",
    baseUrl: "https://api.uplead.com/v2", auth: { type: "apiKey", in: "header", name: "Authorization", label: "API-key" }, test: "credits",
    operations: [
      { id: "person", resource: "Persoon", label: "Persoon zoeken", method: "GET", path: "/person-search", output: "data", params: [q("email", "E-mail"), q("first_name", "Voornaam"), q("last_name", "Achternaam"), q("domain", "Domein")] },
      { id: "company", resource: "Bedrijf", label: "Bedrijf zoeken", method: "GET", path: "/company-search", output: "data", params: [q("domain", "Domein"), q("company", "Bedrijfsnaam")] },
      { id: "credits", resource: "Account", label: "Tegoed", method: "GET", path: "/credits", output: "data" }
    ] },
  { id: "lonescale", name: "LoneScale", category: "Verkoop & CRM", description: "Lijsten en items, verrijking van contacten", color: "#5b5bd6", website: "https://lonescale.com", docs: "https://docs.lonescale.com/",
    baseUrl: "https://public-api.lonescale.com", auth: { type: "apiKey", in: "header", name: "x-api-key", label: "API-key" }, test: "list.all",
    operations: [
      { id: "list.all", resource: "Lijst", label: "Lijsten", method: "GET", path: "/lists" },
      { id: "list.create", resource: "Lijst", label: "Lijst maken", method: "POST", path: "/lists", params: [P("name", "Naam", { required: true }), P("entity", "Soort", { required: true, options: ["PEOPLE", "COMPANY"], default: "PEOPLE" })] },
      { id: "list.get", resource: "Lijst", label: "Lijst ophalen", method: "GET", path: "/lists/{{listId}}", params: [path("listId", "Lijst-ID")] },
      { id: "list.delete", resource: "Lijst", label: "Lijst verwijderen", method: "DELETE", path: "/lists/{{listId}}", params: [path("listId", "Lijst-ID")] },
      { id: "item.list", resource: "Item", label: "Items", method: "GET", path: "/lists/{{listId}}/items", params: [path("listId", "Lijst-ID")] },
      { id: "item.add", resource: "Item", label: "Item toevoegen", method: "POST", path: "/lists/{{listId}}/item", params: [path("listId", "Lijst-ID"), P("first_name", "Voornaam"), P("last_name", "Achternaam"), P("full_name", "Volledige naam"), P("email", "E-mail"), P("company_name", "Bedrijf"), P("current_position", "Functie"), P("domain", "Domein (COMPANY-lijst)"), P("name", "Naam (COMPANY-lijst)"), P("linkedin_url", "LinkedIn-URL"), P("location", "Locatie")] },
      { id: "item.delete", resource: "Item", label: "Item verwijderen", method: "DELETE", path: "/lists/{{listId}}/item/{{itemId}}", params: [path("listId", "Lijst-ID"), path("itemId", "Item-ID")] },
      { id: "enrich", resource: "Verrijking", label: "Contacten verrijken (direct)", method: "POST", path: "/trigger/enrich/sync", params: [P("enrichment_type", "Soort verrijking", { required: true, format: "list", default: "email", placeholder: "email,phone,profile" }), json("contacts", "Contacten (max. 10)", { required: true, placeholder: '[{"first_name":"Jan","last_name":"Jansen","company_name":"Voorbeeld","linkedin_url":"https://www.linkedin.com/in/…"}]' }), bool("detect_job_change", "Baanwissel detecteren")] },
      { id: "me", resource: "Account", label: "Gebruiker", method: "GET", path: "/users" }
    ] },
  { id: "humantic-ai", name: "Humantic AI", category: "AI", description: "Persoonlijkheidsprofielen (DISC/OCEAN) op basis van LinkedIn, e-mail of tekst", color: "#7c3aed", website: "https://humantic.ai", docs: "https://api.humantic.ai/",
    baseUrl: "https://api.humantic.ai/v1/user-profile", auth: { type: "apiKey", in: "query", name: "apikey", label: "API-key" },
    operations: [
      { id: "create", resource: "Profiel", label: "Analyse starten", method: "GET", path: "/create", description: "LinkedIn-URL of e-mail; resultaat na 30–45 s ophalen.", params: [q("id", "LinkedIn-URL of e-mail", { required: true }), q("firstname", "Voornaam"), q("lastname", "Achternaam"), q("analysistype", "Type", { options: ["", "talent"] })] },
      { id: "create.text", resource: "Profiel", label: "Analyse van tekst", method: "POST", path: "/create", params: [q("id", "Eigen ID", { required: true }), P("text", "Tekst (min. 300 woorden)", { type: "text", required: true })] },
      { id: "get", resource: "Profiel", label: "Profiel ophalen", method: "GET", path: "", params: [q("id", "ID (zelfde als bij starten)", { required: true }), q("persona", "Persona", { options: ["sales", "hiring"] })] }
    ] },
  { id: "brandfetch", name: "Brandfetch", category: "Marketing", description: "Logo's, kleuren en merkgegevens van een domein", color: "#1e1e1e", website: "https://brandfetch.com", docs: "https://docs.brandfetch.com/",
    baseUrl: "https://api.brandfetch.io/v2", auth: { type: "bearer", label: "API-key" },
    operations: [
      { id: "brand", resource: "Merk", label: "Merk ophalen", method: "GET", path: "/brands/{{domain}}", params: [path("domain", "Domein of ID", { placeholder: "nike.com" })] },
      { id: "search", resource: "Merk", label: "Merk zoeken", method: "GET", path: "/search/{{name}}", params: [path("name", "Naam"), q("c", "Client-ID", { help: "Client-ID uit je Brandfetch-dashboard" })] }
    ] },
  { id: "mailcheck", name: "Mailcheck", category: "Marketing", description: "E-mailadressen valideren", color: "#2dbd6e", website: "https://mailcheck.co", docs: "https://mailcheck.co/api",
    baseUrl: "https://api.mailcheck.co/v1", auth: { type: "bearer", label: "API-key" },
    operations: [{ id: "check", resource: "E-mail", label: "E-mailadres controleren", method: "POST", path: "/singleEmail:check", params: [P("email", "E-mail", { required: true })] }] },
  { id: "uproc", name: "uProc", category: "Overig", description: "Data verrijken en valideren (honderden processors)", color: "#ff6b35", website: "https://uproc.io", docs: "https://uproc.io/api",
    baseUrl: "https://api.uproc.io/api/v2", auth: { type: "basic", userLabel: "E-mail", passLabel: "API-key" },
    operations: [
      { id: "process", resource: "Processor", label: "Processor uitvoeren", method: "POST", path: "/process", params: [P("processor", "Processor", { required: true, placeholder: "check-email-exists, get-company-by-domain, check-iban-valid" }), json("params", "Parameters", { required: true, placeholder: '{"email":"jan@example.nl"}' })] },
      { id: "email.check", resource: "E-mail", label: "E-mailadres bestaat?", method: "POST", path: "/process", body: { processor: "check-email-exists", params: { email: "{{email}}" } }, params: [P("email", "E-mail", { required: true })] },
      { id: "company.byDomain", resource: "Bedrijf", label: "Bedrijf op domein", method: "POST", path: "/process", body: { processor: "get-company-by-domain", params: { domain: "{{domain}}" } }, params: [P("domain", "Domein", { required: true })] }
    ] },
  { id: "one-simple-api", name: "One Simple API", category: "Overig", description: "Hulp-API's: screenshots en andere tools", color: "#111827", website: "https://onesimpleapi.com", docs: "https://onesimpleapi.com/docs",
    baseUrl: "https://onesimpleapi.com/api", auth: { type: "bearer", label: "API-token" },
    operations: [
      { id: "screenshot", resource: "Web", label: "Screenshot van een pagina", method: "GET", path: "/screenshot", params: [q("url", "URL", { required: true }), q("output", "Uitvoer", { options: ["json", "image"], default: "json" }), q("full_page", "Hele pagina", { options: ["false", "true"] })] },
      { id: "tool", resource: "Tool", label: "Andere tool aanroepen", method: "GET", path: "/{{tool}}", params: [path("tool", "Tool", { placeholder: "zie de documentatie" }), P("query", "Parameters", { in: "rawQuery", placeholder: "url=https://…&output=json" })] }
    ] },

  // ---------------------------------------------------------------- marketing
  { id: "action-network", name: "Action Network", category: "Marketing", description: "Activisten, events, petities en tags (OSDI)", color: "#b91c1c", website: "https://actionnetwork.org", docs: "https://actionnetwork.org/docs",
    baseUrl: "https://actionnetwork.org/api/v2", auth: { type: "apiKey", in: "header", name: "OSDI-API-Token", label: "API-key" }, test: "entry",
    operations: [
      { id: "person.signup", resource: "Persoon", label: "Persoon aanmelden", method: "POST", path: "/people", body: { person: { given_name: "{{firstName}}", family_name: "{{lastName}}", email_addresses: [{ address: "{{email}}" }], postal_addresses: [{ $if: "{{postalCode}}", postal_code: "{{postalCode}}", country: "{{country}}" }] }, add_tags: "{{tags}}" },
        params: [P("email", "E-mail", { required: true }), P("firstName", "Voornaam"), P("lastName", "Achternaam"), P("postalCode", "Postcode"), P("country", "Land", { default: "NL" }), P("tags", "Tags", { format: "list" })] },
      { id: "person.list", resource: "Persoon", label: "Personen", method: "GET", path: "/people", output: "_embedded.osdi:people", params: [q("filter", "Filter (OData)", { placeholder: "email_address eq 'jan@example.nl'" }), q("page", "Pagina")] },
      { id: "person.get", resource: "Persoon", label: "Persoon ophalen", method: "GET", path: "/people/{{id}}", params: [path("id", "Persoon-ID")] },
      { id: "person.update", resource: "Persoon", label: "Persoon bijwerken", method: "PUT", path: "/people/{{id}}", bodyParam: "fields", params: [path("id", "Persoon-ID"), json("fields", "Velden", { required: true })] },
      { id: "event.list", resource: "Event", label: "Events", method: "GET", path: "/events", output: "_embedded.osdi:events" },
      { id: "event.create", resource: "Event", label: "Event maken", method: "POST", path: "/events", params: [P("title", "Titel", { required: true }), P("start_date", "Start (ISO)"), P("description", "Omschrijving", { type: "text" }), json("location", "Locatie", { placeholder: '{"venue":"Zaal","locality":"Utrecht"}' })] },
      { id: "petition.list", resource: "Petitie", label: "Petities", method: "GET", path: "/petitions", output: "_embedded.osdi:petitions" },
      { id: "petition.sign", resource: "Petitie", label: "Petitie ondertekenen", method: "POST", path: "/petitions/{{id}}/signatures", body: { person: { given_name: "{{firstName}}", family_name: "{{lastName}}", email_addresses: [{ address: "{{email}}" }] }, comments: "{{comments}}" },
        params: [path("id", "Petitie-ID"), P("email", "E-mail", { required: true }), P("firstName", "Voornaam"), P("lastName", "Achternaam"), P("comments", "Reactie")] },
      { id: "tag.list", resource: "Tag", label: "Tags", method: "GET", path: "/tags", output: "_embedded.osdi:tags" },
      { id: "tag.create", resource: "Tag", label: "Tag maken", method: "POST", path: "/tags", params: [P("name", "Naam", { required: true })] },
      { id: "entry", resource: "Account", label: "API-ingang", method: "GET", path: "/" }
    ] },
  { id: "autopilot", name: "Autopilot (Ortto)", category: "Marketing", description: "Marketingautomatisering: personen, activiteiten en tags (Autopilot heet nu Ortto)", color: "#18c2e0", website: "https://ortto.com", docs: "https://help.ortto.com/developer/latest/api-reference/",
    baseUrl: "https://{{host}}/v1", fields: [{ key: "host", label: "API-host (regio)", default: "api.ap3api.com", placeholder: "api.eu.ap3api.com of api.au.ap3api.com" }],
    auth: { type: "apiKey", in: "header", name: "X-Api-Key", label: "API-key (custom API-databron)" }, test: "tags",
    operations: [
      { id: "person.merge", resource: "Persoon", label: "Persoon maken of bijwerken", method: "POST", path: "/person/merge", body: { people: [{ fields: { "str::email": "{{email}}", "str::first": "{{firstName}}", "str::last": "{{lastName}}", "phn::phone": "{{phone}}" }, tags: "{{tags}}" }], merge_by: ["str::email"], async: false },
        params: [P("email", "E-mail", { required: true }), P("firstName", "Voornaam"), P("lastName", "Achternaam"), json("phone", "Telefoon (object)", { placeholder: '{"c":"31","n":"612345678"}' }), P("tags", "Tags", { format: "list" })] },
      { id: "person.get", resource: "Persoon", label: "Personen ophalen", method: "POST", path: "/person/get", output: "contacts", body: { limit: "{{limit}}", fields: "{{fields}}", filter: "{{filter}}" },
        params: [num("limit", "Aantal", { default: 50 }), P("fields", "Velden", { format: "list", default: "str::email,str::first,str::last" }), json("filter", "Filter", { placeholder: '{"$str::is":{"field_id":"str::email","value":"jan@example.nl"}}' })] },
      { id: "activity.create", resource: "Activiteit", label: "Activiteit vastleggen", method: "POST", path: "/activities/create", body: { activities: [{ activity_id: "{{activityId}}", attributes: "{{attributes}}", fields: { "str::email": "{{email}}" } }], merge_by: ["str::email"] },
        params: [P("activityId", "Activiteit-ID", { required: true, placeholder: "act:cm:aankoop" }), P("email", "E-mail", { required: true }), json("attributes", "Attributen")] },
      { id: "tags", resource: "Tag", label: "Tags", method: "POST", path: "/tags/get", body: {} }
    ] },
  { id: "egoi", name: "E-goi", category: "Marketing", description: "Contacten, lijsten en tags", color: "#00aeef", website: "https://e-goi.com", docs: "https://developers.e-goi.com/api/v3/",
    baseUrl: "https://api.egoiapp.com", auth: { type: "apiKey", in: "header", name: "Apikey", label: "API-key" }, test: "account",
    operations: [
      { id: "list.list", resource: "Lijst", label: "Lijsten", method: "GET", path: "/lists", output: "items", params: [q("limit", "Aantal", { default: "50" })] },
      { id: "contact.create", resource: "Contact", label: "Contact toevoegen", method: "POST", path: "/lists/{{listId}}/contacts", body: { base: { email: "{{email}}", first_name: "{{firstName}}", last_name: "{{lastName}}", cellphone: "{{cellphone}}", status: "{{status}}" } },
        params: [path("listId", "Lijst-ID"), P("email", "E-mail", { required: true }), P("firstName", "Voornaam"), P("lastName", "Achternaam"), P("cellphone", "Mobiel (landcode-nummer)", { placeholder: "31-612345678" }), P("status", "Status", { options: ["active", "inactive", "unconfirmed"], default: "active" })] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/lists/{{listId}}/contacts/{{contactId}}", params: [path("listId", "Lijst-ID"), path("contactId", "Contact-ID")] },
      { id: "contact.list", resource: "Contact", label: "Contacten", method: "GET", path: "/lists/{{listId}}/contacts", output: "items", params: [path("listId", "Lijst-ID"), q("email", "E-mail"), q("limit", "Aantal", { default: "50" })] },
      { id: "contact.update", resource: "Contact", label: "Contact bijwerken", method: "PATCH", path: "/lists/{{listId}}/contacts/{{contactId}}", body: { base: "{{fields}}" }, params: [path("listId", "Lijst-ID"), path("contactId", "Contact-ID"), json("fields", "Velden", { required: true, placeholder: '{"first_name":"Jan"}' })] },
      { id: "contact.tag", resource: "Contact", label: "Tag koppelen", method: "POST", path: "/lists/{{listId}}/contacts/actions/attach-tag", params: [path("listId", "Lijst-ID"), num("tag_id", "Tag-ID", { required: true }), P("contacts", "Contact-ID's", { required: true, format: "list" })] },
      { id: "contact.unsubscribe", resource: "Contact", label: "Afmelden", method: "POST", path: "/lists/{{listId}}/contacts/actions/unsubscribe", params: [path("listId", "Lijst-ID"), P("contacts", "Contact-ID's", { required: true, format: "list" })] },
      { id: "account", resource: "Account", label: "Mijn account", method: "GET", path: "/my-account" }
    ] },
  { id: "emelia", name: "Emelia", category: "Marketing", description: "Cold-mailcampagnes: campagnes en contacten", color: "#6c5ce7", website: "https://emelia.io", docs: "https://docs.emelia.io/docs/api-reference",
    baseUrl: "https://graphql.emelia.io", auth: { type: "apiKey", in: "header", name: "Authorization", label: "API-key" }, graphqlErrors: true, test: "campaign.list",
    operations: [
      { id: "campaign.list", resource: "Campagne", label: "Campagnes", method: "POST", path: "/graphql", output: "data.all_campaigns", body: { query: "query { all_campaigns { _id name status createdAt provider plannedStart } }" } },
      { id: "campaign.get", resource: "Campagne", label: "Campagne ophalen", method: "POST", path: "/graphql", output: "data.campaign", body: { query: "query campaign($id: ID!) { campaign(id: $id) { _id name status createdAt stats { mailsSent uniqueOpens replied bounced } } }", variables: { id: "{{id}}" } }, params: [P("id", "Campagne-ID", { required: true })] },
      { id: "contact.add", resource: "Contact", label: "Contact aan campagne toevoegen", method: "POST", path: "/graphql", output: "data.addContactToCampaignHook", body: { query: "mutation addContactToCampaignHook($id: ID!, $contact: JSON!) { addContactToCampaignHook(id: $id, contact: $contact) }", variables: { id: "{{campaignId}}", contact: { email: "{{email}}", firstName: "{{firstName}}", lastName: "{{lastName}}", company: "{{company}}", custom: "{{custom}}" } } },
        params: [P("campaignId", "Campagne-ID", { required: true }), P("email", "E-mail", { required: true }), P("firstName", "Voornaam"), P("lastName", "Achternaam"), P("company", "Bedrijf"), json("custom", "Eigen velden")] },
      { id: "graphql", resource: "GraphQL", label: "Eigen GraphQL-query", method: "POST", path: "/graphql", params: [P("query", "Query", { type: "text", required: true }), json("variables", "Variabelen")] }
    ] },
  { id: "sendy", name: "Sendy", category: "Marketing", description: "Abonnees, lijsten en campagnes (eigen Sendy-installatie)", color: "#ef6c00", website: "https://sendy.co", docs: "https://sendy.co/api",
    baseUrl: "{{url}}", fields: [urlField("Adres van je Sendy", "https://nieuwsbrief.bedrijf.nl")],
    auth: { type: "headers", headers: {}, fields: [{ key: "apiKey", label: "API-key", secret: true }], help: "Sendy → Settings → API key." },
    operations: [
      { id: "subscribe", resource: "Abonnee", label: "Aanmelden", method: "POST", path: "/subscribe", bodyType: "form", body: { api_key: "{{apiKey}}", list: "{{list}}", email: "{{email}}", name: "{{name}}", country: "{{country}}", gdpr: "{{gdpr}}", silent: "{{silent}}", boolean: "true" },
        params: [P("list", "Lijst-ID", { required: true }), P("email", "E-mail", { required: true }), P("name", "Naam"), P("country", "Land (ISO)"), P("gdpr", "AVG-toestemming", { options: ["", "true"] }), P("silent", "Zonder bevestigingsmail", { options: ["", "true"] })] },
      { id: "unsubscribe", resource: "Abonnee", label: "Afmelden", method: "POST", path: "/unsubscribe", bodyType: "form", body: { api_key: "{{apiKey}}", list: "{{list}}", email: "{{email}}", boolean: "true" }, params: [P("list", "Lijst-ID", { required: true }), P("email", "E-mail", { required: true })] },
      { id: "delete", resource: "Abonnee", label: "Verwijderen", method: "POST", path: "/api/subscribers/delete.php", bodyType: "form", body: { api_key: "{{apiKey}}", list_id: "{{list}}", email: "{{email}}" }, params: [P("list", "Lijst-ID", { required: true }), P("email", "E-mail", { required: true })] },
      { id: "status", resource: "Abonnee", label: "Status", method: "POST", path: "/api/subscribers/subscription-status.php", bodyType: "form", body: { api_key: "{{apiKey}}", list_id: "{{list}}", email: "{{email}}" }, params: [P("list", "Lijst-ID", { required: true }), P("email", "E-mail", { required: true })] },
      { id: "count", resource: "Lijst", label: "Aantal actieve abonnees", method: "POST", path: "/api/subscribers/active-subscriber-count.php", bodyType: "form", body: { api_key: "{{apiKey}}", list_id: "{{list}}" }, params: [P("list", "Lijst-ID", { required: true })] },
      { id: "lists", resource: "Lijst", label: "Lijsten van een merk", method: "POST", path: "/api/lists/get-lists.php", bodyType: "form", body: { api_key: "{{apiKey}}", brand_id: "{{brand}}", include_hidden: "{{hidden}}" }, params: [P("brand", "Merk-ID", { required: true }), P("hidden", "Verborgen lijsten", { options: ["", "yes"] })] },
      { id: "campaign.create", resource: "Campagne", label: "Campagne maken/versturen", method: "POST", path: "/api/campaigns/create.php", bodyType: "form",
        body: { api_key: "{{apiKey}}", from_name: "{{fromName}}", from_email: "{{fromEmail}}", reply_to: "{{replyTo}}", title: "{{title}}", subject: "{{subject}}", html_text: "{{html}}", plain_text: "{{text}}", list_ids: "{{listIds}}", brand_id: "{{brand}}", send_campaign: "{{send}}" },
        params: [P("fromName", "Afzender", { required: true }), P("fromEmail", "Afzenderadres", { required: true }), P("replyTo", "Antwoordadres", { required: true }), P("title", "Titel", { required: true }), P("subject", "Onderwerp", { required: true }), P("html", "HTML", { type: "text", required: true }), P("text", "Platte tekst", { type: "text" }), P("listIds", "Lijst-ID's (komma)"), P("brand", "Merk-ID"), P("send", "Direct versturen", { options: ["0", "1"], default: "0" })] }
    ] },
  { id: "tapfiliate", name: "Tapfiliate", category: "Marketing", description: "Affiliates, conversies, commissies en programma's", color: "#34495e", website: "https://tapfiliate.com", docs: "https://tapfiliate.com/docs/rest/",
    baseUrl: "https://api.tapfiliate.com/1.6", auth: { type: "apiKey", in: "header", name: "X-Api-Key", label: "API-key" }, test: "program.list",
    operations: [
      { id: "affiliate.list", resource: "Affiliate", label: "Affiliates", method: "GET", path: "/affiliates/", params: [q("email", "E-mail"), q("page", "Pagina")] },
      { id: "affiliate.get", resource: "Affiliate", label: "Affiliate ophalen", method: "GET", path: "/affiliates/{{id}}/", params: [path("id", "Affiliate-ID")] },
      { id: "affiliate.create", resource: "Affiliate", label: "Affiliate maken", method: "POST", path: "/affiliates/", params: [P("firstname", "Voornaam", { required: true }), P("lastname", "Achternaam", { required: true }), P("email", "E-mail", { required: true }), json("company", "Bedrijf", { placeholder: '{"name":"Voorbeeld BV"}' })] },
      { id: "affiliate.delete", resource: "Affiliate", label: "Affiliate verwijderen", method: "DELETE", path: "/affiliates/{{id}}/", params: [path("id", "Affiliate-ID")] },
      { id: "affiliate.meta", resource: "Affiliate", label: "Metadata zetten", method: "PUT", path: "/affiliates/{{id}}/meta-data/", bodyParam: "meta", params: [path("id", "Affiliate-ID"), json("meta", "Metadata", { required: true })] },
      { id: "program.list", resource: "Programma", label: "Programma's", method: "GET", path: "/programs/" },
      { id: "program.addAffiliate", resource: "Programma", label: "Affiliate aan programma", method: "POST", path: "/programs/{{programId}}/affiliates/", body: { affiliate: { id: "{{affiliateId}}" }, approved: "{{approved}}" }, params: [path("programId", "Programma-ID"), P("affiliateId", "Affiliate-ID", { required: true }), bool("approved", "Goedgekeurd", { default: true })] },
      { id: "conversion.create", resource: "Conversie", label: "Conversie vastleggen", method: "POST", path: "/conversions/", params: [P("referral_code", "Referral-code"), P("customer_id", "Klant-ID"), P("external_id", "Extern ID (order)"), num("amount", "Bedrag"), P("click_id", "Click-ID"), P("program_group", "Programmagroep")] },
      { id: "conversion.list", resource: "Conversie", label: "Conversies", method: "GET", path: "/conversions/", params: [q("program_id", "Programma-ID"), q("date_from", "Vanaf (JJJJ-MM-DD)"), q("date_to", "Tot")] },
      { id: "commission.approve", resource: "Commissie", label: "Commissie goedkeuren", method: "PUT", path: "/commissions/{{id}}/approval/", params: [path("id", "Commissie-ID")] },
      { id: "customer.create", resource: "Klant", label: "Klant maken", method: "POST", path: "/customers/", params: [P("customer_id", "Klant-ID", { required: true }), P("referral_code", "Referral-code"), P("click_id", "Click-ID"), P("status", "Status", { options: ["trial", "new", "paying"] })] }
    ] },
  { id: "vero", name: "Vero", category: "Marketing", description: "Gebruikers, tags en events voor e-mailmarketing", color: "#0acf97", website: "https://getvero.com", docs: "https://developers.getvero.com/",
    baseUrl: "https://api.getvero.com/api/v2", auth: { type: "headers", headers: {}, fields: [{ key: "authToken", label: "Auth token", secret: true }], help: "Vero → Settings → API credentials → Auth token." },
    operations: [
      { id: "user.identify", resource: "Gebruiker", label: "Gebruiker maken/bijwerken", method: "POST", path: "/users/track", body: { auth_token: "{{authToken}}", id: "{{id}}", email: "{{email}}", data: "{{data}}" }, params: [P("id", "Gebruikers-ID", { required: true }), P("email", "E-mail"), json("data", "Eigenschappen", { placeholder: '{"first_name":"Jan"}' })] },
      { id: "user.alias", resource: "Gebruiker", label: "ID wijzigen (alias)", method: "PUT", path: "/users/reidentify", body: { auth_token: "{{authToken}}", id: "{{id}}", new_id: "{{newId}}" }, params: [P("id", "Huidig ID", { required: true }), P("newId", "Nieuw ID", { required: true })] },
      { id: "user.tags", resource: "Gebruiker", label: "Tags wijzigen", method: "PUT", path: "/users/tags/edit", body: { auth_token: "{{authToken}}", id: "{{id}}", add: "{{add}}", remove: "{{remove}}" }, params: [P("id", "Gebruikers-ID", { required: true }), P("add", "Toevoegen", { format: "list" }), P("remove", "Verwijderen", { format: "list" })] },
      { id: "user.unsubscribe", resource: "Gebruiker", label: "Afmelden", method: "POST", path: "/users/unsubscribe", body: { auth_token: "{{authToken}}", id: "{{id}}" }, params: [P("id", "Gebruikers-ID", { required: true })] },
      { id: "user.resubscribe", resource: "Gebruiker", label: "Weer aanmelden", method: "POST", path: "/users/resubscribe", body: { auth_token: "{{authToken}}", id: "{{id}}" }, params: [P("id", "Gebruikers-ID", { required: true })] },
      { id: "user.delete", resource: "Gebruiker", label: "Verwijderen", method: "POST", path: "/users/delete", body: { auth_token: "{{authToken}}", id: "{{id}}" }, params: [P("id", "Gebruikers-ID", { required: true })] },
      { id: "event.track", resource: "Event", label: "Event vastleggen", method: "POST", path: "/events/track", body: { auth_token: "{{authToken}}", identity: { id: "{{id}}", email: "{{email}}" }, event_name: "{{event}}", data: "{{data}}" },
        params: [P("id", "Gebruikers-ID", { required: true }), P("email", "E-mail"), P("event", "Eventnaam", { required: true }), json("data", "Gegevens")] }
    ] },
  { id: "profitwell", name: "ProfitWell", category: "Analyse", description: "Abonnementsmetrics (MRR, churn) en abonnementen", color: "#1d4ed8", website: "https://www.paddle.com/profitwell-metrics", docs: "https://profitwellapiv2.docs.apiary.io/",
    baseUrl: "https://api.profitwell.com/v2", auth: { type: "apiKey", in: "header", name: "Authorization", label: "API-token" }, test: "settings",
    operations: [
      { id: "metrics.monthly", resource: "Metrics", label: "Maandcijfers", method: "GET", path: "/metrics/monthly/", output: "data", params: [q("metrics", "Metrics", { placeholder: "recurring_revenue,active_customers,churned_customers" }), q("plan_id", "Plan-ID")] },
      { id: "metrics.daily", resource: "Metrics", label: "Dagcijfers", method: "GET", path: "/metrics/daily/", output: "data", params: [q("month", "Maand (JJJJ-MM)", { required: true }), q("metrics", "Metrics")] },
      { id: "subscription.create", resource: "Abonnement", label: "Abonnement maken", method: "POST", path: "/subscriptions/", params: [P("user_email", "E-mail", { required: true }), P("user_alias", "Klant-alias"), P("plan_id", "Plan-ID", { required: true }), P("plan_interval", "Interval", { options: ["month", "year"], default: "month" }), num("value", "Bedrag (centen)", { required: true }), num("effective_date", "Ingangsdatum (unix)", { required: true })] },
      { id: "subscription.churn", resource: "Abonnement", label: "Abonnement opzeggen", method: "DELETE", path: "/subscriptions/{{id}}/", params: [path("id", "Abonnement-ID of alias"), q("effective_date", "Opzegdatum (unix)", { required: true }), q("churn_type", "Type", { options: ["voluntary", "delinquent"] })] },
      { id: "customer.get", resource: "Klant", label: "Klanthistorie", method: "GET", path: "/users/{{id}}/", params: [path("id", "Klant-ID")] },
      { id: "settings", resource: "Account", label: "Bedrijfsinstellingen", method: "GET", path: "/company/settings/" }
    ] },
  { id: "phantombuster", name: "Phantombuster", category: "Marketing", description: "Scraping- en automatiseringsagents starten en uitvoer ophalen", color: "#1e1b4b", website: "https://phantombuster.com", docs: "https://hub.phantombuster.com/reference",
    baseUrl: "https://api.phantombuster.com/api/v2", auth: { type: "apiKey", in: "header", name: "X-Phantombuster-Key", label: "API-key" }, test: "org",
    operations: [
      { id: "agent.list", resource: "Agent", label: "Agents", method: "GET", path: "/agents/fetch-all" },
      { id: "agent.get", resource: "Agent", label: "Agent ophalen", method: "GET", path: "/agents/fetch", params: [q("id", "Agent-ID", { required: true })] },
      { id: "agent.launch", resource: "Agent", label: "Agent starten", method: "POST", path: "/agents/launch", params: [P("id", "Agent-ID", { required: true }), json("argument", "Argument", { placeholder: '{"spreadsheetUrl":"…"}' }), P("output", "Uitvoer", { options: ["first-result-object", "result-object", "result-object-with-output", "file-mgmt"] })] },
      { id: "agent.output", resource: "Agent", label: "Uitvoer ophalen", method: "GET", path: "/agents/fetch-output", params: [q("id", "Agent-ID", { required: true })] },
      { id: "agent.delete", resource: "Agent", label: "Agent verwijderen", method: "POST", path: "/agents/delete", params: [P("id", "Agent-ID", { required: true })] },
      { id: "container.result", resource: "Run", label: "Resultaat van een run", method: "GET", path: "/containers/fetch-result-object", params: [q("id", "Container-ID", { required: true })] },
      { id: "org", resource: "Account", label: "Organisatie", method: "GET", path: "/orgs/fetch" }
    ] },

  // ---------------------------------------------------------------- events en webinars
  { id: "demio", name: "Demio", category: "Marketing", description: "Webinars en registraties", color: "#4b50e6", website: "https://demio.com", docs: "https://publicapi.demio.com/",
    baseUrl: "https://my.demio.com/api/v1", auth: { type: "headers", headers: { "Api-Key": "{{apiKey}}", "Api-Secret": "{{apiSecret}}" }, fields: [{ key: "apiKey", label: "API-key", secret: true }, { key: "apiSecret", label: "API-secret", secret: true }], help: "Demio → Settings → API." }, test: "ping",
    operations: [
      { id: "event.list", resource: "Webinar", label: "Webinars", method: "GET", path: "/events", params: [q("type", "Soort", { options: ["upcoming", "past", "automated"], default: "upcoming" })] },
      { id: "event.get", resource: "Webinar", label: "Webinar ophalen", method: "GET", path: "/event/{{id}}", params: [path("id", "Webinar-ID"), q("active", "Alleen actieve sessies")] },
      { id: "event.register", resource: "Webinar", label: "Deelnemer registreren", method: "PUT", path: "/event/register", params: [num("id", "Webinar-ID", { required: true }), num("date_id", "Sessie-ID"), P("name", "Naam", { required: true }), P("email", "E-mail", { required: true }), P("last_name", "Achternaam"), P("company", "Bedrijf"), P("phone_number", "Telefoon"), P("ref_url", "Registratiepagina")] },
      { id: "session.participants", resource: "Sessie", label: "Deelnemers van een sessie", method: "GET", path: "/report/{{dateId}}/participants", params: [path("dateId", "Sessie-ID"), q("status", "Status", { options: ["attended", "did-not-attend", "completed", "left-early", "banned"] })] },
      { id: "ping", resource: "Account", label: "Verbinding testen", method: "GET", path: "/ping" }
    ] },
  { id: "eventbrite", name: "Eventbrite", category: "Marketing", description: "Events, deelnemers en bestellingen", color: "#f05537", website: "https://eventbrite.com", docs: "https://www.eventbrite.com/platform/api",
    baseUrl: "https://www.eventbriteapi.com/v3", auth: { type: "bearer", label: "Private token", help: "Eventbrite → Account settings → Developer links → API keys → Private token." }, test: "me",
    operations: [
      { id: "org.list", resource: "Organisatie", label: "Mijn organisaties", method: "GET", path: "/users/me/organizations/", output: "organizations" },
      { id: "event.list", resource: "Event", label: "Events van een organisatie", method: "GET", path: "/organizations/{{orgId}}/events/", output: "events", params: [path("orgId", "Organisatie-ID"), q("status", "Status", { options: ["live", "draft", "started", "ended", "completed", "canceled", "all"], default: "live" }), q("time_filter", "Tijd", { options: ["current_future", "past", "all"] })] },
      { id: "event.get", resource: "Event", label: "Event ophalen", method: "GET", path: "/events/{{id}}/", params: [path("id", "Event-ID"), q("expand", "Uitbreiden", { placeholder: "venue,ticket_classes" })] },
      { id: "event.create", resource: "Event", label: "Event maken (concept)", method: "POST", path: "/organizations/{{orgId}}/events/",
        body: { event: { name: { html: "{{name}}" }, description: { html: "{{description}}" }, start: { timezone: "{{timezone}}", utc: "{{start}}" }, end: { timezone: "{{timezone}}", utc: "{{end}}" }, currency: "{{currency}}", online_event: "{{online}}" } },
        params: [path("orgId", "Organisatie-ID"), P("name", "Naam", { required: true }), P("description", "Omschrijving (HTML)"), P("start", "Start (UTC, 2026-10-01T17:00:00Z)", { required: true }), P("end", "Einde (UTC)", { required: true }), P("timezone", "Tijdzone", { default: "Europe/Amsterdam" }), P("currency", "Valuta", { default: "EUR" }), bool("online", "Online event")] },
      { id: "event.publish", resource: "Event", label: "Event publiceren", method: "POST", path: "/events/{{id}}/publish/", params: [path("id", "Event-ID")] },
      { id: "attendee.list", resource: "Deelnemer", label: "Deelnemers", method: "GET", path: "/events/{{id}}/attendees/", output: "attendees", params: [path("id", "Event-ID"), q("status", "Status", { options: ["attending", "not_attending", "unpaid"] }), q("changed_since", "Gewijzigd sinds (ISO)")] },
      { id: "order.list", resource: "Bestelling", label: "Bestellingen van een event", method: "GET", path: "/events/{{id}}/orders/", output: "orders", params: [path("id", "Event-ID"), q("status", "Status", { options: ["active", "inactive", "both", "all_not_deleted"] }), q("changed_since", "Gewijzigd sinds (ISO)")] },
      { id: "order.get", resource: "Bestelling", label: "Bestelling ophalen", method: "GET", path: "/orders/{{id}}/", params: [path("id", "Bestelling-ID"), q("expand", "Uitbreiden", { placeholder: "attendees,event" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me/" }
    ] },
  { id: "gotowebinar", name: "GoTo Webinar", category: "Marketing", description: "Webinars, registraties en deelnemers", color: "#0f766e", website: "https://goto.com/webinar", docs: "https://developer.goto.com/GoToWebinarV2",
    baseUrl: "https://api.getgo.com/G2W/rest/v2", tokenFields: { organizer_key: "organizerKey", account_key: "accountKey" },
    auth: { type: "oauth2", authUrl: "https://authentication.logmeininc.com/oauth/authorize", tokenUrl: "https://authentication.logmeininc.com/oauth/token", scopes: [], tokenAuth: "basic", help: "Maak een OAuth-client op developer.goto.com met de redirect-URI hieronder en de scopes voor GoTo Webinar." },
    operations: [
      { id: "webinar.list", resource: "Webinar", label: "Webinars in periode", method: "GET", path: "/organizers/{{organizerKey}}/webinars", output: "_embedded.webinars", params: [q("fromTime", "Vanaf (ISO)", { required: true }), q("toTime", "Tot (ISO)", { required: true }), q("size", "Aantal", { default: "50" })] },
      { id: "webinar.get", resource: "Webinar", label: "Webinar ophalen", method: "GET", path: "/organizers/{{organizerKey}}/webinars/{{webinarKey}}", params: [path("webinarKey", "Webinar-key")] },
      { id: "webinar.create", resource: "Webinar", label: "Webinar maken", method: "POST", path: "/organizers/{{organizerKey}}/webinars", body: { subject: "{{subject}}", description: "{{description}}", times: [{ startTime: "{{startTime}}", endTime: "{{endTime}}" }], timeZone: "{{timeZone}}", type: "single_session" },
        params: [P("subject", "Onderwerp", { required: true }), P("description", "Omschrijving"), P("startTime", "Start (ISO, UTC)", { required: true }), P("endTime", "Einde (ISO, UTC)", { required: true }), P("timeZone", "Tijdzone", { default: "Europe/Amsterdam" })] },
      { id: "registrant.list", resource: "Registratie", label: "Registraties", method: "GET", path: "/organizers/{{organizerKey}}/webinars/{{webinarKey}}/registrants", params: [path("webinarKey", "Webinar-key")] },
      { id: "registrant.create", resource: "Registratie", label: "Deelnemer registreren", method: "POST", path: "/organizers/{{organizerKey}}/webinars/{{webinarKey}}/registrants", params: [path("webinarKey", "Webinar-key"), P("firstName", "Voornaam", { required: true }), P("lastName", "Achternaam", { required: true }), P("email", "E-mail", { required: true }), P("organization", "Organisatie"), P("jobTitle", "Functie")] },
      { id: "registrant.delete", resource: "Registratie", label: "Registratie verwijderen", method: "DELETE", path: "/organizers/{{organizerKey}}/webinars/{{webinarKey}}/registrants/{{registrantKey}}", params: [path("webinarKey", "Webinar-key"), path("registrantKey", "Registrant-key")] },
      { id: "session.list", resource: "Sessie", label: "Sessies van een webinar", method: "GET", path: "/organizers/{{organizerKey}}/webinars/{{webinarKey}}/sessions", params: [path("webinarKey", "Webinar-key")] },
      { id: "attendee.list", resource: "Deelnemer", label: "Deelnemers van een sessie", method: "GET", path: "/organizers/{{organizerKey}}/webinars/{{webinarKey}}/sessions/{{sessionKey}}/attendees", params: [path("webinarKey", "Webinar-key"), path("sessionKey", "Sessie-key")] }
    ] },

  // ---------------------------------------------------------------- Google en Facebook marketing
  { id: "google-ads", name: "Google Ads", category: "Marketing", description: "Campagnes en rapportages (GAQL)", color: "#4285f4", website: "https://ads.google.com", docs: "https://developers.google.com/google-ads/api/rest/overview",
    baseUrl: "https://googleads.googleapis.com/{{apiVersion}}", auth: google([`${GS}adwords`]),
    fields: [{ key: "developerToken", label: "Developer token", secret: true, help: "Google Ads → Tools → API Center." }, { key: "loginCustomerId", label: "Manager-account-ID (MCC, zonder streepjes)" }, { key: "apiVersion", label: "API-versie", default: "v23", help: "Google verhoogt de versie een paar keer per jaar." }],
    headers: { "developer-token": "{{developerToken}}", "login-customer-id": "{{loginCustomerId}}" }, test: "customers",
    operations: [
      { id: "search", resource: "Rapport", label: "Query (GAQL)", method: "POST", path: "/customers/{{customerId}}/googleAds:search", output: "results", params: [path("customerId", "Klant-ID (zonder streepjes)"), P("query", "GAQL", { type: "text", required: true, placeholder: "SELECT campaign.name, metrics.clicks FROM campaign WHERE segments.date DURING LAST_7_DAYS" }), num("pageSize", "Aantal")] },
      { id: "campaign.report", resource: "Campagne", label: "Campagnes met cijfers", method: "POST", path: "/customers/{{customerId}}/googleAds:search", output: "results",
        body: { query: "SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING {{period}}" },
        params: [path("customerId", "Klant-ID (zonder streepjes)"), P("period", "Periode", { options: ["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_30_DAYS", "THIS_MONTH", "LAST_MONTH"], default: "LAST_7_DAYS" })] },
      { id: "campaign.status", resource: "Campagne", label: "Campagne pauzeren/activeren", method: "POST", path: "/customers/{{customerId}}/campaigns:mutate", body: { operations: [{ update: { resourceName: "customers/{{customerId}}/campaigns/{{campaignId}}", status: "{{status}}" }, updateMask: "status" }] },
        params: [path("customerId", "Klant-ID"), P("campaignId", "Campagne-ID", { required: true }), P("status", "Status", { options: ["PAUSED", "ENABLED"], required: true })] },
      { id: "customers", resource: "Account", label: "Toegankelijke accounts", method: "GET", path: "/customers:listAccessibleCustomers", output: "resourceNames" }
    ] },
  { id: "google-business-profile", name: "Google Business Profile", category: "Marketing", description: "Locaties, reviews en berichten van je bedrijfsprofiel", color: "#34a853", website: "https://business.google.com", docs: "https://developers.google.com/my-business",
    baseUrl: "https://mybusiness.googleapis.com/v4", auth: google([`${GS}business.manage`]), test: "account.list",
    operations: [
      { id: "account.list", resource: "Account", label: "Accounts", method: "GET", baseUrl: "https://mybusinessaccountmanagement.googleapis.com/v1", path: "/accounts", output: "accounts" },
      { id: "location.list", resource: "Locatie", label: "Locaties", method: "GET", baseUrl: "https://mybusinessbusinessinformation.googleapis.com/v1", path: "/accounts/{{accountId}}/locations", output: "locations", params: [path("accountId", "Account-ID"), q("readMask", "Velden", { default: "name,title,storefrontAddress,phoneNumbers,websiteUri" })] },
      { id: "review.list", resource: "Review", label: "Reviews", method: "GET", path: "/accounts/{{accountId}}/locations/{{locationId}}/reviews", output: "reviews", params: [path("accountId", "Account-ID"), path("locationId", "Locatie-ID"), q("pageSize", "Aantal", { default: "50" }), q("orderBy", "Sortering", { default: "updateTime desc" })] },
      { id: "review.reply", resource: "Review", label: "Review beantwoorden", method: "PUT", path: "/accounts/{{accountId}}/locations/{{locationId}}/reviews/{{reviewId}}/reply", params: [path("accountId", "Account-ID"), path("locationId", "Locatie-ID"), path("reviewId", "Review-ID"), P("comment", "Antwoord", { type: "text", required: true })] },
      { id: "review.deleteReply", resource: "Review", label: "Antwoord verwijderen", method: "DELETE", path: "/accounts/{{accountId}}/locations/{{locationId}}/reviews/{{reviewId}}/reply", params: [path("accountId", "Account-ID"), path("locationId", "Locatie-ID"), path("reviewId", "Review-ID")] },
      { id: "post.create", resource: "Bericht", label: "Bericht plaatsen", method: "POST", path: "/accounts/{{accountId}}/locations/{{locationId}}/localPosts", body: { languageCode: "{{language}}", summary: "{{summary}}", topicType: "STANDARD", callToAction: { $if: "{{ctaUrl}}", actionType: "{{ctaType}}", url: "{{ctaUrl}}" } },
        params: [path("accountId", "Account-ID"), path("locationId", "Locatie-ID"), P("summary", "Tekst", { type: "text", required: true }), P("language", "Taal", { default: "nl" }), P("ctaType", "Knop", { options: ["LEARN_MORE", "BOOK", "ORDER", "SHOP", "SIGN_UP", "CALL"], default: "LEARN_MORE" }), P("ctaUrl", "Knop-URL")] },
      { id: "post.list", resource: "Bericht", label: "Berichten", method: "GET", path: "/accounts/{{accountId}}/locations/{{locationId}}/localPosts", output: "localPosts", params: [path("accountId", "Account-ID"), path("locationId", "Locatie-ID")] }
    ] },
  { id: "facebook-lead-ads", name: "Facebook Lead Ads", category: "Marketing", description: "Leadformulieren en leads ophalen", color: "#1877f2", website: "https://www.facebook.com/business/ads/lead-ads", docs: "https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving",
    baseUrl: "https://graph.facebook.com/{{apiVersion}}", fields: [{ key: "apiVersion", label: "Graph API-versie", default: "v23.0" }],
    auth: { type: "bearer", label: "Page access token", help: "Een (langlevend) page access token met leads_retrieval en pages_manage_ads." }, test: "me",
    operations: [
      { id: "form.list", resource: "Formulier", label: "Leadformulieren van een pagina", method: "GET", path: "/{{pageId}}/leadgen_forms", output: "data", params: [path("pageId", "Pagina-ID"), q("fields", "Velden", { default: "id,name,status,leads_count,created_time" })] },
      { id: "lead.list", resource: "Lead", label: "Leads van een formulier", method: "GET", path: "/{{formId}}/leads", output: "data", params: [path("formId", "Formulier-ID"), q("filtering", "Filter", { placeholder: '[{"field":"time_created","operator":"GREATER_THAN","value":1735689600}]' }), q("limit", "Aantal", { default: "100" })] },
      { id: "lead.get", resource: "Lead", label: "Lead ophalen", method: "GET", path: "/{{leadId}}", params: [path("leadId", "Lead-ID"), q("fields", "Velden", { default: "created_time,field_data,ad_id,form_id,campaign_id" })] },
      { id: "me", resource: "Account", label: "Wie ben ik", method: "GET", path: "/me" }
    ] }
];
