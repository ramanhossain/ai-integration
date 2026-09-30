import type { PluginDef } from "../types";
import { GRAPH, P, TENANT, bool, json, microsoft, num, path, q } from "./_shared";

// Microsoft 365 via Microsoft Graph (v1.0) en Dynamics 365 (Web API).
const me = { id: "me", resource: "Account", label: "Mijn profiel", method: "GET" as const, path: "/me" };

export const MICROSOFT: PluginDef[] = [
  {
    id: "microsoft-outlook", name: "Microsoft Outlook", category: "Communicatie", description: "E-mail, mappen en agenda", color: "#0078d4",
    website: "https://outlook.com", docs: "https://learn.microsoft.com/graph/api/resources/mail-api-overview",
    baseUrl: GRAPH, auth: microsoft(["User.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"]), fields: [TENANT], test: "me",
    operations: [
      { id: "message.send", resource: "Bericht", label: "E-mail versturen", method: "POST", path: "/me/sendMail",
        body: { message: { subject: "{{subject}}", body: { contentType: "{{contentType}}", content: "{{content}}" }, toRecipients: "{{toRecipients}}", ccRecipients: "{{ccRecipients}}" }, saveToSentItems: true },
        params: [P("toRecipients", "Aan", { required: true, type: "json", placeholder: '[{"emailAddress":{"address":"jan@bedrijf.nl"}}]' }), P("ccRecipients", "Cc", { type: "json" }), P("subject", "Onderwerp", { required: true }), P("content", "Inhoud", { type: "text", required: true }), P("contentType", "Type", { default: "Text", options: ["Text", "HTML"] })] },
      { id: "message.list", resource: "Bericht", label: "Berichten", method: "GET", path: "/me/mailFolders/{{folder}}/messages", output: "value",
        params: [path("folder", "Map", { default: "inbox" }), q("$top", "Aantal", { default: "25" }), q("$filter", "Filter", { placeholder: "isRead eq false" }), q("$search", "Zoeken", { placeholder: '"factuur"' }), q("$select", "Velden", { default: "id,subject,from,receivedDateTime,isRead,bodyPreview" })] },
      { id: "message.get", resource: "Bericht", label: "Bericht ophalen", method: "GET", path: "/me/messages/{{id}}", params: [path("id", "Bericht-ID")] },
      { id: "message.markRead", resource: "Bericht", label: "Gelezen markeren", method: "PATCH", path: "/me/messages/{{id}}", params: [path("id", "Bericht-ID"), bool("isRead", "Gelezen", { default: true })] },
      { id: "message.move", resource: "Bericht", label: "Verplaatsen", method: "POST", path: "/me/messages/{{id}}/move", params: [path("id", "Bericht-ID"), P("destinationId", "Doelmap (ID of naam, bv. archive)", { required: true })] },
      { id: "message.reply", resource: "Bericht", label: "Beantwoorden", method: "POST", path: "/me/messages/{{id}}/reply", params: [path("id", "Bericht-ID"), P("comment", "Antwoord", { type: "text", required: true })] },
      { id: "message.delete", resource: "Bericht", label: "Verwijderen", method: "DELETE", path: "/me/messages/{{id}}", params: [path("id", "Bericht-ID")] },
      { id: "folder.list", resource: "Map", label: "Mappen", method: "GET", path: "/me/mailFolders", output: "value" },
      { id: "event.list", resource: "Agenda", label: "Afspraken", method: "GET", path: "/me/calendarView", output: "value", params: [q("startDateTime", "Vanaf (ISO)", { required: true }), q("endDateTime", "Tot (ISO)", { required: true }), q("$top", "Aantal", { default: "50" })] },
      { id: "event.create", resource: "Agenda", label: "Afspraak maken", method: "POST", path: "/me/events",
        params: [P("subject", "Titel", { required: true }), P("body.content", "Omschrijving", { type: "text" }), P("body.contentType", "Type", { default: "Text" }), P("start.dateTime", "Start", { required: true, placeholder: "2026-10-01T09:00:00" }), P("start.timeZone", "Tijdzone", { default: "Europe/Amsterdam" }), P("end.dateTime", "Einde", { required: true }), P("end.timeZone", "Tijdzone einde", { default: "Europe/Amsterdam" }), P("location.displayName", "Locatie"), json("attendees", "Deelnemers", { placeholder: '[{"emailAddress":{"address":"jan@bedrijf.nl"},"type":"required"}]' }), bool("isOnlineMeeting", "Teams-vergadering", { default: false })] },
      me
    ]
  },
  {
    id: "microsoft-teams", name: "Microsoft Teams", category: "Communicatie", description: "Berichten in kanalen en chats", color: "#5b5fc7",
    website: "https://microsoft.com/teams", docs: "https://learn.microsoft.com/graph/api/resources/teams-api-overview",
    baseUrl: GRAPH, auth: microsoft(["User.Read", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Send", "Chat.ReadWrite"]), fields: [TENANT], test: "team.list",
    operations: [
      { id: "team.list", resource: "Team", label: "Mijn teams", method: "GET", path: "/me/joinedTeams", output: "value" },
      { id: "channel.list", resource: "Kanaal", label: "Kanalen", method: "GET", path: "/teams/{{teamId}}/channels", output: "value", params: [path("teamId", "Team-ID")] },
      { id: "channel.message", resource: "Kanaal", label: "Bericht in kanaal", method: "POST", path: "/teams/{{teamId}}/channels/{{channelId}}/messages", body: { subject: "{{subject}}", body: { contentType: "{{contentType}}", content: "{{message}}" } },
        params: [path("teamId", "Team-ID"), path("channelId", "Kanaal-ID"), P("subject", "Onderwerp"), P("message", "Bericht", { type: "text", required: true }), P("contentType", "Type", { default: "html", options: ["html", "text"] })] },
      { id: "channel.reply", resource: "Kanaal", label: "Reageren op bericht", method: "POST", path: "/teams/{{teamId}}/channels/{{channelId}}/messages/{{messageId}}/replies", body: { body: { contentType: "html", content: "{{message}}" } },
        params: [path("teamId", "Team-ID"), path("channelId", "Kanaal-ID"), path("messageId", "Bericht-ID"), P("message", "Bericht", { type: "text", required: true })] },
      { id: "chat.list", resource: "Chat", label: "Mijn chats", method: "GET", path: "/me/chats", output: "value" },
      { id: "chat.message", resource: "Chat", label: "Bericht in chat", method: "POST", path: "/chats/{{chatId}}/messages", body: { body: { contentType: "html", content: "{{message}}" } }, params: [path("chatId", "Chat-ID"), P("message", "Bericht", { type: "text", required: true })] },
      { id: "channel.messages", resource: "Kanaal", label: "Berichten in kanaal", method: "GET", path: "/teams/{{teamId}}/channels/{{channelId}}/messages", output: "value", params: [path("teamId", "Team-ID"), path("channelId", "Kanaal-ID"), q("$top", "Aantal", { default: "20" })] }
    ]
  },
  {
    id: "microsoft-onedrive", name: "Microsoft OneDrive", category: "Bestanden", description: "Bestanden en mappen", color: "#0078d4",
    website: "https://onedrive.com", docs: "https://learn.microsoft.com/graph/api/resources/onedrive",
    baseUrl: GRAPH, auth: microsoft(["User.Read", "Files.ReadWrite.All"]), fields: [TENANT], test: "drive.get",
    operations: [
      { id: "drive.get", resource: "Drive", label: "Mijn drive", method: "GET", path: "/me/drive" },
      { id: "item.children", resource: "Bestand", label: "Inhoud van map", method: "GET", path: "/me/drive/items/{{itemId}}/children", output: "value", params: [path("itemId", "Map-ID", { default: "root" }), q("$top", "Aantal", { default: "100" })] },
      { id: "item.byPath", resource: "Bestand", label: "Bestand/map via pad", method: "GET", path: "/me/drive/root:/{{filePath}}", params: [path("filePath", "Pad", { format: "raw", placeholder: "Documenten/factuur.pdf" })] },
      { id: "item.get", resource: "Bestand", label: "Bestandsinfo", method: "GET", path: "/me/drive/items/{{itemId}}", params: [path("itemId", "Bestand-ID")] },
      { id: "item.search", resource: "Bestand", label: "Zoeken", method: "GET", path: "/me/drive/root/search(q='{{query}}')", output: "value", params: [path("query", "Zoektekst")] },
      { id: "folder.create", resource: "Map", label: "Map maken", method: "POST", path: "/me/drive/items/{{parentId}}/children", body: { name: "{{name}}", folder: {}, "@microsoft.graph.conflictBehavior": "rename" },
        params: [path("parentId", "Bovenliggende map-ID", { default: "root" }), P("name", "Naam", { required: true })] },
      { id: "item.copy", resource: "Bestand", label: "Kopiëren", method: "POST", path: "/me/drive/items/{{itemId}}/copy", body: { parentReference: { id: "{{targetFolderId}}" }, name: "{{name}}" }, params: [path("itemId", "Bestand-ID"), P("targetFolderId", "Doelmap-ID", { required: true }), P("name", "Nieuwe naam")] },
      { id: "item.move", resource: "Bestand", label: "Verplaatsen/hernoemen", method: "PATCH", path: "/me/drive/items/{{itemId}}", body: { parentReference: { id: "{{targetFolderId}}" }, name: "{{name}}" }, params: [path("itemId", "Bestand-ID"), P("targetFolderId", "Doelmap-ID"), P("name", "Nieuwe naam")] },
      { id: "item.share", resource: "Bestand", label: "Deellink maken", method: "POST", path: "/me/drive/items/{{itemId}}/createLink", params: [path("itemId", "Bestand-ID"), P("type", "Type", { default: "view", options: ["view", "edit"] }), P("scope", "Bereik", { default: "organization", options: ["anonymous", "organization"] })] },
      { id: "item.delete", resource: "Bestand", label: "Verwijderen", method: "DELETE", path: "/me/drive/items/{{itemId}}", params: [path("itemId", "Bestand-ID")] }
    ]
  },
  {
    id: "microsoft-excel", name: "Microsoft Excel 365", category: "Data & opslag", description: "Werkbladen, tabellen en bereiken in OneDrive/SharePoint", color: "#217346",
    website: "https://microsoft.com/excel", docs: "https://learn.microsoft.com/graph/api/resources/excel",
    baseUrl: `${GRAPH}/me/drive/items/{{workbookId}}/workbook`, auth: microsoft(["User.Read", "Files.ReadWrite.All"]), fields: [TENANT],
    operations: [
      { id: "worksheet.list", resource: "Werkblad", label: "Werkbladen", method: "GET", path: "/worksheets", output: "value", params: [path("workbookId", "Werkmap-ID (OneDrive-item)")] },
      { id: "range.get", resource: "Bereik", label: "Bereik lezen", method: "GET", path: "/worksheets/{{sheet}}/range(address='{{address}}')", output: "values", params: [path("workbookId", "Werkmap-ID"), path("sheet", "Werkblad", { default: "Blad1" }), path("address", "Bereik", { placeholder: "A1:D20" })] },
      { id: "range.update", resource: "Bereik", label: "Bereik bijwerken", method: "PATCH", path: "/worksheets/{{sheet}}/range(address='{{address}}')", body: { values: "{{values}}" }, params: [path("workbookId", "Werkmap-ID"), path("sheet", "Werkblad", { default: "Blad1" }), path("address", "Bereik"), json("values", "Waarden", { required: true, placeholder: '[["a",1],["b",2]]' })] },
      { id: "table.list", resource: "Tabel", label: "Tabellen", method: "GET", path: "/tables", output: "value", params: [path("workbookId", "Werkmap-ID")] },
      { id: "table.rows", resource: "Tabel", label: "Tabelrijen", method: "GET", path: "/tables/{{table}}/rows", output: "value", params: [path("workbookId", "Werkmap-ID"), path("table", "Tabel (naam/ID)")] },
      { id: "table.addRows", resource: "Tabel", label: "Rijen toevoegen", method: "POST", path: "/tables/{{table}}/rows", body: { values: "{{values}}" }, params: [path("workbookId", "Werkmap-ID"), path("table", "Tabel (naam/ID)"), json("values", "Rijen", { required: true, placeholder: '[["{{orderId}}","{{klant}}",12.5]]' })] }
    ]
  },
  {
    id: "microsoft-todo", name: "Microsoft To Do", category: "Productiviteit", description: "Taken en lijsten", color: "#2564cf",
    website: "https://todo.microsoft.com", docs: "https://learn.microsoft.com/graph/api/resources/todo-overview",
    baseUrl: `${GRAPH}/me/todo`, auth: microsoft(["User.Read", "Tasks.ReadWrite"]), fields: [TENANT], test: "list.list",
    operations: [
      { id: "list.list", resource: "Lijst", label: "Lijsten", method: "GET", path: "/lists", output: "value" },
      { id: "task.list", resource: "Taak", label: "Taken", method: "GET", path: "/lists/{{listId}}/tasks", output: "value", params: [path("listId", "Lijst-ID"), q("$filter", "Filter", { placeholder: "status ne 'completed'" })] },
      { id: "task.create", resource: "Taak", label: "Taak maken", method: "POST", path: "/lists/{{listId}}/tasks", params: [path("listId", "Lijst-ID"), P("title", "Titel", { required: true }), P("body.content", "Notitie", { type: "text" }), P("body.contentType", "Type", { default: "text" }), P("dueDateTime.dateTime", "Deadline", { placeholder: "2026-10-01T17:00:00" }), P("dueDateTime.timeZone", "Tijdzone", { default: "Europe/Amsterdam" }), P("importance", "Belang", { options: ["low", "normal", "high"] })] },
      { id: "task.update", resource: "Taak", label: "Taak wijzigen", method: "PATCH", path: "/lists/{{listId}}/tasks/{{taskId}}", params: [path("listId", "Lijst-ID"), path("taskId", "Taak-ID"), P("title", "Titel"), P("status", "Status", { options: ["notStarted", "inProgress", "completed"] })] },
      { id: "task.delete", resource: "Taak", label: "Taak verwijderen", method: "DELETE", path: "/lists/{{listId}}/tasks/{{taskId}}", params: [path("listId", "Lijst-ID"), path("taskId", "Taak-ID")] }
    ]
  },
  {
    id: "microsoft-sharepoint", name: "Microsoft SharePoint", category: "Bestanden", description: "Sites, lijsten en lijstitems", color: "#038387",
    website: "https://microsoft.com/sharepoint", docs: "https://learn.microsoft.com/graph/api/resources/sharepoint",
    baseUrl: GRAPH, auth: microsoft(["User.Read", "Sites.ReadWrite.All"]), fields: [TENANT],
    operations: [
      { id: "site.search", resource: "Site", label: "Sites zoeken", method: "GET", path: "/sites", output: "value", params: [q("search", "Zoektekst", { required: true })] },
      { id: "list.list", resource: "Lijst", label: "Lijsten van site", method: "GET", path: "/sites/{{siteId}}/lists", output: "value", params: [path("siteId", "Site-ID")] },
      { id: "item.list", resource: "Item", label: "Lijstitems", method: "GET", path: "/sites/{{siteId}}/lists/{{listId}}/items", output: "value", params: [path("siteId", "Site-ID"), path("listId", "Lijst-ID"), q("expand", "Uitbreiden", { default: "fields" }), q("$filter", "Filter"), q("$top", "Aantal", { default: "100" })] },
      { id: "item.create", resource: "Item", label: "Item maken", method: "POST", path: "/sites/{{siteId}}/lists/{{listId}}/items", body: { fields: "{{fields}}" }, params: [path("siteId", "Site-ID"), path("listId", "Lijst-ID"), json("fields", "Velden", { required: true, placeholder: '{"Title":"{{orderId}}"}' })] },
      { id: "item.update", resource: "Item", label: "Item bijwerken", method: "PATCH", path: "/sites/{{siteId}}/lists/{{listId}}/items/{{itemId}}/fields", bodyParam: "fields", params: [path("siteId", "Site-ID"), path("listId", "Lijst-ID"), path("itemId", "Item-ID"), json("fields", "Velden", { required: true })] },
      { id: "item.delete", resource: "Item", label: "Item verwijderen", method: "DELETE", path: "/sites/{{siteId}}/lists/{{listId}}/items/{{itemId}}", params: [path("siteId", "Site-ID"), path("listId", "Lijst-ID"), path("itemId", "Item-ID")] },
      { id: "file.list", resource: "Documenten", label: "Bestanden in documentbibliotheek", method: "GET", path: "/sites/{{siteId}}/drive/root/children", output: "value", params: [path("siteId", "Site-ID")] }
    ]
  },
  {
    id: "microsoft-entra", name: "Microsoft Entra ID", category: "Beveiliging", description: "Gebruikers en groepen (Azure AD)", color: "#0078d4",
    website: "https://entra.microsoft.com", docs: "https://learn.microsoft.com/graph/api/resources/users",
    baseUrl: GRAPH, auth: microsoft(["User.ReadWrite.All", "Group.ReadWrite.All", "Directory.Read.All"]), fields: [TENANT], test: "user.list",
    operations: [
      { id: "user.list", resource: "Gebruiker", label: "Gebruikers", method: "GET", path: "/users", output: "value", params: [q("$filter", "Filter", { placeholder: "startswith(displayName,'Jan')" }), q("$top", "Aantal", { default: "100" }), q("$select", "Velden", { default: "id,displayName,mail,userPrincipalName,accountEnabled" })] },
      { id: "user.get", resource: "Gebruiker", label: "Gebruiker ophalen", method: "GET", path: "/users/{{userId}}", params: [path("userId", "ID of UPN")] },
      { id: "user.create", resource: "Gebruiker", label: "Gebruiker maken", method: "POST", path: "/users", body: { accountEnabled: true, displayName: "{{displayName}}", mailNickname: "{{mailNickname}}", userPrincipalName: "{{userPrincipalName}}", passwordProfile: { forceChangePasswordNextSignIn: true, password: "{{password}}" } },
        params: [P("displayName", "Weergavenaam", { required: true }), P("mailNickname", "Alias", { required: true }), P("userPrincipalName", "UPN", { required: true, placeholder: "jan@bedrijf.onmicrosoft.com" }), P("password", "Tijdelijk wachtwoord", { required: true })] },
      { id: "user.disable", resource: "Gebruiker", label: "Account (de)activeren", method: "PATCH", path: "/users/{{userId}}", params: [path("userId", "ID of UPN"), bool("accountEnabled", "Actief", { default: false })] },
      { id: "group.list", resource: "Groep", label: "Groepen", method: "GET", path: "/groups", output: "value", params: [q("$filter", "Filter")] },
      { id: "group.addMember", resource: "Groep", label: "Lid toevoegen", method: "POST", path: "/groups/{{groupId}}/members/$ref", body: { "@odata.id": "https://graph.microsoft.com/v1.0/directoryObjects/{{userId}}" }, params: [path("groupId", "Groep-ID"), P("userId", "Gebruiker-ID", { required: true })] },
      { id: "group.removeMember", resource: "Groep", label: "Lid verwijderen", method: "DELETE", path: "/groups/{{groupId}}/members/{{userId}}/$ref", params: [path("groupId", "Groep-ID"), path("userId", "Gebruiker-ID")] }
    ]
  },
  {
    id: "microsoft-graph-security", name: "Microsoft Graph Security", category: "Beveiliging", description: "Secure scores en meldingen", color: "#0078d4",
    website: "https://learn.microsoft.com/graph/security-concept-overview", docs: "https://learn.microsoft.com/graph/api/resources/security-api-overview",
    baseUrl: GRAPH, auth: microsoft(["SecurityEvents.ReadWrite.All", "SecurityAlert.Read.All"]), fields: [TENANT],
    operations: [
      { id: "alert.list", resource: "Melding", label: "Meldingen", method: "GET", path: "/security/alerts_v2", output: "value", params: [q("$filter", "Filter", { placeholder: "severity eq 'high'" }), q("$top", "Aantal", { default: "50" })] },
      { id: "score.list", resource: "Secure score", label: "Secure scores", method: "GET", path: "/security/secureScores", output: "value", params: [q("$top", "Aantal", { default: "10" })] }
    ]
  },
  {
    id: "microsoft-dynamics-crm", name: "Microsoft Dynamics CRM", category: "Verkoop & CRM", description: "Accounts, contacten en elke entiteit via de Dataverse Web API", color: "#002050",
    website: "https://dynamics.microsoft.com", docs: "https://learn.microsoft.com/power-apps/developer/data-platform/webapi/overview",
    baseUrl: "{{orgUrl}}/api/data/v9.2", fields: [TENANT, { key: "orgUrl", label: "Organisatie-URL", placeholder: "https://contoso.crm4.dynamics.com" }],
    auth: { ...microsoft(["{{orgUrl}}/user_impersonation"]) } as PluginDef["auth"], headers: { "OData-Version": "4.0", "OData-MaxVersion": "4.0", Prefer: "return=representation" }, test: "whoami",
    operations: [
      { id: "record.list", resource: "Record", label: "Records", method: "GET", path: "/{{entitySet}}", output: "value", params: [path("entitySet", "Entiteit (meervoud)", { default: "accounts", placeholder: "accounts, contacts, leads" }), q("$select", "Velden", { placeholder: "name,emailaddress1" }), q("$filter", "Filter"), q("$top", "Aantal", { default: "50" })] },
      { id: "record.get", resource: "Record", label: "Record ophalen", method: "GET", path: "/{{entitySet}}({{id}})", params: [path("entitySet", "Entiteit", { default: "accounts" }), path("id", "Record-ID (GUID)")] },
      { id: "record.create", resource: "Record", label: "Record maken", method: "POST", path: "/{{entitySet}}", bodyParam: "data", params: [path("entitySet", "Entiteit", { default: "accounts" }), json("data", "Velden", { required: true, placeholder: '{"name":"Jansen BV","emailaddress1":"info@jansen.nl"}' })] },
      { id: "record.update", resource: "Record", label: "Record bijwerken", method: "PATCH", path: "/{{entitySet}}({{id}})", bodyParam: "data", params: [path("entitySet", "Entiteit", { default: "accounts" }), path("id", "Record-ID"), json("data", "Velden", { required: true })] },
      { id: "record.delete", resource: "Record", label: "Record verwijderen", method: "DELETE", path: "/{{entitySet}}({{id}})", params: [path("entitySet", "Entiteit", { default: "accounts" }), path("id", "Record-ID")] },
      { id: "whoami", resource: "Account", label: "Wie ben ik", method: "GET", path: "/WhoAmI" }
    ]
  }
];
