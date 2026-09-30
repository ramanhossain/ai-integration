import type { PluginDef } from "../types";
import { P, bool, json, num, path, q, urlField } from "./_shared";

// Verkoop & CRM, marketing en klantenservice.
export const CRM: PluginDef[] = [
  {
    id: "hubspot", name: "HubSpot", category: "Verkoop & CRM", description: "Contacten, bedrijven, deals en tickets", color: "#ff7a59",
    website: "https://hubspot.com", docs: "https://developers.hubspot.com/docs/api/crm/understanding-the-crm",
    baseUrl: "https://api.hubapi.com", auth: { type: "bearer", label: "Private app access token", help: "HubSpot → Instellingen → Integraties → Private apps; geef de CRM-scopes die je nodig hebt." }, test: "contact.list",
    operations: [
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/crm/v3/objects/contacts", params: [P("properties.email", "E-mail", { required: true }), P("properties.firstname", "Voornaam"), P("properties.lastname", "Achternaam"), P("properties.phone", "Telefoon"), P("properties.company", "Bedrijf")] },
      { id: "contact.upsert", resource: "Contact", label: "Contact bijwerken of maken (op e-mail)", method: "POST", path: "/crm/v3/objects/contacts/batch/upsert", body: { inputs: [{ idProperty: "email", id: "{{email}}", properties: "{{properties}}" }] },
        params: [P("email", "E-mail", { required: true }), json("properties", "Eigenschappen", { required: true, placeholder: '{"firstname":"Jan","lifecyclestage":"customer"}' })] },
      { id: "contact.list", resource: "Contact", label: "Contacten", method: "GET", path: "/crm/v3/objects/contacts", output: "results", params: [q("limit", "Aantal", { default: "20" }), q("properties", "Eigenschappen", { default: "email,firstname,lastname,company" })] },
      { id: "deal.create", resource: "Deal", label: "Deal maken", method: "POST", path: "/crm/v3/objects/deals", params: [P("properties.dealname", "Naam", { required: true }), P("properties.amount", "Bedrag"), P("properties.pipeline", "Pipeline", { default: "default" }), P("properties.dealstage", "Fase", { placeholder: "appointmentscheduled" }), P("properties.closedate", "Sluitdatum (ISO)")] },
      { id: "object.search", resource: "Object", label: "Zoeken (elk objecttype)", method: "POST", path: "/crm/v3/objects/{{objectType}}/search", output: "results",
        params: [path("objectType", "Objecttype", { default: "contacts", options: ["contacts", "companies", "deals", "tickets", "products"] }), json("filterGroups", "Filters", { placeholder: '[{"filters":[{"propertyName":"email","operator":"EQ","value":"{{email}}"}]}]' }), P("properties", "Eigenschappen", { format: "list" }), num("limit", "Aantal", { default: 20 })] },
      { id: "object.get", resource: "Object", label: "Object ophalen", method: "GET", path: "/crm/v3/objects/{{objectType}}/{{id}}", params: [path("objectType", "Objecttype", { default: "contacts" }), path("id", "ID"), q("properties", "Eigenschappen"), q("idProperty", "ID-eigenschap", { placeholder: "email" })] },
      { id: "object.create", resource: "Object", label: "Object maken", method: "POST", path: "/crm/v3/objects/{{objectType}}", params: [path("objectType", "Objecttype", { default: "companies" }), json("properties", "Eigenschappen", { required: true }), json("associations", "Koppelingen")] },
      { id: "object.update", resource: "Object", label: "Object bijwerken", method: "PATCH", path: "/crm/v3/objects/{{objectType}}/{{id}}", params: [path("objectType", "Objecttype", { default: "contacts" }), path("id", "ID"), json("properties", "Eigenschappen", { required: true })] },
      { id: "object.delete", resource: "Object", label: "Object archiveren", method: "DELETE", path: "/crm/v3/objects/{{objectType}}/{{id}}", params: [path("objectType", "Objecttype", { default: "contacts" }), path("id", "ID")] }
    ]
  },
  {
    id: "salesforce", name: "Salesforce", category: "Verkoop & CRM", description: "Leads, contacten, accounts, kansen en SOQL", color: "#00a1e0",
    website: "https://salesforce.com", docs: "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/",
    baseUrl: "{{instanceUrl}}/services/data/v61.0",
    auth: { type: "oauth2", authUrl: "https://{{loginHost}}/services/oauth2/authorize", tokenUrl: "https://{{loginHost}}/services/oauth2/token", scopes: ["api", "refresh_token"], help: "Maak een Connected App (of External Client App) met OAuth, callback-URL hieronder, scopes api en refresh_token." },
    fields: [{ key: "loginHost", label: "Login-host", default: "login.salesforce.com", placeholder: "test.salesforce.com voor een sandbox" }], tokenFields: { instance_url: "instanceUrl" }, test: "limits",
    operations: [
      { id: "query", resource: "SOQL", label: "SOQL-query", method: "GET", path: "/query", output: "records", params: [q("q", "SOQL", { required: true, placeholder: "SELECT Id, Name FROM Account WHERE Name LIKE 'Jan%'" })] },
      { id: "lead.create", resource: "Lead", label: "Lead maken", method: "POST", path: "/sobjects/Lead", params: [P("LastName", "Achternaam", { required: true }), P("FirstName", "Voornaam"), P("Company", "Bedrijf", { required: true }), P("Email", "E-mail"), P("Phone", "Telefoon"), P("LeadSource", "Bron")] },
      { id: "record.create", resource: "Record", label: "Record maken", method: "POST", path: "/sobjects/{{sobject}}", bodyParam: "fields", params: [path("sobject", "Object", { default: "Account", placeholder: "Account, Contact, Opportunity, Case" }), json("fields", "Velden", { required: true })] },
      { id: "record.get", resource: "Record", label: "Record ophalen", method: "GET", path: "/sobjects/{{sobject}}/{{id}}", params: [path("sobject", "Object"), path("id", "ID"), q("fields", "Velden")] },
      { id: "record.update", resource: "Record", label: "Record bijwerken", method: "PATCH", path: "/sobjects/{{sobject}}/{{id}}", bodyParam: "fields", params: [path("sobject", "Object"), path("id", "ID"), json("fields", "Velden", { required: true })] },
      { id: "record.upsert", resource: "Record", label: "Upsert op extern ID", method: "PATCH", path: "/sobjects/{{sobject}}/{{externalField}}/{{externalId}}", bodyParam: "fields", params: [path("sobject", "Object"), path("externalField", "Extern-ID-veld"), path("externalId", "Extern ID"), json("fields", "Velden", { required: true })] },
      { id: "record.delete", resource: "Record", label: "Record verwijderen", method: "DELETE", path: "/sobjects/{{sobject}}/{{id}}", params: [path("sobject", "Object"), path("id", "ID")] },
      { id: "describe", resource: "Object", label: "Objectbeschrijving (velden)", method: "GET", path: "/sobjects/{{sobject}}/describe", params: [path("sobject", "Object")] },
      { id: "limits", resource: "Account", label: "Limieten", method: "GET", path: "/limits" }
    ]
  },
  {
    id: "pipedrive", name: "Pipedrive", category: "Verkoop & CRM", description: "Deals, personen, organisaties en activiteiten", color: "#1a1a1a",
    website: "https://pipedrive.com", docs: "https://developers.pipedrive.com/docs/api/v1",
    baseUrl: "https://api.pipedrive.com/v1", auth: { type: "apiKey", in: "query", name: "api_token", label: "API-token" }, test: "me",
    operations: [
      { id: "deal.create", resource: "Deal", label: "Deal maken", method: "POST", path: "/deals", output: "data", params: [P("title", "Titel", { required: true }), num("value", "Waarde"), P("currency", "Valuta", { default: "EUR" }), num("person_id", "Persoon-ID"), num("org_id", "Organisatie-ID"), num("stage_id", "Fase-ID")] },
      { id: "deal.get", resource: "Deal", label: "Deal ophalen", method: "GET", path: "/deals/{{id}}", output: "data", params: [path("id", "Deal-ID")] },
      { id: "deal.update", resource: "Deal", label: "Deal bijwerken", method: "PUT", path: "/deals/{{id}}", output: "data", params: [path("id", "Deal-ID"), P("title", "Titel"), num("value", "Waarde"), P("status", "Status", { options: ["open", "won", "lost"] }), num("stage_id", "Fase-ID")] },
      { id: "deal.list", resource: "Deal", label: "Deals", method: "GET", path: "/deals", output: "data", params: [q("status", "Status", { default: "open" }), q("limit", "Aantal", { default: "50" })] },
      { id: "person.create", resource: "Persoon", label: "Persoon maken", method: "POST", path: "/persons", output: "data", params: [P("name", "Naam", { required: true }), P("email", "E-mail"), P("phone", "Telefoon"), num("org_id", "Organisatie-ID")] },
      { id: "person.search", resource: "Persoon", label: "Persoon zoeken", method: "GET", path: "/persons/search", output: "data.items", params: [q("term", "Zoekterm", { required: true }), q("fields", "Velden", { default: "email,name" })] },
      { id: "organization.create", resource: "Organisatie", label: "Organisatie maken", method: "POST", path: "/organizations", output: "data", params: [P("name", "Naam", { required: true }), P("address", "Adres")] },
      { id: "activity.create", resource: "Activiteit", label: "Activiteit maken", method: "POST", path: "/activities", output: "data", params: [P("subject", "Onderwerp", { required: true }), P("type", "Type", { default: "call" }), P("due_date", "Datum (JJJJ-MM-DD)"), num("deal_id", "Deal-ID"), num("person_id", "Persoon-ID")] },
      { id: "note.create", resource: "Notitie", label: "Notitie toevoegen", method: "POST", path: "/notes", output: "data", params: [P("content", "Tekst", { type: "text", required: true }), num("deal_id", "Deal-ID"), num("person_id", "Persoon-ID")] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me", output: "data" }
    ]
  },
  {
    id: "zoho-crm", name: "Zoho CRM", category: "Verkoop & CRM", description: "Leads, contacten, accounts en deals", color: "#e42527",
    website: "https://zoho.com/crm", docs: "https://www.zoho.com/crm/developer/docs/api/v7/",
    baseUrl: "https://www.zohoapis.{{dc}}/crm/v7",
    auth: { type: "oauth2", authUrl: "https://accounts.zoho.{{dc}}/oauth/v2/auth", tokenUrl: "https://accounts.zoho.{{dc}}/oauth/v2/token", scopes: ["ZohoCRM.modules.ALL", "ZohoCRM.users.READ", "ZohoCRM.org.READ"], scopeSeparator: ",", authParams: { access_type: "offline", prompt: "consent" } },
    fields: [{ key: "dc", label: "Datacenter", default: "eu", placeholder: "eu, com, in, com.au" }], test: "org",
    operations: [
      { id: "record.create", resource: "Record", label: "Record maken", method: "POST", path: "/{{module}}", body: { data: ["{{record}}"] }, params: [path("module", "Module", { default: "Leads", options: ["Leads", "Contacts", "Accounts", "Deals"] }), json("record", "Velden", { required: true, placeholder: '{"Last_Name":"Jansen","Company":"Jansen BV","Email":"jan@jansen.nl"}' })] },
      { id: "record.upsert", resource: "Record", label: "Record upserten", method: "POST", path: "/{{module}}/upsert", body: { data: ["{{record}}"], duplicate_check_fields: "{{checkFields}}" }, params: [path("module", "Module", { default: "Contacts" }), json("record", "Velden", { required: true }), P("checkFields", "Duplicaat op velden", { format: "list", default: ["Email"] })] },
      { id: "record.search", resource: "Record", label: "Zoeken", method: "GET", path: "/{{module}}/search", output: "data", params: [path("module", "Module", { default: "Leads" }), q("email", "E-mail"), q("word", "Woord"), q("criteria", "Criteria", { placeholder: "(Last_Name:equals:Jansen)" })] },
      { id: "record.get", resource: "Record", label: "Record ophalen", method: "GET", path: "/{{module}}/{{id}}", output: "data.0", params: [path("module", "Module", { default: "Leads" }), path("id", "ID")] },
      { id: "record.update", resource: "Record", label: "Record bijwerken", method: "PUT", path: "/{{module}}/{{id}}", body: { data: ["{{record}}"] }, params: [path("module", "Module", { default: "Leads" }), path("id", "ID"), json("record", "Velden", { required: true })] },
      { id: "org", resource: "Account", label: "Organisatie", method: "GET", path: "/org", output: "org" }
    ]
  },
  {
    id: "copper", name: "Copper", category: "Verkoop & CRM", description: "CRM voor Google Workspace", color: "#ff5c35",
    website: "https://copper.com", docs: "https://developer.copper.com",
    baseUrl: "https://api.copper.com/developer_api/v1", auth: { type: "headers", headers: { "X-PW-AccessToken": "{{apiKey}}", "X-PW-UserEmail": "{{email}}", "X-PW-Application": "developer_api" }, fields: [{ key: "apiKey", label: "API-key", secret: true }, { key: "email", label: "E-mail (API-gebruiker)" }] }, test: "account",
    operations: [
      { id: "person.search", resource: "Persoon", label: "Personen zoeken", method: "POST", path: "/people/search", params: [P("name", "Naam"), num("page_size", "Aantal", { default: 25 })] },
      { id: "person.create", resource: "Persoon", label: "Persoon maken", method: "POST", path: "/people", body: { name: "{{name}}", emails: [{ email: "{{email}}", category: "work" }] }, params: [P("name", "Naam", { required: true }), P("email", "E-mail")] },
      { id: "opportunity.create", resource: "Kans", label: "Kans maken", method: "POST", path: "/opportunities", params: [P("name", "Naam", { required: true }), num("monetary_value", "Waarde")] },
      { id: "account", resource: "Account", label: "Account", method: "GET", path: "/account" }
    ]
  },
  {
    id: "affinity", name: "Affinity", category: "Verkoop & CRM", description: "Lijsten, personen en organisaties", color: "#1f6feb",
    website: "https://affinity.co", docs: "https://api-docs.affinity.co",
    baseUrl: "https://api.affinity.co", auth: { type: "basic", userLabel: "(leeg laten)", passLabel: "API-key" }, test: "list.list",
    operations: [
      { id: "person.search", resource: "Persoon", label: "Personen zoeken", method: "GET", path: "/persons", output: "persons", params: [q("term", "Zoekterm", { required: true })] },
      { id: "person.create", resource: "Persoon", label: "Persoon maken", method: "POST", path: "/persons", params: [P("first_name", "Voornaam", { required: true }), P("last_name", "Achternaam", { required: true }), P("emails", "E-mail(s)", { format: "list" })] },
      { id: "organization.create", resource: "Organisatie", label: "Organisatie maken", method: "POST", path: "/organizations", params: [P("name", "Naam", { required: true }), P("domain", "Domein")] },
      { id: "list.list", resource: "Lijst", label: "Lijsten", method: "GET", path: "/lists" }
    ]
  },
  {
    id: "hunter", name: "Hunter", category: "Verkoop & CRM", description: "E-mailadressen vinden en controleren", color: "#fa5320",
    website: "https://hunter.io", docs: "https://hunter.io/api-documentation/v2",
    baseUrl: "https://api.hunter.io/v2", auth: { type: "apiKey", in: "query", name: "api_key", label: "API-key" }, test: "account",
    operations: [
      { id: "domain.search", resource: "Domein", label: "E-mailadressen van domein", method: "GET", path: "/domain-search", output: "data", params: [q("domain", "Domein", { required: true }), q("limit", "Aantal", { default: "10" })] },
      { id: "email.find", resource: "E-mail", label: "E-mailadres vinden", method: "GET", path: "/email-finder", output: "data", params: [q("domain", "Domein", { required: true }), q("first_name", "Voornaam", { required: true }), q("last_name", "Achternaam", { required: true })] },
      { id: "email.verify", resource: "E-mail", label: "E-mailadres controleren", method: "GET", path: "/email-verifier", output: "data", params: [q("email", "E-mail", { required: true })] },
      { id: "account", resource: "Account", label: "Account", method: "GET", path: "/account", output: "data" }
    ]
  },
  {
    id: "zendesk", name: "Zendesk", category: "Klantenservice", description: "Tickets, gebruikers en organisaties", color: "#03363d",
    website: "https://zendesk.com", docs: "https://developer.zendesk.com/api-reference/",
    baseUrl: "https://{{subdomain}}.zendesk.com/api/v2", auth: { type: "basic", userLabel: "E-mail + /token (bv. jan@bedrijf.nl/token)", passLabel: "API-token" },
    fields: [{ key: "subdomain", label: "Subdomein", placeholder: "bedrijf" }], test: "me",
    operations: [
      { id: "ticket.create", resource: "Ticket", label: "Ticket maken", method: "POST", path: "/tickets.json", output: "ticket", params: [P("ticket.subject", "Onderwerp", { required: true }), P("ticket.comment.body", "Omschrijving", { type: "text", required: true }), P("ticket.requester.email", "Aanvrager (e-mail)"), P("ticket.requester.name", "Aanvrager (naam)"), P("ticket.priority", "Prioriteit", { options: ["low", "normal", "high", "urgent"] }), P("ticket.tags", "Tags", { format: "list" })] },
      { id: "ticket.get", resource: "Ticket", label: "Ticket ophalen", method: "GET", path: "/tickets/{{id}}.json", output: "ticket", params: [path("id", "Ticket-ID")] },
      { id: "ticket.update", resource: "Ticket", label: "Ticket bijwerken / reageren", method: "PUT", path: "/tickets/{{id}}.json", output: "ticket", params: [path("id", "Ticket-ID"), P("ticket.status", "Status", { options: ["open", "pending", "hold", "solved", "closed"] }), P("ticket.comment.body", "Reactie", { type: "text" }), bool("ticket.comment.public", "Openbare reactie", { default: true }), P("ticket.assignee_email", "Toewijzen aan (e-mail)")] },
      { id: "ticket.list", resource: "Ticket", label: "Tickets", method: "GET", path: "/tickets.json", output: "tickets", params: [q("per_page", "Aantal", { default: "50" })] },
      { id: "search", resource: "Zoeken", label: "Zoeken", method: "GET", path: "/search.json", output: "results", params: [q("query", "Zoekvraag", { required: true, placeholder: "type:ticket status:open" })] },
      { id: "user.create", resource: "Gebruiker", label: "Gebruiker maken", method: "POST", path: "/users.json", output: "user", params: [P("user.name", "Naam", { required: true }), P("user.email", "E-mail", { required: true })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me.json", output: "user" }
    ]
  },
  {
    id: "freshdesk", name: "Freshdesk", category: "Klantenservice", description: "Tickets en contacten", color: "#25c16f",
    website: "https://freshdesk.com", docs: "https://developers.freshdesk.com/api/",
    baseUrl: "https://{{domain}}.freshdesk.com/api/v2", auth: { type: "basic", userLabel: "API-key", passLabel: "X (willekeurig)" },
    fields: [{ key: "domain", label: "Subdomein", placeholder: "bedrijf" }], test: "ticket.list",
    operations: [
      { id: "ticket.create", resource: "Ticket", label: "Ticket maken", method: "POST", path: "/tickets", params: [P("email", "Aanvrager (e-mail)", { required: true }), P("subject", "Onderwerp", { required: true }), P("description", "Omschrijving (HTML)", { type: "text", required: true }), num("priority", "Prioriteit (1-4)", { default: 1 }), num("status", "Status (2=open)", { default: 2 }), P("tags", "Tags", { format: "list" })] },
      { id: "ticket.get", resource: "Ticket", label: "Ticket ophalen", method: "GET", path: "/tickets/{{id}}", params: [path("id", "Ticket-ID")] },
      { id: "ticket.update", resource: "Ticket", label: "Ticket bijwerken", method: "PUT", path: "/tickets/{{id}}", params: [path("id", "Ticket-ID"), num("status", "Status"), num("priority", "Prioriteit")] },
      { id: "ticket.reply", resource: "Ticket", label: "Reageren", method: "POST", path: "/tickets/{{id}}/reply", params: [path("id", "Ticket-ID"), P("body", "Antwoord (HTML)", { type: "text", required: true })] },
      { id: "ticket.list", resource: "Ticket", label: "Tickets", method: "GET", path: "/tickets", params: [q("per_page", "Aantal", { default: "30" })] },
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/contacts", params: [P("name", "Naam", { required: true }), P("email", "E-mail"), P("phone", "Telefoon")] }
    ]
  },
  {
    id: "freshservice", name: "Freshservice", category: "Klantenservice", description: "IT-servicemanagement: tickets en assets", color: "#1f7fe0",
    website: "https://freshservice.com", docs: "https://api.freshservice.com",
    baseUrl: "https://{{domain}}.freshservice.com/api/v2", auth: { type: "basic", userLabel: "API-key", passLabel: "X (willekeurig)" },
    fields: [{ key: "domain", label: "Subdomein" }], test: "ticket.list",
    operations: [
      { id: "ticket.create", resource: "Ticket", label: "Ticket maken", method: "POST", path: "/tickets", output: "ticket", params: [P("email", "Aanvrager", { required: true }), P("subject", "Onderwerp", { required: true }), P("description", "Omschrijving", { type: "text", required: true }), num("priority", "Prioriteit", { default: 1 }), num("status", "Status", { default: 2 })] },
      { id: "ticket.get", resource: "Ticket", label: "Ticket ophalen", method: "GET", path: "/tickets/{{id}}", output: "ticket", params: [path("id", "Ticket-ID")] },
      { id: "ticket.list", resource: "Ticket", label: "Tickets", method: "GET", path: "/tickets", output: "tickets" },
      { id: "asset.list", resource: "Asset", label: "Assets", method: "GET", path: "/assets", output: "assets" }
    ]
  },
  {
    id: "intercom", name: "Intercom", category: "Klantenservice", description: "Contacten, bedrijven en gesprekken", color: "#1f8ded",
    website: "https://intercom.com", docs: "https://developers.intercom.com/docs/references/rest-api/api.intercom.io/",
    baseUrl: "https://api.intercom.io", auth: { type: "bearer", label: "Access token" }, headers: { "Intercom-Version": "2.11" }, test: "me",
    operations: [
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/contacts", params: [P("role", "Rol", { default: "user", options: ["user", "lead"] }), P("email", "E-mail"), P("external_id", "Extern ID"), P("name", "Naam"), P("phone", "Telefoon"), json("custom_attributes", "Eigen attributen")] },
      { id: "contact.search", resource: "Contact", label: "Contacten zoeken", method: "POST", path: "/contacts/search", output: "data", body: { query: { field: "{{field}}", operator: "=", value: "{{value}}" } }, params: [P("field", "Veld", { default: "email" }), P("value", "Waarde", { required: true })] },
      { id: "contact.update", resource: "Contact", label: "Contact bijwerken", method: "PUT", path: "/contacts/{{id}}", params: [path("id", "Contact-ID"), P("name", "Naam"), P("email", "E-mail"), json("custom_attributes", "Eigen attributen")] },
      { id: "company.upsert", resource: "Bedrijf", label: "Bedrijf maken/bijwerken", method: "POST", path: "/companies", params: [P("company_id", "Bedrijfs-ID", { required: true }), P("name", "Naam"), P("website", "Website")] },
      { id: "conversation.list", resource: "Gesprek", label: "Gesprekken", method: "GET", path: "/conversations", output: "conversations" },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/me" }
    ]
  },
  {
    id: "helpscout", name: "Help Scout", category: "Klantenservice", description: "Gesprekken, mailboxen en klanten", color: "#1292ee",
    website: "https://helpscout.com", docs: "https://developer.helpscout.com/mailbox-api/",
    baseUrl: "https://api.helpscout.net/v2", auth: { type: "oauth2-client", tokenUrl: "https://api.helpscout.net/v2/oauth2/token", help: "Maak onder Your Profile → My Apps een app en vul App ID/secret in als Client ID/secret." }, test: "mailbox.list",
    operations: [
      { id: "conversation.list", resource: "Gesprek", label: "Gesprekken", method: "GET", path: "/conversations", output: "_embedded.conversations", params: [q("status", "Status", { default: "active" }), q("mailbox", "Mailbox-ID")] },
      { id: "conversation.create", resource: "Gesprek", label: "Gesprek maken", method: "POST", path: "/conversations", body: { subject: "{{subject}}", mailboxId: "{{mailboxId}}", type: "email", status: "active", customer: { email: "{{email}}" }, threads: [{ type: "customer", customer: { email: "{{email}}" }, text: "{{text}}" }] },
        params: [P("subject", "Onderwerp", { required: true }), num("mailboxId", "Mailbox-ID", { required: true }), P("email", "Klant (e-mail)", { required: true }), P("text", "Bericht", { type: "text", required: true })] },
      { id: "customer.list", resource: "Klant", label: "Klanten", method: "GET", path: "/customers", output: "_embedded.customers", params: [q("query", "Zoekvraag", { placeholder: "(email:\"jan@bedrijf.nl\")" })] },
      { id: "mailbox.list", resource: "Mailbox", label: "Mailboxen", method: "GET", path: "/mailboxes", output: "_embedded.mailboxes" }
    ]
  },
  {
    id: "zammad", name: "Zammad", category: "Klantenservice", description: "Tickets, gebruikers en organisaties", color: "#ffba00",
    website: "https://zammad.org", docs: "https://docs.zammad.org/en/latest/api/intro.html",
    baseUrl: "{{url}}/api/v1", auth: { type: "headers", headers: { Authorization: "Token token={{apiToken}}" }, fields: [{ key: "apiToken", label: "Access token", secret: true }] }, fields: [urlField("Zammad-URL")], test: "me",
    operations: [
      { id: "ticket.create", resource: "Ticket", label: "Ticket maken", method: "POST", path: "/tickets", body: { title: "{{title}}", group: "{{group}}", customer: "{{customer}}", article: { subject: "{{title}}", body: "{{body}}", type: "note", internal: false } },
        params: [P("title", "Titel", { required: true }), P("group", "Groep", { default: "Users" }), P("customer", "Klant (e-mail)", { required: true }), P("body", "Omschrijving", { type: "text", required: true })] },
      { id: "ticket.get", resource: "Ticket", label: "Ticket ophalen", method: "GET", path: "/tickets/{{id}}", params: [path("id", "Ticket-ID")] },
      { id: "ticket.search", resource: "Ticket", label: "Tickets zoeken", method: "GET", path: "/tickets/search", params: [q("query", "Zoekvraag", { required: true, placeholder: "state.name:open" })] },
      { id: "user.create", resource: "Gebruiker", label: "Gebruiker maken", method: "POST", path: "/users", params: [P("firstname", "Voornaam"), P("lastname", "Achternaam"), P("email", "E-mail", { required: true })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me" }
    ]
  },
  {
    id: "servicenow", name: "ServiceNow", category: "Klantenservice", description: "Incidenten, gebruikers en elke tabel", color: "#62d84e",
    website: "https://servicenow.com", docs: "https://developer.servicenow.com/dev.do#!/reference/api/latest/rest/c_TableAPI",
    baseUrl: "https://{{instance}}.service-now.com/api/now", auth: { type: "basic", userLabel: "Gebruiker", passLabel: "Wachtwoord" }, fields: [{ key: "instance", label: "Instance", placeholder: "bedrijf (van bedrijf.service-now.com)" }], test: "incident.list",
    operations: [
      { id: "incident.create", resource: "Incident", label: "Incident maken", method: "POST", path: "/table/incident", output: "result", params: [P("short_description", "Korte omschrijving", { required: true }), P("description", "Omschrijving", { type: "text" }), P("urgency", "Urgentie (1-3)", { default: "2" }), P("impact", "Impact (1-3)", { default: "2" }), P("caller_id", "Melder (gebruikersnaam/sys_id)"), P("assignment_group", "Behandelgroep")] },
      { id: "incident.list", resource: "Incident", label: "Incidenten", method: "GET", path: "/table/incident", output: "result", params: [q("sysparm_query", "Filter", { default: "active=true" }), q("sysparm_limit", "Aantal", { default: "20" })] },
      { id: "record.list", resource: "Record", label: "Records uit tabel", method: "GET", path: "/table/{{table}}", output: "result", params: [path("table", "Tabel"), q("sysparm_query", "Filter"), q("sysparm_fields", "Velden"), q("sysparm_limit", "Aantal", { default: "50" })] },
      { id: "record.get", resource: "Record", label: "Record ophalen", method: "GET", path: "/table/{{table}}/{{sysId}}", output: "result", params: [path("table", "Tabel"), path("sysId", "sys_id")] },
      { id: "record.create", resource: "Record", label: "Record maken", method: "POST", path: "/table/{{table}}", output: "result", bodyParam: "fields", params: [path("table", "Tabel"), json("fields", "Velden", { required: true })] },
      { id: "record.update", resource: "Record", label: "Record bijwerken", method: "PATCH", path: "/table/{{table}}/{{sysId}}", output: "result", bodyParam: "fields", params: [path("table", "Tabel"), path("sysId", "sys_id"), json("fields", "Velden", { required: true })] },
      { id: "record.delete", resource: "Record", label: "Record verwijderen", method: "DELETE", path: "/table/{{table}}/{{sysId}}", params: [path("table", "Tabel"), path("sysId", "sys_id")] }
    ]
  },
  {
    id: "mailchimp", name: "Mailchimp", category: "Marketing", description: "Lijsten, leden en campagnes", color: "#ffe01b",
    website: "https://mailchimp.com", docs: "https://mailchimp.com/developer/marketing/api/",
    baseUrl: "https://{{dc}}.api.mailchimp.com/3.0", auth: { type: "basic", userLabel: "Gebruiker (willekeurig)", passLabel: "API-key" },
    fields: [{ key: "dc", label: "Datacenter", placeholder: "us21 (achter het streepje in je API-key)" }], test: "ping",
    operations: [
      { id: "member.upsert", resource: "Lid", label: "Lid toevoegen/bijwerken", method: "PUT", path: "/lists/{{listId}}/members/{{email}}", body: { email_address: "{{email}}", status_if_new: "{{status}}", merge_fields: "{{mergeFields}}", tags: "{{tags}}" },
        params: [path("listId", "Lijst-ID (audience)"), path("email", "E-mail"), P("status", "Status (nieuw)", { default: "subscribed", options: ["subscribed", "pending", "unsubscribed", "transactional"] }), json("mergeFields", "Velden", { placeholder: '{"FNAME":"Jan","LNAME":"Jansen"}' }), P("tags", "Tags", { format: "list" })] },
      { id: "member.get", resource: "Lid", label: "Lid ophalen", method: "GET", path: "/lists/{{listId}}/members/{{email}}", params: [path("listId", "Lijst-ID"), path("email", "E-mail")] },
      { id: "member.unsubscribe", resource: "Lid", label: "Afmelden", method: "PATCH", path: "/lists/{{listId}}/members/{{email}}", body: { status: "unsubscribed" }, params: [path("listId", "Lijst-ID"), path("email", "E-mail")] },
      { id: "member.tags", resource: "Lid", label: "Tags toevoegen", method: "POST", path: "/lists/{{listId}}/members/{{email}}/tags", body: { tags: "{{tags}}" }, params: [path("listId", "Lijst-ID"), path("email", "E-mail"), json("tags", "Tags", { required: true, placeholder: '[{"name":"klant","status":"active"}]' })] },
      { id: "list.list", resource: "Lijst", label: "Lijsten", method: "GET", path: "/lists", output: "lists" },
      { id: "campaign.list", resource: "Campagne", label: "Campagnes", method: "GET", path: "/campaigns", output: "campaigns", params: [q("status", "Status", { options: ["save", "paused", "schedule", "sending", "sent"] })] },
      { id: "campaign.send", resource: "Campagne", label: "Campagne versturen", method: "POST", path: "/campaigns/{{id}}/actions/send", params: [path("id", "Campagne-ID")] },
      { id: "ping", resource: "Account", label: "Verbinding testen", method: "GET", path: "/ping" }
    ]
  },
  {
    id: "mailerlite", name: "MailerLite", category: "Marketing", description: "Abonnees en groepen", color: "#09c269",
    website: "https://mailerlite.com", docs: "https://developers.mailerlite.com/docs/",
    baseUrl: "https://connect.mailerlite.com/api", auth: { type: "bearer", label: "API-token" }, test: "group.list",
    operations: [
      { id: "subscriber.upsert", resource: "Abonnee", label: "Abonnee toevoegen/bijwerken", method: "POST", path: "/subscribers", output: "data", params: [P("email", "E-mail", { required: true }), json("fields", "Velden", { placeholder: '{"name":"Jan"}' }), P("groups", "Groep-ID's", { format: "list" }), P("status", "Status", { options: ["active", "unsubscribed", "unconfirmed"] })] },
      { id: "subscriber.get", resource: "Abonnee", label: "Abonnee ophalen", method: "GET", path: "/subscribers/{{id}}", output: "data", params: [path("id", "ID of e-mail")] },
      { id: "subscriber.delete", resource: "Abonnee", label: "Abonnee verwijderen", method: "DELETE", path: "/subscribers/{{id}}", params: [path("id", "ID")] },
      { id: "group.list", resource: "Groep", label: "Groepen", method: "GET", path: "/groups", output: "data" }
    ]
  },
  {
    id: "activecampaign", name: "ActiveCampaign", category: "Marketing", description: "Contacten, deals, tags en lijsten", color: "#356ae6",
    website: "https://activecampaign.com", docs: "https://developers.activecampaign.com/reference",
    baseUrl: "{{url}}/api/3", auth: { type: "headers", headers: { "Api-Token": "{{apiKey}}" }, fields: [{ key: "apiKey", label: "API-key", secret: true }] }, fields: [urlField("Account-URL", "https://bedrijf.api-us1.com")], test: "me",
    operations: [
      { id: "contact.sync", resource: "Contact", label: "Contact maken/bijwerken", method: "POST", path: "/contact/sync", output: "contact", params: [P("contact.email", "E-mail", { required: true }), P("contact.firstName", "Voornaam"), P("contact.lastName", "Achternaam"), P("contact.phone", "Telefoon"), json("contact.fieldValues", "Eigen velden", { placeholder: '[{"field":"1","value":"x"}]' })] },
      { id: "contact.list", resource: "Contact", label: "Contacten zoeken", method: "GET", path: "/contacts", output: "contacts", params: [q("email", "E-mail"), q("search", "Zoektekst")] },
      { id: "contact.tag", resource: "Contact", label: "Tag toevoegen", method: "POST", path: "/contactTags", body: { contactTag: { contact: "{{contactId}}", tag: "{{tagId}}" } }, params: [P("contactId", "Contact-ID", { required: true }), P("tagId", "Tag-ID", { required: true })] },
      { id: "contact.list.add", resource: "Contact", label: "Aan lijst toevoegen", method: "POST", path: "/contactLists", body: { contactList: { contact: "{{contactId}}", list: "{{listId}}", status: 1 } }, params: [P("contactId", "Contact-ID", { required: true }), P("listId", "Lijst-ID", { required: true })] },
      { id: "deal.create", resource: "Deal", label: "Deal maken", method: "POST", path: "/deals", output: "deal", params: [P("deal.title", "Titel", { required: true }), num("deal.value", "Waarde (centen)"), P("deal.currency", "Valuta", { default: "eur" }), P("deal.contact", "Contact-ID"), P("deal.group", "Pipeline-ID"), P("deal.stage", "Fase-ID")] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me", output: "user" }
    ]
  },
  {
    id: "mautic", name: "Mautic", category: "Marketing", description: "Contacten, bedrijven en segmenten", color: "#4e5e9e",
    website: "https://mautic.org", docs: "https://developer.mautic.org",
    baseUrl: "{{url}}/api", auth: { type: "basic", userLabel: "Gebruiker", passLabel: "Wachtwoord" }, fields: [urlField("Mautic-URL")], test: "contact.list",
    operations: [
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/contacts/new", output: "contact", params: [P("email", "E-mail", { required: true }), P("firstname", "Voornaam"), P("lastname", "Achternaam"), P("company", "Bedrijf"), P("tags", "Tags", { format: "list" })] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/contacts/{{id}}", output: "contact", params: [path("id", "Contact-ID")] },
      { id: "contact.list", resource: "Contact", label: "Contacten", method: "GET", path: "/contacts", output: "contacts", params: [q("search", "Zoekvraag"), q("limit", "Aantal", { default: "30" })] },
      { id: "segment.add", resource: "Segment", label: "Aan segment toevoegen", method: "POST", path: "/segments/{{segmentId}}/contact/{{contactId}}/add", params: [path("segmentId", "Segment-ID"), path("contactId", "Contact-ID")] }
    ]
  },
  {
    id: "convertkit", name: "ConvertKit (Kit)", category: "Marketing", description: "Abonnees, tags en formulieren", color: "#fb6970",
    website: "https://kit.com", docs: "https://developers.kit.com/v4",
    baseUrl: "https://api.kit.com/v4", auth: { type: "apiKey", in: "header", name: "X-Kit-Api-Key", label: "API-key (v4)" }, test: "account",
    operations: [
      { id: "subscriber.create", resource: "Abonnee", label: "Abonnee maken", method: "POST", path: "/subscribers", output: "subscriber", params: [P("email_address", "E-mail", { required: true }), P("first_name", "Voornaam"), P("state", "Status", { default: "active" }), json("fields", "Velden")] },
      { id: "subscriber.list", resource: "Abonnee", label: "Abonnees", method: "GET", path: "/subscribers", output: "subscribers", params: [q("email_address", "E-mail")] },
      { id: "tag.add", resource: "Tag", label: "Tag toevoegen aan abonnee", method: "POST", path: "/tags/{{tagId}}/subscribers", params: [path("tagId", "Tag-ID"), P("email_address", "E-mail", { required: true })] },
      { id: "account", resource: "Account", label: "Account", method: "GET", path: "/account" }
    ]
  },
  {
    id: "customer-io", name: "Customer.io", category: "Marketing", description: "Klanten en events (Track API)", color: "#7131ff",
    website: "https://customer.io", docs: "https://docs.customer.io/api/track/",
    baseUrl: "https://{{region}}/api/v1", auth: { type: "basic", userLabel: "Site ID", passLabel: "Track API-key" }, fields: [{ key: "region", label: "Regio-host", default: "track-eu.customer.io", placeholder: "track.customer.io (VS)" }],
    operations: [
      { id: "customer.identify", resource: "Klant", label: "Klant maken/bijwerken", method: "PUT", path: "/customers/{{id}}", bodyParam: "attributes", params: [path("id", "Klant-ID"), json("attributes", "Attributen", { required: true, placeholder: '{"email":"jan@bedrijf.nl","plan":"pro"}' })] },
      { id: "customer.event", resource: "Klant", label: "Event vastleggen", method: "POST", path: "/customers/{{id}}/events", params: [path("id", "Klant-ID"), P("name", "Event", { required: true }), json("data", "Data")] },
      { id: "customer.delete", resource: "Klant", label: "Klant verwijderen", method: "DELETE", path: "/customers/{{id}}", params: [path("id", "Klant-ID")] }
    ]
  },
  {
    id: "lemlist", name: "lemlist", category: "Marketing", description: "Campagnes en leads", color: "#316bff",
    website: "https://lemlist.com", docs: "https://developer.lemlist.com",
    baseUrl: "https://api.lemlist.com/api", auth: { type: "basic", userLabel: "(leeg laten)", passLabel: "API-key" }, test: "team",
    operations: [
      { id: "lead.add", resource: "Lead", label: "Lead aan campagne toevoegen", method: "POST", path: "/campaigns/{{campaignId}}/leads/{{email}}", params: [path("campaignId", "Campagne-ID"), path("email", "E-mail"), P("firstName", "Voornaam"), P("lastName", "Achternaam"), P("companyName", "Bedrijf")] },
      { id: "campaign.list", resource: "Campagne", label: "Campagnes", method: "GET", path: "/campaigns" },
      { id: "team", resource: "Account", label: "Team", method: "GET", path: "/team" }
    ]
  },
  {
    id: "iterable", name: "Iterable", category: "Marketing", description: "Gebruikers en events", color: "#6a266d",
    website: "https://iterable.com", docs: "https://api.iterable.com/api/docs",
    baseUrl: "https://{{host}}/api", auth: { type: "apiKey", in: "header", name: "Api-Key", label: "API-key" }, fields: [{ key: "host", label: "Host", default: "api.eu.iterable.com", placeholder: "api.iterable.com (VS)" }],
    operations: [
      { id: "user.update", resource: "Gebruiker", label: "Gebruiker bijwerken", method: "POST", path: "/users/update", params: [P("email", "E-mail", { required: true }), json("dataFields", "Velden")] },
      { id: "event.track", resource: "Event", label: "Event vastleggen", method: "POST", path: "/events/track", params: [P("email", "E-mail", { required: true }), P("eventName", "Event", { required: true }), json("dataFields", "Data")] }
    ]
  },
  {
    id: "getresponse", name: "GetResponse", category: "Marketing", description: "Contacten en campagnes", color: "#00baff",
    website: "https://getresponse.com", docs: "https://apireference.getresponse.com",
    baseUrl: "https://api.getresponse.com/v3", auth: { type: "headers", headers: { "X-Auth-Token": "api-key {{apiKey}}" }, fields: [{ key: "apiKey", label: "API-key", secret: true }] }, test: "account",
    operations: [
      { id: "contact.create", resource: "Contact", label: "Contact toevoegen", method: "POST", path: "/contacts", body: { email: "{{email}}", name: "{{name}}", campaign: { campaignId: "{{campaignId}}" } }, params: [P("email", "E-mail", { required: true }), P("name", "Naam"), P("campaignId", "Lijst (campaign)-ID", { required: true })] },
      { id: "contact.list", resource: "Contact", label: "Contacten", method: "GET", path: "/contacts", params: [q("query[email]", "E-mail")] },
      { id: "campaign.list", resource: "Lijst", label: "Lijsten", method: "GET", path: "/campaigns" },
      { id: "account", resource: "Account", label: "Account", method: "GET", path: "/accounts" }
    ]
  },
  {
    id: "bitly", name: "Bitly", category: "Marketing", description: "Links inkorten en beheren", color: "#ee6123",
    website: "https://bitly.com", docs: "https://dev.bitly.com/api-reference",
    baseUrl: "https://api-ssl.bitly.com/v4", auth: { type: "bearer", label: "Access token" }, test: "user",
    operations: [
      { id: "link.shorten", resource: "Link", label: "Link inkorten", method: "POST", path: "/shorten", params: [P("long_url", "Lange URL", { required: true }), P("domain", "Domein", { default: "bit.ly" })] },
      { id: "link.get", resource: "Link", label: "Link ophalen", method: "GET", path: "/bitlinks/{{bitlink}}", params: [path("bitlink", "Bitlink", { format: "raw", placeholder: "bit.ly/abc123" })] },
      { id: "link.clicks", resource: "Link", label: "Kliks", method: "GET", path: "/bitlinks/{{bitlink}}/clicks/summary", params: [path("bitlink", "Bitlink", { format: "raw" })] },
      { id: "user", resource: "Account", label: "Mijn account", method: "GET", path: "/user" }
    ]
  },
  {
    id: "calendly", name: "Calendly", category: "Productiviteit", description: "Geplande afspraken", color: "#006bff",
    website: "https://calendly.com", docs: "https://developer.calendly.com/api-docs",
    baseUrl: "https://api.calendly.com", auth: { type: "bearer", label: "Personal access token" }, test: "me",
    operations: [
      { id: "event.list", resource: "Afspraak", label: "Geplande afspraken", method: "GET", path: "/scheduled_events", output: "collection", params: [q("user", "Gebruiker (URI)"), q("organization", "Organisatie (URI)"), q("status", "Status", { default: "active" }), q("min_start_time", "Vanaf (ISO)"), q("count", "Aantal", { default: "50" })] },
      { id: "event.get", resource: "Afspraak", label: "Afspraak ophalen", method: "GET", path: "/scheduled_events/{{uuid}}", output: "resource", params: [path("uuid", "Afspraak-UUID")] },
      { id: "invitee.list", resource: "Afspraak", label: "Genodigden", method: "GET", path: "/scheduled_events/{{uuid}}/invitees", output: "collection", params: [path("uuid", "Afspraak-UUID")] },
      { id: "eventType.list", resource: "Afspraaktype", label: "Afspraaktypes", method: "GET", path: "/event_types", output: "collection", params: [q("user", "Gebruiker (URI)")] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me", output: "resource" }
    ]
  },
  {
    id: "typeform", name: "Typeform", category: "Formulieren & enquêtes", description: "Formulieren en antwoorden", color: "#262627",
    website: "https://typeform.com", docs: "https://www.typeform.com/developers/",
    baseUrl: "https://api.typeform.com", auth: { type: "bearer", label: "Personal access token" }, test: "me",
    operations: [
      { id: "form.list", resource: "Formulier", label: "Formulieren", method: "GET", path: "/forms", output: "items" },
      { id: "form.get", resource: "Formulier", label: "Formulier ophalen", method: "GET", path: "/forms/{{formId}}", params: [path("formId", "Formulier-ID")] },
      { id: "response.list", resource: "Antwoord", label: "Antwoorden", method: "GET", path: "/forms/{{formId}}/responses", output: "items", params: [path("formId", "Formulier-ID"), q("page_size", "Aantal", { default: "50" }), q("since", "Sinds (ISO)"), q("completed", "Alleen afgerond", { default: "true" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/me" }
    ]
  },
  {
    id: "surveymonkey", name: "SurveyMonkey", category: "Formulieren & enquêtes", description: "Enquêtes en antwoorden", color: "#00bf6f",
    website: "https://surveymonkey.com", docs: "https://developer.surveymonkey.com/api/v3/",
    baseUrl: "https://{{host}}/v3", auth: { type: "bearer", label: "Access token" }, fields: [{ key: "host", label: "Host", default: "api.eu.surveymonkey.com", placeholder: "api.surveymonkey.com (VS)" }], test: "me",
    operations: [
      { id: "survey.list", resource: "Enquête", label: "Enquêtes", method: "GET", path: "/surveys", output: "data" },
      { id: "response.list", resource: "Antwoord", label: "Antwoorden (bulk)", method: "GET", path: "/surveys/{{surveyId}}/responses/bulk", output: "data", params: [path("surveyId", "Enquête-ID"), q("per_page", "Aantal", { default: "50" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me" }
    ]
  },
  {
    id: "jotform", name: "Jotform", category: "Formulieren & enquêtes", description: "Formulieren en inzendingen", color: "#ff6100",
    website: "https://jotform.com", docs: "https://api.jotform.com/docs/",
    baseUrl: "https://{{host}}", auth: { type: "apiKey", in: "header", name: "APIKEY", label: "API-key" }, fields: [{ key: "host", label: "Host", default: "eu-api.jotform.com", placeholder: "api.jotform.com" }], test: "me",
    operations: [
      { id: "form.list", resource: "Formulier", label: "Formulieren", method: "GET", path: "/user/forms", output: "content" },
      { id: "submission.list", resource: "Inzending", label: "Inzendingen", method: "GET", path: "/form/{{formId}}/submissions", output: "content", params: [path("formId", "Formulier-ID"), q("limit", "Aantal", { default: "50" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/user", output: "content" }
    ]
  }
];
