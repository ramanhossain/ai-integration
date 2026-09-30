import type { PluginDef } from "../types";
import { GS, P, bool, google, json, num, path, q } from "./_shared";

// Google Workspace en Google Cloud — publieke REST-API's van Google.
export const GOOGLE: PluginDef[] = [
  {
    id: "google-sheets", name: "Google Sheets", category: "Data & opslag", description: "Rijen lezen, toevoegen, bijwerken en sheets beheren", color: "#0f9d58",
    website: "https://sheets.google.com", docs: "https://developers.google.com/sheets/api/reference/rest",
    baseUrl: "https://sheets.googleapis.com/v4", auth: google([`${GS}spreadsheets`, `${GS}drive.readonly`]), test: "spreadsheet.list",
    operations: [
      { id: "rows.read", resource: "Rijen", label: "Rijen lezen (als objecten)", method: "GET", path: "/spreadsheets/{{spreadsheetId}}/values/{{range}}", transform: "sheet-rows", description: "Eerste rij = kolomnamen",
        params: [path("spreadsheetId", "Spreadsheet-ID"), path("range", "Bereik", { default: "Blad1", placeholder: "Blad1!A1:Z1000" })] },
      { id: "values.get", resource: "Rijen", label: "Waarden lezen (ruw)", method: "GET", path: "/spreadsheets/{{spreadsheetId}}/values/{{range}}", output: "values",
        params: [path("spreadsheetId", "Spreadsheet-ID"), path("range", "Bereik", { placeholder: "Blad1!A1:D10" }), q("valueRenderOption", "Weergave", { options: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"] })] },
      { id: "rows.append", resource: "Rijen", label: "Rij(en) toevoegen", method: "POST", path: "/spreadsheets/{{spreadsheetId}}/values/{{range}}:append", body: { values: "{{values}}" },
        params: [path("spreadsheetId", "Spreadsheet-ID"), path("range", "Blad", { default: "Blad1" }), json("values", "Waarden", { required: true, placeholder: '[["{{orderId}}", "{{klant}}", 12.5]]', help: "Lijst van rijen; elke rij is een lijst van cellen" }), q("valueInputOption", "Invoer", { default: "USER_ENTERED", options: ["USER_ENTERED", "RAW"] }), q("insertDataOption", "Invoegen", { default: "INSERT_ROWS", options: ["INSERT_ROWS", "OVERWRITE"] })] },
      { id: "values.update", resource: "Rijen", label: "Bereik bijwerken", method: "PUT", path: "/spreadsheets/{{spreadsheetId}}/values/{{range}}", body: { values: "{{values}}" },
        params: [path("spreadsheetId", "Spreadsheet-ID"), path("range", "Bereik", { placeholder: "Blad1!A2:C2" }), json("values", "Waarden", { required: true }), q("valueInputOption", "Invoer", { default: "USER_ENTERED", options: ["USER_ENTERED", "RAW"] })] },
      { id: "values.clear", resource: "Rijen", label: "Bereik leegmaken", method: "POST", path: "/spreadsheets/{{spreadsheetId}}/values/{{range}}:clear",
        params: [path("spreadsheetId", "Spreadsheet-ID"), path("range", "Bereik")] },
      { id: "spreadsheet.get", resource: "Spreadsheet", label: "Spreadsheet-info (bladen)", method: "GET", path: "/spreadsheets/{{spreadsheetId}}", params: [path("spreadsheetId", "Spreadsheet-ID"), q("fields", "Velden", { default: "spreadsheetId,properties.title,sheets.properties" })] },
      { id: "spreadsheet.create", resource: "Spreadsheet", label: "Spreadsheet maken", method: "POST", path: "/spreadsheets", params: [P("properties.title", "Titel", { required: true })] },
      { id: "sheet.add", resource: "Spreadsheet", label: "Blad toevoegen", method: "POST", path: "/spreadsheets/{{spreadsheetId}}:batchUpdate", body: { requests: [{ addSheet: { properties: { title: "{{title}}" } } }] },
        params: [path("spreadsheetId", "Spreadsheet-ID"), P("title", "Naam van het blad", { required: true })] },
      { id: "spreadsheet.list", resource: "Spreadsheet", label: "Spreadsheets zoeken (Drive)", method: "GET", baseUrl: "https://www.googleapis.com/drive/v3", path: "/files", output: "files",
        params: [q("q", "Zoekvraag", { default: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false" }), q("pageSize", "Aantal", { default: "25" }), q("fields", "Velden", { default: "files(id,name,modifiedTime,webViewLink)" })] }
    ]
  },
  {
    id: "gmail", name: "Gmail", category: "Communicatie", description: "E-mail versturen, lezen en labelen", color: "#ea4335",
    website: "https://gmail.com", docs: "https://developers.google.com/gmail/api/reference/rest",
    baseUrl: "https://gmail.googleapis.com/gmail/v1/users/me", auth: google([`${GS}gmail.modify`, `${GS}gmail.send`]), test: "profile.get",
    operations: [
      { id: "message.send", resource: "Bericht", label: "E-mail versturen", method: "POST", path: "/messages/send", special: "gmail-raw",
        params: [P("to", "Aan", { required: true }), P("cc", "Cc"), P("bcc", "Bcc"), P("subject", "Onderwerp", { required: true }), P("text", "Tekst", { type: "text" }), P("html", "HTML (optioneel)", { type: "text" })] },
      { id: "message.list", resource: "Bericht", label: "Berichten zoeken", method: "GET", path: "/messages", output: "messages",
        params: [q("q", "Zoekvraag", { placeholder: "from:klant@bedrijf.nl is:unread" }), q("maxResults", "Aantal", { default: "20" }), q("labelIds", "Label")] },
      { id: "message.get", resource: "Bericht", label: "Bericht ophalen", method: "GET", path: "/messages/{{id}}", params: [path("id", "Bericht-ID"), q("format", "Formaat", { default: "full", options: ["full", "metadata", "minimal", "raw"] })] },
      { id: "message.modify", resource: "Bericht", label: "Labels wijzigen", method: "POST", path: "/messages/{{id}}/modify",
        params: [path("id", "Bericht-ID"), P("addLabelIds", "Labels toevoegen", { format: "list", placeholder: "STARRED,Label_1" }), P("removeLabelIds", "Labels weghalen", { format: "list", placeholder: "UNREAD" })] },
      { id: "message.trash", resource: "Bericht", label: "Naar prullenbak", method: "POST", path: "/messages/{{id}}/trash", params: [path("id", "Bericht-ID")] },
      { id: "label.list", resource: "Label", label: "Labels", method: "GET", path: "/labels", output: "labels" },
      { id: "label.create", resource: "Label", label: "Label maken", method: "POST", path: "/labels", params: [P("name", "Naam", { required: true })] },
      { id: "profile.get", resource: "Account", label: "Profiel", method: "GET", path: "/profile" }
    ]
  },
  {
    id: "google-drive", name: "Google Drive", category: "Bestanden", description: "Bestanden en mappen", color: "#1a73e8",
    website: "https://drive.google.com", docs: "https://developers.google.com/drive/api/reference/rest/v3",
    baseUrl: "https://www.googleapis.com/drive/v3", auth: google([`${GS}drive`]), test: "file.list",
    operations: [
      { id: "file.list", resource: "Bestand", label: "Bestanden zoeken", method: "GET", path: "/files", output: "files",
        params: [q("q", "Zoekvraag", { placeholder: "'MAP_ID' in parents and trashed=false" }), q("pageSize", "Aantal", { default: "50" }), q("orderBy", "Sorteren", { placeholder: "modifiedTime desc" }), q("fields", "Velden", { default: "files(id,name,mimeType,modifiedTime,size,parents,webViewLink)" })] },
      { id: "file.get", resource: "Bestand", label: "Bestandsinfo", method: "GET", path: "/files/{{fileId}}", params: [path("fileId", "Bestand-ID"), q("fields", "Velden", { default: "id,name,mimeType,size,modifiedTime,parents,webViewLink" })] },
      { id: "file.download", resource: "Bestand", label: "Inhoud downloaden (tekst)", method: "GET", path: "/files/{{fileId}}", params: [path("fileId", "Bestand-ID"), q("alt", "alt", { default: "media" })] },
      { id: "file.export", resource: "Bestand", label: "Google-document exporteren", method: "GET", path: "/files/{{fileId}}/export", params: [path("fileId", "Bestand-ID"), q("mimeType", "Formaat", { default: "text/csv", options: ["text/csv", "text/plain", "text/html", "application/pdf"] })] },
      { id: "folder.create", resource: "Map", label: "Map maken", method: "POST", path: "/files", body: { name: "{{name}}", mimeType: "application/vnd.google-apps.folder", parents: "{{parents}}" },
        params: [P("name", "Naam", { required: true }), P("parents", "Bovenliggende map-ID('s)", { format: "list" })] },
      { id: "file.copy", resource: "Bestand", label: "Kopiëren", method: "POST", path: "/files/{{fileId}}/copy", params: [path("fileId", "Bestand-ID"), P("name", "Nieuwe naam"), P("parents", "Map-ID", { format: "list" })] },
      { id: "file.move", resource: "Bestand", label: "Verplaatsen", method: "PATCH", path: "/files/{{fileId}}", params: [path("fileId", "Bestand-ID"), q("addParents", "Naar map-ID", { required: true }), q("removeParents", "Uit map-ID")] },
      { id: "file.share", resource: "Bestand", label: "Delen", method: "POST", path: "/files/{{fileId}}/permissions",
        params: [path("fileId", "Bestand-ID"), P("role", "Rol", { default: "reader", options: ["reader", "commenter", "writer"] }), P("type", "Type", { default: "user", options: ["user", "group", "domain", "anyone"] }), P("emailAddress", "E-mail")] },
      { id: "file.delete", resource: "Bestand", label: "Verwijderen", method: "DELETE", path: "/files/{{fileId}}", params: [path("fileId", "Bestand-ID")] }
    ]
  },
  {
    id: "google-calendar", name: "Google Calendar", category: "Productiviteit", description: "Afspraken en agenda's", color: "#4285f4",
    website: "https://calendar.google.com", docs: "https://developers.google.com/calendar/api/v3/reference",
    baseUrl: "https://www.googleapis.com/calendar/v3", auth: google([`${GS}calendar`]), test: "calendar.list",
    operations: [
      { id: "event.list", resource: "Afspraak", label: "Afspraken zoeken", method: "GET", path: "/calendars/{{calendarId}}/events", output: "items",
        params: [path("calendarId", "Agenda", { default: "primary" }), q("timeMin", "Vanaf (ISO)", { placeholder: "2026-10-01T00:00:00Z" }), q("timeMax", "Tot (ISO)"), q("q", "Zoektekst"), q("singleEvents", "Herhalingen uitklappen", { default: "true" }), q("orderBy", "Sorteren", { default: "startTime" }), q("maxResults", "Aantal", { default: "50" })] },
      { id: "event.create", resource: "Afspraak", label: "Afspraak maken", method: "POST", path: "/calendars/{{calendarId}}/events",
        params: [path("calendarId", "Agenda", { default: "primary" }), P("summary", "Titel", { required: true }), P("description", "Omschrijving", { type: "text" }), P("location", "Locatie"), P("start.dateTime", "Start (ISO)", { required: true, placeholder: "2026-10-01T09:00:00+02:00" }), P("end.dateTime", "Einde (ISO)", { required: true }), P("start.timeZone", "Tijdzone", { default: "Europe/Amsterdam" }), P("end.timeZone", "Tijdzone einde", { default: "Europe/Amsterdam" }), json("attendees", "Deelnemers", { placeholder: '[{"email":"jan@bedrijf.nl"}]' }), q("sendUpdates", "Uitnodigingen sturen", { default: "none", options: ["all", "externalOnly", "none"] })] },
      { id: "event.get", resource: "Afspraak", label: "Afspraak ophalen", method: "GET", path: "/calendars/{{calendarId}}/events/{{eventId}}", params: [path("calendarId", "Agenda", { default: "primary" }), path("eventId", "Afspraak-ID")] },
      { id: "event.update", resource: "Afspraak", label: "Afspraak wijzigen", method: "PATCH", path: "/calendars/{{calendarId}}/events/{{eventId}}",
        params: [path("calendarId", "Agenda", { default: "primary" }), path("eventId", "Afspraak-ID"), P("summary", "Titel"), P("description", "Omschrijving", { type: "text" }), P("location", "Locatie"), P("start.dateTime", "Start (ISO)"), P("end.dateTime", "Einde (ISO)")] },
      { id: "event.delete", resource: "Afspraak", label: "Afspraak verwijderen", method: "DELETE", path: "/calendars/{{calendarId}}/events/{{eventId}}", params: [path("calendarId", "Agenda", { default: "primary" }), path("eventId", "Afspraak-ID")] },
      { id: "freebusy", resource: "Agenda", label: "Beschikbaarheid", method: "POST", path: "/freeBusy", params: [P("timeMin", "Vanaf (ISO)", { required: true }), P("timeMax", "Tot (ISO)", { required: true }), json("items", "Agenda's", { default: [{ id: "primary" }] })] },
      { id: "calendar.list", resource: "Agenda", label: "Agenda's", method: "GET", path: "/users/me/calendarList", output: "items" }
    ]
  },
  {
    id: "google-docs", name: "Google Docs", category: "Productiviteit", description: "Documenten maken en bijwerken", color: "#4285f4",
    website: "https://docs.google.com", docs: "https://developers.google.com/docs/api/reference/rest",
    baseUrl: "https://docs.googleapis.com/v1", auth: google([`${GS}documents`]),
    operations: [
      { id: "document.create", resource: "Document", label: "Document maken", method: "POST", path: "/documents", params: [P("title", "Titel", { required: true })] },
      { id: "document.get", resource: "Document", label: "Document ophalen", method: "GET", path: "/documents/{{documentId}}", params: [path("documentId", "Document-ID")] },
      { id: "document.appendText", resource: "Document", label: "Tekst toevoegen aan het eind", method: "POST", path: "/documents/{{documentId}}:batchUpdate", body: { requests: [{ insertText: { endOfSegmentLocation: { segmentId: "" }, text: "{{text}}" } }] },
        params: [path("documentId", "Document-ID"), P("text", "Tekst", { type: "text", required: true })] },
      { id: "document.replaceText", resource: "Document", label: "Tekst vervangen", method: "POST", path: "/documents/{{documentId}}:batchUpdate", body: { requests: [{ replaceAllText: { containsText: { text: "{{find}}", matchCase: true }, replaceText: "{{replace}}" } }] },
        params: [path("documentId", "Document-ID"), P("find", "Zoek", { required: true, placeholder: "{{klantnaam}}" }), P("replace", "Vervang door", { required: true })] },
      { id: "document.batchUpdate", resource: "Document", label: "Wijzigingen (batchUpdate)", method: "POST", path: "/documents/{{documentId}}:batchUpdate", params: [path("documentId", "Document-ID"), json("requests", "Requests", { required: true })] }
    ]
  },
  {
    id: "google-slides", name: "Google Slides", category: "Productiviteit", description: "Presentaties en pagina's", color: "#f4b400",
    website: "https://slides.google.com", docs: "https://developers.google.com/slides/api/reference/rest",
    baseUrl: "https://slides.googleapis.com/v1", auth: google([`${GS}presentations`]),
    operations: [
      { id: "presentation.create", resource: "Presentatie", label: "Presentatie maken", method: "POST", path: "/presentations", params: [P("title", "Titel", { required: true })] },
      { id: "presentation.get", resource: "Presentatie", label: "Presentatie ophalen", method: "GET", path: "/presentations/{{presentationId}}", params: [path("presentationId", "Presentatie-ID")] },
      { id: "presentation.replaceText", resource: "Presentatie", label: "Tekst vervangen", method: "POST", path: "/presentations/{{presentationId}}:batchUpdate", body: { requests: [{ replaceAllText: { containsText: { text: "{{find}}", matchCase: true }, replaceText: "{{replace}}" } }] },
        params: [path("presentationId", "Presentatie-ID"), P("find", "Zoek", { required: true }), P("replace", "Vervang door", { required: true })] }
    ]
  },
  {
    id: "google-tasks", name: "Google Tasks", category: "Productiviteit", description: "Taken en takenlijsten", color: "#1a73e8",
    website: "https://tasks.google.com", docs: "https://developers.google.com/tasks/reference/rest",
    baseUrl: "https://tasks.googleapis.com/tasks/v1", auth: google([`${GS}tasks`]), test: "tasklist.list",
    operations: [
      { id: "tasklist.list", resource: "Takenlijst", label: "Takenlijsten", method: "GET", path: "/users/@me/lists", output: "items" },
      { id: "task.list", resource: "Taak", label: "Taken", method: "GET", path: "/lists/{{tasklist}}/tasks", output: "items", params: [path("tasklist", "Takenlijst-ID", { default: "@default" }), q("showCompleted", "Ook afgerond", { default: "false" })] },
      { id: "task.create", resource: "Taak", label: "Taak maken", method: "POST", path: "/lists/{{tasklist}}/tasks", params: [path("tasklist", "Takenlijst-ID", { default: "@default" }), P("title", "Titel", { required: true }), P("notes", "Notities", { type: "text" }), P("due", "Deadline (RFC 3339)", { placeholder: "2026-10-01T00:00:00Z" })] },
      { id: "task.update", resource: "Taak", label: "Taak wijzigen", method: "PATCH", path: "/lists/{{tasklist}}/tasks/{{task}}", params: [path("tasklist", "Takenlijst-ID", { default: "@default" }), path("task", "Taak-ID"), P("title", "Titel"), P("notes", "Notities", { type: "text" }), P("status", "Status", { options: ["needsAction", "completed"] })] },
      { id: "task.delete", resource: "Taak", label: "Taak verwijderen", method: "DELETE", path: "/lists/{{tasklist}}/tasks/{{task}}", params: [path("tasklist", "Takenlijst-ID", { default: "@default" }), path("task", "Taak-ID")] }
    ]
  },
  {
    id: "google-contacts", name: "Google Contacts", category: "Verkoop & CRM", description: "Contactpersonen", color: "#1a73e8",
    website: "https://contacts.google.com", docs: "https://developers.google.com/people/api/rest",
    baseUrl: "https://people.googleapis.com/v1", auth: google([`${GS}contacts`]), test: "contact.list",
    operations: [
      { id: "contact.list", resource: "Contact", label: "Contacten", method: "GET", path: "/people/me/connections", output: "connections", params: [q("personFields", "Velden", { default: "names,emailAddresses,phoneNumbers,organizations" }), q("pageSize", "Aantal", { default: "100" })] },
      { id: "contact.search", resource: "Contact", label: "Contact zoeken", method: "GET", path: "/people:searchContacts", output: "results", params: [q("query", "Zoektekst", { required: true }), q("readMask", "Velden", { default: "names,emailAddresses,phoneNumbers" })] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/{{resourceName}}", params: [path("resourceName", "Resourcenaam", { format: "raw", placeholder: "people/c123" }), q("personFields", "Velden", { default: "names,emailAddresses,phoneNumbers,organizations" })] },
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/people:createContact",
        body: { names: [{ givenName: "{{givenName}}", familyName: "{{familyName}}" }], emailAddresses: [{ value: "{{email}}" }], phoneNumbers: [{ value: "{{phone}}" }], organizations: [{ name: "{{company}}" }] },
        params: [P("givenName", "Voornaam", { required: true }), P("familyName", "Achternaam"), P("email", "E-mail"), P("phone", "Telefoon"), P("company", "Bedrijf")] },
      { id: "contact.delete", resource: "Contact", label: "Contact verwijderen", method: "DELETE", path: "/{{resourceName}}:deleteContact", params: [path("resourceName", "Resourcenaam", { format: "raw" })] }
    ]
  },
  {
    id: "google-translate", name: "Google Translate", category: "AI", description: "Tekst vertalen", color: "#4285f4",
    website: "https://translate.google.com", docs: "https://cloud.google.com/translate/docs/reference/rest/v2/translate",
    baseUrl: "https://translation.googleapis.com/language/translate/v2", auth: { type: "apiKey", in: "query", name: "key", label: "API-key (Google Cloud)" }, test: "languages",
    operations: [
      { id: "translate", resource: "Vertaling", label: "Vertalen", method: "POST", path: "", output: "data.translations", params: [P("q", "Tekst", { type: "text", required: true }), P("target", "Naar taal", { required: true, default: "en" }), P("source", "Van taal (leeg = detecteren)"), P("format", "Formaat", { default: "text", options: ["text", "html"] })] },
      { id: "languages", resource: "Taal", label: "Talen", method: "GET", path: "/languages", output: "data.languages", params: [q("target", "Namen in taal", { default: "nl" })] }
    ]
  },
  {
    id: "google-chat", name: "Google Chat", category: "Communicatie", description: "Berichten in een Chat-ruimte (via webhook)", color: "#00ac47",
    website: "https://chat.google.com", docs: "https://developers.google.com/workspace/chat/quickstart/webhooks",
    baseUrl: "{{webhookUrl}}", auth: { type: "headers", headers: {}, fields: [{ key: "webhookUrl", label: "Webhook-URL van de ruimte", secret: true, placeholder: "https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…" }] },
    operations: [{ id: "message.send", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "", params: [P("text", "Tekst", { type: "text", required: true })] }]
  },
  {
    id: "youtube", name: "YouTube", category: "Social media", description: "Kanalen, video's en afspeellijsten", color: "#ff0000",
    website: "https://youtube.com", docs: "https://developers.google.com/youtube/v3/docs",
    baseUrl: "https://www.googleapis.com/youtube/v3", auth: google([`${GS}youtube`]), test: "channel.mine",
    operations: [
      { id: "channel.mine", resource: "Kanaal", label: "Mijn kanaal", method: "GET", path: "/channels", output: "items", params: [q("part", "Onderdelen", { default: "snippet,statistics" }), q("mine", "Mijn", { default: "true" })] },
      { id: "video.search", resource: "Video", label: "Video's zoeken", method: "GET", path: "/search", output: "items", params: [q("part", "Onderdelen", { default: "snippet" }), q("q", "Zoektekst"), q("channelId", "Kanaal-ID"), q("type", "Type", { default: "video" }), q("maxResults", "Aantal", { default: "25" }), q("order", "Sorteren", { default: "date", options: ["date", "rating", "relevance", "viewCount"] })] },
      { id: "video.get", resource: "Video", label: "Video-details", method: "GET", path: "/videos", output: "items", params: [q("id", "Video-ID('s)", { required: true }), q("part", "Onderdelen", { default: "snippet,statistics,contentDetails" })] },
      { id: "playlist.list", resource: "Afspeellijst", label: "Mijn afspeellijsten", method: "GET", path: "/playlists", output: "items", params: [q("part", "Onderdelen", { default: "snippet" }), q("mine", "Mijn", { default: "true" }), q("maxResults", "Aantal", { default: "50" })] },
      { id: "playlist.create", resource: "Afspeellijst", label: "Afspeellijst maken", method: "POST", path: "/playlists", params: [q("part", "Onderdelen", { default: "snippet,status" }), P("snippet.title", "Titel", { required: true }), P("snippet.description", "Omschrijving"), P("status.privacyStatus", "Zichtbaarheid", { default: "private", options: ["private", "unlisted", "public"] })] },
      { id: "playlistItem.add", resource: "Afspeellijst", label: "Video toevoegen aan afspeellijst", method: "POST", path: "/playlistItems", body: { snippet: { playlistId: "{{playlistId}}", resourceId: { kind: "youtube#video", videoId: "{{videoId}}" } } },
        params: [q("part", "Onderdelen", { default: "snippet" }), P("playlistId", "Afspeellijst-ID", { required: true }), P("videoId", "Video-ID", { required: true })] }
    ]
  },
  {
    id: "google-bigquery", name: "Google BigQuery", category: "Data & opslag", description: "Query's uitvoeren en rijen toevoegen", color: "#4285f4",
    website: "https://cloud.google.com/bigquery", docs: "https://cloud.google.com/bigquery/docs/reference/rest",
    baseUrl: "https://bigquery.googleapis.com/bigquery/v2/projects/{{projectId}}", auth: google([`${GS}bigquery`]), fields: [{ key: "projectId", label: "Project-ID" }], test: "dataset.list",
    operations: [
      { id: "query", resource: "Query", label: "SQL-query uitvoeren", method: "POST", path: "/queries", params: [P("query", "SQL", { type: "text", required: true, placeholder: "SELECT * FROM `dataset.tabel` LIMIT 100" }), bool("useLegacySql", "Legacy SQL", { default: false }), num("maxResults", "Max. rijen", { default: 1000 }), P("location", "Locatie", { placeholder: "EU" })] },
      { id: "rows.insert", resource: "Tabel", label: "Rijen toevoegen (streaming)", method: "POST", path: "/datasets/{{datasetId}}/tables/{{tableId}}/insertAll", body: { rows: "{{rows}}" },
        params: [path("datasetId", "Dataset"), path("tableId", "Tabel"), json("rows", "Rijen", { required: true, placeholder: '[{"json":{"id":1,"naam":"Jansen"}}]' })] },
      { id: "dataset.list", resource: "Dataset", label: "Datasets", method: "GET", path: "/datasets", output: "datasets" },
      { id: "table.list", resource: "Tabel", label: "Tabellen", method: "GET", path: "/datasets/{{datasetId}}/tables", output: "tables", params: [path("datasetId", "Dataset")] }
    ]
  },
  {
    id: "google-cloud-storage", name: "Google Cloud Storage", category: "Bestanden", description: "Buckets en objecten", color: "#4285f4",
    website: "https://cloud.google.com/storage", docs: "https://cloud.google.com/storage/docs/json_api/v1",
    baseUrl: "https://storage.googleapis.com/storage/v1", auth: google([`${GS}devstorage.read_write`]),
    operations: [
      { id: "bucket.list", resource: "Bucket", label: "Buckets", method: "GET", path: "/b", output: "items", params: [q("project", "Project-ID", { required: true })] },
      { id: "object.list", resource: "Object", label: "Objecten", method: "GET", path: "/b/{{bucket}}/o", output: "items", params: [path("bucket", "Bucket"), q("prefix", "Voorvoegsel"), q("maxResults", "Aantal", { default: "100" })] },
      { id: "object.get", resource: "Object", label: "Objectinfo", method: "GET", path: "/b/{{bucket}}/o/{{object}}", params: [path("bucket", "Bucket"), path("object", "Objectnaam")] },
      { id: "object.download", resource: "Object", label: "Inhoud (tekst)", method: "GET", path: "/b/{{bucket}}/o/{{object}}", params: [path("bucket", "Bucket"), path("object", "Objectnaam"), q("alt", "alt", { default: "media" })] },
      { id: "object.delete", resource: "Object", label: "Object verwijderen", method: "DELETE", path: "/b/{{bucket}}/o/{{object}}", params: [path("bucket", "Bucket"), path("object", "Objectnaam")] }
    ]
  },
  {
    id: "google-analytics", name: "Google Analytics", category: "Analyse", description: "Rapporten uit GA4 (Data API)", color: "#e37400",
    website: "https://analytics.google.com", docs: "https://developers.google.com/analytics/devguides/reporting/data/v1/rest",
    baseUrl: "https://analyticsdata.googleapis.com/v1beta", auth: google([`${GS}analytics.readonly`]),
    operations: [
      { id: "report.run", resource: "Rapport", label: "Rapport draaien", method: "POST", path: "/properties/{{propertyId}}:runReport",
        params: [path("propertyId", "Property-ID"), json("dateRanges", "Periode", { default: [{ startDate: "7daysAgo", endDate: "today" }] }), json("dimensions", "Dimensies", { default: [{ name: "date" }] }), json("metrics", "Metrics", { default: [{ name: "activeUsers" }, { name: "sessions" }] }), num("limit", "Max. rijen", { default: 1000 })] },
      { id: "realtime.run", resource: "Rapport", label: "Realtime-rapport", method: "POST", path: "/properties/{{propertyId}}:runRealtimeReport",
        params: [path("propertyId", "Property-ID"), json("metrics", "Metrics", { default: [{ name: "activeUsers" }] }), json("dimensions", "Dimensies", { default: [{ name: "country" }] })] }
    ]
  },
  {
    id: "gsuite-admin", name: "Google Workspace Admin", category: "Beveiliging", description: "Gebruikers en groepen in Google Workspace", color: "#1a73e8",
    website: "https://admin.google.com", docs: "https://developers.google.com/admin-sdk/directory/reference/rest",
    baseUrl: "https://admin.googleapis.com/admin/directory/v1", auth: google([`${GS}admin.directory.user`, `${GS}admin.directory.group`]), test: "user.list",
    operations: [
      { id: "user.list", resource: "Gebruiker", label: "Gebruikers", method: "GET", path: "/users", output: "users", params: [q("customer", "Klant", { default: "my_customer" }), q("query", "Zoekvraag"), q("maxResults", "Aantal", { default: "100" })] },
      { id: "user.get", resource: "Gebruiker", label: "Gebruiker ophalen", method: "GET", path: "/users/{{userKey}}", params: [path("userKey", "E-mail of ID")] },
      { id: "user.create", resource: "Gebruiker", label: "Gebruiker maken", method: "POST", path: "/users", params: [P("primaryEmail", "E-mail", { required: true }), P("name.givenName", "Voornaam", { required: true }), P("name.familyName", "Achternaam", { required: true }), P("password", "Wachtwoord", { required: true }), bool("changePasswordAtNextLogin", "Wachtwoord wijzigen bij eerste login", { default: true })] },
      { id: "user.suspend", resource: "Gebruiker", label: "Gebruiker blokkeren/deblokkeren", method: "PUT", path: "/users/{{userKey}}", params: [path("userKey", "E-mail of ID"), bool("suspended", "Geblokkeerd", { default: true })] },
      { id: "group.list", resource: "Groep", label: "Groepen", method: "GET", path: "/groups", output: "groups", params: [q("customer", "Klant", { default: "my_customer" })] },
      { id: "member.add", resource: "Groep", label: "Lid toevoegen aan groep", method: "POST", path: "/groups/{{groupKey}}/members", params: [path("groupKey", "Groep (e-mail/ID)"), P("email", "E-mail", { required: true }), P("role", "Rol", { default: "MEMBER", options: ["MEMBER", "MANAGER", "OWNER"] })] }
    ]
  },
  {
    id: "google-books", name: "Google Books", category: "Overig", description: "Boeken zoeken", color: "#4285f4",
    website: "https://books.google.com", docs: "https://developers.google.com/books/docs/v1/reference",
    baseUrl: "https://www.googleapis.com/books/v1", auth: { type: "apiKey", in: "query", name: "key", label: "API-key" }, test: "volume.search",
    operations: [
      { id: "volume.search", resource: "Boek", label: "Boeken zoeken", method: "GET", path: "/volumes", output: "items", params: [q("q", "Zoekvraag", { default: "isbn:9789025368463" }), q("maxResults", "Aantal", { default: "10" }), q("langRestrict", "Taal")] },
      { id: "volume.get", resource: "Boek", label: "Boek ophalen", method: "GET", path: "/volumes/{{volumeId}}", params: [path("volumeId", "Boek-ID")] }
    ]
  },
  {
    id: "google-perspective", name: "Google Perspective", category: "AI", description: "Toxiciteit van tekst beoordelen", color: "#4285f4",
    website: "https://perspectiveapi.com", docs: "https://developers.perspectiveapi.com/s/about-the-api-methods",
    baseUrl: "https://commentanalyzer.googleapis.com/v1alpha1", auth: { type: "apiKey", in: "query", name: "key", label: "API-key" },
    operations: [{ id: "comment.analyze", resource: "Tekst", label: "Tekst analyseren", method: "POST", path: "/comments:analyze", body: { comment: { text: "{{text}}" }, requestedAttributes: "{{attributes}}", languages: "{{languages}}" },
      params: [P("text", "Tekst", { type: "text", required: true }), json("attributes", "Kenmerken", { default: { TOXICITY: {}, INSULT: {} } }), P("languages", "Talen", { format: "list", default: ["nl"] })] }]
  },
  {
    id: "google-cloud-natural-language", name: "Google Cloud Natural Language", category: "AI", description: "Sentiment en entiteiten", color: "#4285f4",
    website: "https://cloud.google.com/natural-language", docs: "https://cloud.google.com/natural-language/docs/reference/rest",
    baseUrl: "https://language.googleapis.com/v1", auth: { type: "apiKey", in: "query", name: "key", label: "API-key" },
    operations: [
      { id: "sentiment", resource: "Analyse", label: "Sentiment", method: "POST", path: "/documents:analyzeSentiment", body: { document: { type: "PLAIN_TEXT", content: "{{text}}", language: "{{language}}" } }, params: [P("text", "Tekst", { type: "text", required: true }), P("language", "Taal", { placeholder: "nl" })] },
      { id: "entities", resource: "Analyse", label: "Entiteiten", method: "POST", path: "/documents:analyzeEntities", body: { document: { type: "PLAIN_TEXT", content: "{{text}}", language: "{{language}}" } }, params: [P("text", "Tekst", { type: "text", required: true }), P("language", "Taal")] }
    ]
  },
  {
    id: "google-firestore", name: "Google Cloud Firestore", category: "Data & opslag", description: "Documenten en collecties", color: "#ffa000",
    website: "https://firebase.google.com/products/firestore", docs: "https://firebase.google.com/docs/firestore/reference/rest",
    baseUrl: "https://firestore.googleapis.com/v1/projects/{{projectId}}/databases/(default)/documents", auth: google([`${GS}datastore`]), fields: [{ key: "projectId", label: "Project-ID" }],
    operations: [
      { id: "document.get", resource: "Document", label: "Document ophalen", method: "GET", path: "/{{collection}}/{{documentId}}", params: [path("collection", "Collectie", { format: "raw" }), path("documentId", "Document-ID")] },
      { id: "document.list", resource: "Document", label: "Documenten", method: "GET", path: "/{{collection}}", output: "documents", params: [path("collection", "Collectie", { format: "raw" }), q("pageSize", "Aantal", { default: "100" })] },
      { id: "document.create", resource: "Document", label: "Document maken", method: "POST", path: "/{{collection}}", body: { fields: "{{fields}}" },
        params: [path("collection", "Collectie", { format: "raw" }), q("documentId", "Document-ID (optioneel)"), json("fields", "Velden (Firestore-typen)", { required: true, placeholder: '{"naam":{"stringValue":"Jansen"},"aantal":{"integerValue":"3"}}' })] },
      { id: "document.delete", resource: "Document", label: "Document verwijderen", method: "DELETE", path: "/{{collection}}/{{documentId}}", params: [path("collection", "Collectie", { format: "raw" }), path("documentId", "Document-ID")] }
    ]
  },
  {
    id: "google-realtime-database", name: "Google Firebase Realtime Database", category: "Data & opslag", description: "Data lezen en schrijven", color: "#ffa000",
    website: "https://firebase.google.com/products/realtime-database", docs: "https://firebase.google.com/docs/reference/rest/database",
    baseUrl: "{{databaseUrl}}", auth: { type: "query", query: { auth: "{{secret}}" }, fields: [{ key: "databaseUrl", label: "Database-URL", placeholder: "https://project-default-rtdb.europe-west1.firebasedatabase.app" }, { key: "secret", label: "Database secret of ID-token", secret: true }] },
    operations: [
      { id: "data.get", resource: "Data", label: "Lezen", method: "GET", path: "/{{path}}.json", params: [path("path", "Pad", { format: "raw", placeholder: "orders/123" })] },
      { id: "data.set", resource: "Data", label: "Schrijven (vervangen)", method: "PUT", path: "/{{path}}.json", bodyParam: "data", params: [path("path", "Pad", { format: "raw" }), json("data", "Data", { required: true })] },
      { id: "data.update", resource: "Data", label: "Bijwerken", method: "PATCH", path: "/{{path}}.json", bodyParam: "data", params: [path("path", "Pad", { format: "raw" }), json("data", "Data", { required: true })] },
      { id: "data.push", resource: "Data", label: "Toevoegen aan lijst", method: "POST", path: "/{{path}}.json", bodyParam: "data", params: [path("path", "Pad", { format: "raw" }), json("data", "Data", { required: true })] },
      { id: "data.delete", resource: "Data", label: "Verwijderen", method: "DELETE", path: "/{{path}}.json", params: [path("path", "Pad", { format: "raw" })] }
    ]
  }
];
