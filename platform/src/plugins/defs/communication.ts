import type { PluginDef } from "../types";
import { P, bool, json, num, path, q, urlField } from "./_shared";

export const COMMUNICATION: PluginDef[] = [
  {
    id: "slack", name: "Slack", category: "Communicatie", description: "Berichten, kanalen en gebruikers", color: "#4a154b",
    website: "https://slack.com", docs: "https://api.slack.com/methods",
    baseUrl: "https://slack.com/api", auth: { type: "bearer", label: "Bot token (xoxb-…)", help: "Maak een Slack-app, geef de bot de scopes chat:write, channels:read, users:read (en files:write indien nodig), installeer hem in je workspace en kopieer het Bot User OAuth Token." },
    okField: "ok", errorPath: "error", test: "auth.test",
    operations: [
      { id: "message.post", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "/chat.postMessage", params: [P("channel", "Kanaal (ID of #naam)", { required: true }), P("text", "Tekst", { type: "text", required: true }), json("blocks", "Blocks (Block Kit)"), P("thread_ts", "In thread (ts)"), bool("unfurl_links", "Linkvoorbeelden", { default: true })] },
      { id: "message.update", resource: "Bericht", label: "Bericht wijzigen", method: "POST", path: "/chat.update", params: [P("channel", "Kanaal-ID", { required: true }), P("ts", "Bericht-ts", { required: true }), P("text", "Nieuwe tekst", { type: "text", required: true })] },
      { id: "message.delete", resource: "Bericht", label: "Bericht verwijderen", method: "POST", path: "/chat.delete", params: [P("channel", "Kanaal-ID", { required: true }), P("ts", "Bericht-ts", { required: true })] },
      { id: "reaction.add", resource: "Bericht", label: "Reactie (emoji)", method: "POST", path: "/reactions.add", params: [P("channel", "Kanaal-ID", { required: true }), P("timestamp", "Bericht-ts", { required: true }), P("name", "Emoji", { required: true, placeholder: "white_check_mark" })] },
      { id: "channel.list", resource: "Kanaal", label: "Kanalen", method: "GET", path: "/conversations.list", output: "channels", params: [q("types", "Typen", { default: "public_channel,private_channel" }), q("limit", "Aantal", { default: "200" }), q("exclude_archived", "Zonder gearchiveerde", { default: "true" })] },
      { id: "channel.history", resource: "Kanaal", label: "Berichten in kanaal", method: "GET", path: "/conversations.history", output: "messages", params: [q("channel", "Kanaal-ID", { required: true }), q("limit", "Aantal", { default: "50" }), q("oldest", "Vanaf (ts)")] },
      { id: "channel.create", resource: "Kanaal", label: "Kanaal maken", method: "POST", path: "/conversations.create", params: [P("name", "Naam", { required: true }), bool("is_private", "Privé", { default: false })] },
      { id: "channel.invite", resource: "Kanaal", label: "Gebruikers uitnodigen", method: "POST", path: "/conversations.invite", params: [P("channel", "Kanaal-ID", { required: true }), P("users", "Gebruiker-ID's (komma)", { required: true })] },
      { id: "user.list", resource: "Gebruiker", label: "Gebruikers", method: "GET", path: "/users.list", output: "members", params: [q("limit", "Aantal", { default: "200" })] },
      { id: "user.byEmail", resource: "Gebruiker", label: "Gebruiker via e-mail", method: "GET", path: "/users.lookupByEmail", output: "user", params: [q("email", "E-mail", { required: true })] },
      { id: "auth.test", resource: "Account", label: "Verbinding testen", method: "POST", path: "/auth.test" }
    ]
  },
  {
    id: "discord", name: "Discord", category: "Communicatie", description: "Berichten versturen naar kanalen", color: "#5865f2",
    website: "https://discord.com", docs: "https://discord.com/developers/docs/resources/message",
    baseUrl: "https://discord.com/api/v10", auth: { type: "bearer", prefix: "Bot", label: "Bot token", help: "Maak een applicatie met een bot in het Discord Developer Portal, nodig de bot uit op je server en kopieer het token." }, test: "me",
    operations: [
      { id: "message.send", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "/channels/{{channelId}}/messages", params: [path("channelId", "Kanaal-ID"), P("content", "Tekst", { type: "text", required: true }), json("embeds", "Embeds")] },
      { id: "message.list", resource: "Bericht", label: "Berichten", method: "GET", path: "/channels/{{channelId}}/messages", params: [path("channelId", "Kanaal-ID"), q("limit", "Aantal", { default: "50" })] },
      { id: "message.delete", resource: "Bericht", label: "Bericht verwijderen", method: "DELETE", path: "/channels/{{channelId}}/messages/{{messageId}}", params: [path("channelId", "Kanaal-ID"), path("messageId", "Bericht-ID")] },
      { id: "guild.channels", resource: "Server", label: "Kanalen van server", method: "GET", path: "/guilds/{{guildId}}/channels", params: [path("guildId", "Server-ID")] },
      { id: "guild.members", resource: "Server", label: "Leden", method: "GET", path: "/guilds/{{guildId}}/members", params: [path("guildId", "Server-ID"), q("limit", "Aantal", { default: "100" })] },
      { id: "me", resource: "Account", label: "Bot-account", method: "GET", path: "/users/@me" }
    ]
  },
  {
    id: "telegram", name: "Telegram", category: "Communicatie", description: "Berichten en bestanden via een bot", color: "#229ed9",
    website: "https://telegram.org", docs: "https://core.telegram.org/bots/api",
    baseUrl: "https://api.telegram.org/bot{{botToken}}", auth: { type: "headers", headers: {}, fields: [{ key: "botToken", label: "Bot token", secret: true, help: "Via @BotFather: /newbot" }] },
    okField: "ok", errorPath: "description", test: "me",
    operations: [
      { id: "message.send", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "/sendMessage", output: "result", params: [P("chat_id", "Chat-ID", { required: true }), P("text", "Tekst", { type: "text", required: true }), P("parse_mode", "Opmaak", { options: ["HTML", "MarkdownV2"] }), bool("disable_notification", "Stil versturen", { default: false }), json("reply_markup", "Knoppen (reply_markup)")] },
      { id: "photo.send", resource: "Bericht", label: "Foto versturen (URL)", method: "POST", path: "/sendPhoto", output: "result", params: [P("chat_id", "Chat-ID", { required: true }), P("photo", "Foto-URL", { required: true }), P("caption", "Bijschrift")] },
      { id: "document.send", resource: "Bericht", label: "Document versturen (URL)", method: "POST", path: "/sendDocument", output: "result", params: [P("chat_id", "Chat-ID", { required: true }), P("document", "Bestand-URL", { required: true }), P("caption", "Bijschrift")] },
      { id: "location.send", resource: "Bericht", label: "Locatie versturen", method: "POST", path: "/sendLocation", output: "result", params: [P("chat_id", "Chat-ID", { required: true }), num("latitude", "Breedtegraad", { required: true }), num("longitude", "Lengtegraad", { required: true })] },
      { id: "message.edit", resource: "Bericht", label: "Bericht wijzigen", method: "POST", path: "/editMessageText", output: "result", params: [P("chat_id", "Chat-ID", { required: true }), num("message_id", "Bericht-ID", { required: true }), P("text", "Nieuwe tekst", { type: "text", required: true })] },
      { id: "message.delete", resource: "Bericht", label: "Bericht verwijderen", method: "POST", path: "/deleteMessage", output: "result", params: [P("chat_id", "Chat-ID", { required: true }), num("message_id", "Bericht-ID", { required: true })] },
      { id: "updates.get", resource: "Updates", label: "Nieuwe berichten ophalen", method: "GET", path: "/getUpdates", output: "result", params: [q("offset", "Offset"), q("limit", "Aantal", { default: "50" })] },
      { id: "chat.get", resource: "Chat", label: "Chat-info", method: "GET", path: "/getChat", output: "result", params: [q("chat_id", "Chat-ID", { required: true })] },
      { id: "me", resource: "Account", label: "Bot-info", method: "GET", path: "/getMe", output: "result" }
    ]
  },
  {
    id: "whatsapp", name: "WhatsApp Business", category: "Communicatie", description: "Berichten via de WhatsApp Cloud API", color: "#25d366",
    website: "https://business.whatsapp.com", docs: "https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages",
    baseUrl: "https://graph.facebook.com/v21.0", auth: { type: "bearer", label: "Access token (systeemgebruiker)" }, fields: [{ key: "phoneNumberId", label: "Telefoonnummer-ID" }], test: "phone.get",
    operations: [
      { id: "message.text", resource: "Bericht", label: "Tekstbericht", method: "POST", path: "/{{phoneNumberId}}/messages", body: { messaging_product: "whatsapp", recipient_type: "individual", to: "{{to}}", type: "text", text: { body: "{{text}}", preview_url: false } },
        params: [P("to", "Naar (telefoonnummer, internationaal)", { required: true, placeholder: "31612345678" }), P("text", "Tekst", { type: "text", required: true })] },
      { id: "message.template", resource: "Bericht", label: "Templatebericht", method: "POST", path: "/{{phoneNumberId}}/messages", body: { messaging_product: "whatsapp", to: "{{to}}", type: "template", template: { name: "{{template}}", language: { code: "{{language}}" }, components: "{{components}}" } },
        params: [P("to", "Naar", { required: true }), P("template", "Templatenaam", { required: true }), P("language", "Taalcode", { default: "nl" }), json("components", "Componenten (variabelen)")] },
      { id: "phone.get", resource: "Account", label: "Telefoonnummer-info", method: "GET", path: "/{{phoneNumberId}}" }
    ]
  },
  {
    id: "twilio", name: "Twilio", category: "Communicatie", description: "Sms, WhatsApp en gesprekken", color: "#f22f46",
    website: "https://twilio.com", docs: "https://www.twilio.com/docs/usage/api",
    baseUrl: "https://api.twilio.com/2010-04-01/Accounts/{{user}}", auth: { type: "basic", userLabel: "Account SID", passLabel: "Auth token" }, test: "account",
    operations: [
      { id: "sms.send", resource: "Bericht", label: "Sms of WhatsApp versturen", method: "POST", path: "/Messages.json", bodyType: "form", params: [P("To", "Naar", { required: true, placeholder: "+31612345678 of whatsapp:+316…" }), P("From", "Van", { required: true }), P("Body", "Tekst", { type: "text", required: true }), P("MediaUrl", "Media-URL")] },
      { id: "message.list", resource: "Bericht", label: "Berichten", method: "GET", path: "/Messages.json", output: "messages", params: [q("To", "Naar"), q("From", "Van"), q("PageSize", "Aantal", { default: "50" })] },
      { id: "call.make", resource: "Gesprek", label: "Gesprek starten", method: "POST", path: "/Calls.json", bodyType: "form", params: [P("To", "Naar", { required: true }), P("From", "Van", { required: true }), P("Twiml", "TwiML", { placeholder: "<Response><Say language=\"nl-NL\">Hallo</Say></Response>" }), P("Url", "Of TwiML-URL")] },
      { id: "account", resource: "Account", label: "Account", method: "GET", path: ".json" }
    ]
  },
  {
    id: "sendgrid", name: "SendGrid", category: "Communicatie", description: "E-mail versturen en contacten", color: "#1a82e2",
    website: "https://sendgrid.com", docs: "https://www.twilio.com/docs/sendgrid/api-reference",
    baseUrl: "https://api.sendgrid.com/v3", auth: { type: "bearer", label: "API-key" }, test: "user",
    operations: [
      { id: "mail.send", resource: "E-mail", label: "E-mail versturen", method: "POST", path: "/mail/send",
        body: { personalizations: [{ to: [{ email: "{{to}}" }], cc: "{{cc}}" }], from: { email: "{{from}}", name: "{{fromName}}" }, reply_to: { email: "{{replyTo}}" }, subject: "{{subject}}", content: [{ type: "{{contentType}}", value: "{{content}}" }] },
        params: [P("to", "Aan", { required: true }), P("cc", "Cc", { type: "json", placeholder: '[{"email":"x@y.nl"}]' }), P("from", "Van (geverifieerd adres)", { required: true }), P("fromName", "Naam afzender"), P("replyTo", "Antwoord naar"), P("subject", "Onderwerp", { required: true }), P("content", "Inhoud", { type: "text", required: true }), P("contentType", "Type", { default: "text/plain", options: ["text/plain", "text/html"] })] },
      { id: "mail.template", resource: "E-mail", label: "E-mail met dynamische template", method: "POST", path: "/mail/send", body: { personalizations: [{ to: [{ email: "{{to}}" }], dynamic_template_data: "{{data}}" }], from: { email: "{{from}}" }, template_id: "{{templateId}}" },
        params: [P("to", "Aan", { required: true }), P("from", "Van", { required: true }), P("templateId", "Template-ID", { required: true }), json("data", "Templatedata", { default: {} })] },
      { id: "contact.upsert", resource: "Contact", label: "Contacten toevoegen/bijwerken", method: "PUT", path: "/marketing/contacts", params: [json("contacts", "Contacten", { required: true, placeholder: '[{"email":"jan@bedrijf.nl","first_name":"Jan"}]' }), P("list_ids", "Lijst-ID's", { format: "list" })] },
      { id: "list.list", resource: "Lijst", label: "Lijsten", method: "GET", path: "/marketing/lists", output: "result" },
      { id: "user", resource: "Account", label: "Profiel", method: "GET", path: "/user/profile" }
    ]
  },
  {
    id: "mailgun", name: "Mailgun", category: "Communicatie", description: "E-mail versturen", color: "#c02126",
    website: "https://mailgun.com", docs: "https://documentation.mailgun.com/docs/mailgun/api-reference/",
    baseUrl: "https://{{host}}/v3", auth: { type: "basic", userLabel: "Gebruiker (api)", passLabel: "API-key" },
    fields: [{ key: "host", label: "API-host", default: "api.eu.mailgun.net", placeholder: "api.mailgun.net (VS) of api.eu.mailgun.net" }, { key: "domain", label: "Domein", placeholder: "mg.bedrijf.nl" }], test: "domain.get",
    operations: [
      { id: "message.send", resource: "E-mail", label: "E-mail versturen", method: "POST", path: "/{{domain}}/messages", bodyType: "form", params: [P("from", "Van", { required: true }), P("to", "Aan", { required: true }), P("cc", "Cc"), P("subject", "Onderwerp", { required: true }), P("text", "Tekst", { type: "text" }), P("html", "HTML", { type: "text" })] },
      { id: "domain.get", resource: "Domein", label: "Domeininfo", method: "GET", path: "/domains/{{domain}}" }
    ]
  },
  {
    id: "mailjet", name: "Mailjet", category: "Communicatie", description: "E-mail en sms versturen", color: "#fea32c",
    website: "https://mailjet.com", docs: "https://dev.mailjet.com/email/reference/",
    baseUrl: "https://api.mailjet.com", auth: { type: "basic", userLabel: "API-key", passLabel: "Secret key" }, test: "sender.list",
    operations: [
      { id: "email.send", resource: "E-mail", label: "E-mail versturen", method: "POST", path: "/v3.1/send",
        body: { Messages: [{ From: { Email: "{{from}}", Name: "{{fromName}}" }, To: [{ Email: "{{to}}" }], Subject: "{{subject}}", TextPart: "{{text}}", HTMLPart: "{{html}}" }] },
        params: [P("from", "Van", { required: true }), P("fromName", "Naam afzender"), P("to", "Aan", { required: true }), P("subject", "Onderwerp", { required: true }), P("text", "Tekst", { type: "text" }), P("html", "HTML", { type: "text" })] },
      { id: "sender.list", resource: "Afzender", label: "Afzenders", method: "GET", path: "/v3/REST/sender", output: "Data" }
    ]
  },
  {
    id: "postmark", name: "Postmark", category: "Communicatie", description: "Transactionele e-mail", color: "#ffde00",
    website: "https://postmarkapp.com", docs: "https://postmarkapp.com/developer",
    baseUrl: "https://api.postmarkapp.com", auth: { type: "headers", headers: { "X-Postmark-Server-Token": "{{serverToken}}" }, fields: [{ key: "serverToken", label: "Server API-token", secret: true }] }, test: "server",
    operations: [
      { id: "email.send", resource: "E-mail", label: "E-mail versturen", method: "POST", path: "/email", params: [P("From", "Van", { required: true }), P("To", "Aan", { required: true }), P("Subject", "Onderwerp", { required: true }), P("TextBody", "Tekst", { type: "text" }), P("HtmlBody", "HTML", { type: "text" }), P("MessageStream", "Stream", { default: "outbound" })] },
      { id: "email.template", resource: "E-mail", label: "E-mail met template", method: "POST", path: "/email/withTemplate", params: [P("From", "Van", { required: true }), P("To", "Aan", { required: true }), P("TemplateAlias", "Template-alias", { required: true }), json("TemplateModel", "Templatedata", { default: {} })] },
      { id: "server", resource: "Account", label: "Serverinfo", method: "GET", path: "/server" }
    ]
  },
  {
    id: "brevo", name: "Brevo", category: "Marketing", description: "E-mail/sms en contacten (voorheen Sendinblue)", color: "#0b996e",
    website: "https://brevo.com", docs: "https://developers.brevo.com/reference",
    baseUrl: "https://api.brevo.com/v3", auth: { type: "apiKey", in: "header", name: "api-key", label: "API-key" }, test: "account",
    operations: [
      { id: "email.send", resource: "E-mail", label: "Transactionele e-mail", method: "POST", path: "/smtp/email",
        body: { sender: { email: "{{from}}", name: "{{fromName}}" }, to: [{ email: "{{to}}", name: "{{toName}}" }], subject: "{{subject}}", htmlContent: "{{html}}", textContent: "{{text}}", templateId: "{{templateId}}", params: "{{templateParams}}" },
        params: [P("from", "Van", { required: true }), P("fromName", "Naam afzender"), P("to", "Aan", { required: true }), P("toName", "Naam ontvanger"), P("subject", "Onderwerp"), P("html", "HTML", { type: "text" }), P("text", "Tekst", { type: "text" }), num("templateId", "Template-ID"), json("templateParams", "Templatedata")] },
      { id: "contact.create", resource: "Contact", label: "Contact maken/bijwerken", method: "POST", path: "/contacts", params: [P("email", "E-mail", { required: true }), json("attributes", "Attributen", { placeholder: '{"VOORNAAM":"Jan"}' }), P("listIds", "Lijst-ID's", { format: "list", type: "number" }), bool("updateEnabled", "Bestaande bijwerken", { default: true })] },
      { id: "contact.get", resource: "Contact", label: "Contact ophalen", method: "GET", path: "/contacts/{{identifier}}", params: [path("identifier", "E-mail of ID")] },
      { id: "sms.send", resource: "Sms", label: "Transactionele sms", method: "POST", path: "/transactionalSMS/sms", params: [P("sender", "Afzender", { required: true }), P("recipient", "Ontvanger", { required: true }), P("content", "Tekst", { required: true })] },
      { id: "account", resource: "Account", label: "Account", method: "GET", path: "/account" }
    ]
  },
  {
    id: "mattermost", name: "Mattermost", category: "Communicatie", description: "Berichten en kanalen", color: "#1e325c",
    website: "https://mattermost.com", docs: "https://api.mattermost.com",
    baseUrl: "{{url}}/api/v4", auth: { type: "bearer", label: "Personal access token of bot-token" }, fields: [urlField("Server-URL", "https://chat.bedrijf.nl")], test: "me",
    operations: [
      { id: "post.create", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "/posts", params: [P("channel_id", "Kanaal-ID", { required: true }), P("message", "Tekst", { type: "text", required: true }), P("root_id", "In thread (post-ID)")] },
      { id: "channel.byName", resource: "Kanaal", label: "Kanaal via naam", method: "GET", path: "/teams/{{teamId}}/channels/name/{{name}}", params: [path("teamId", "Team-ID"), path("name", "Kanaalnaam")] },
      { id: "channel.posts", resource: "Kanaal", label: "Berichten in kanaal", method: "GET", path: "/channels/{{channelId}}/posts", params: [path("channelId", "Kanaal-ID"), q("per_page", "Aantal", { default: "50" })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me" }
    ]
  },
  {
    id: "rocketchat", name: "Rocket.Chat", category: "Communicatie", description: "Berichten in kanalen", color: "#f5455c",
    website: "https://rocket.chat", docs: "https://developer.rocket.chat/apidocs",
    baseUrl: "{{url}}/api/v1", auth: { type: "headers", headers: { "X-Auth-Token": "{{authToken}}", "X-User-Id": "{{userId}}" }, fields: [{ key: "userId", label: "User-ID" }, { key: "authToken", label: "Personal access token", secret: true }] },
    fields: [urlField("Server-URL")], okField: "success", test: "me",
    operations: [
      { id: "message.post", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "/chat.postMessage", params: [P("channel", "Kanaal (#naam of @gebruiker)", { required: true }), P("text", "Tekst", { type: "text", required: true }), P("alias", "Weergavenaam")] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/me" }
    ]
  },
  {
    id: "zulip", name: "Zulip", category: "Communicatie", description: "Berichten en streams", color: "#6492fe",
    website: "https://zulip.com", docs: "https://zulip.com/api/rest",
    baseUrl: "{{url}}/api/v1", auth: { type: "basic", userLabel: "E-mail (bot)", passLabel: "API-key" }, fields: [urlField("Server-URL", "https://bedrijf.zulipchat.com")], test: "me",
    operations: [
      { id: "message.stream", resource: "Bericht", label: "Bericht in stream", method: "POST", path: "/messages", bodyType: "form", body: { type: "stream", to: "{{stream}}", topic: "{{topic}}", content: "{{content}}" }, params: [P("stream", "Stream", { required: true }), P("topic", "Onderwerp", { required: true }), P("content", "Tekst", { type: "text", required: true })] },
      { id: "message.private", resource: "Bericht", label: "Privébericht", method: "POST", path: "/messages", bodyType: "form", body: { type: "private", to: "{{to}}", content: "{{content}}" }, params: [P("to", "Aan (e-mail)", { required: true }), P("content", "Tekst", { type: "text", required: true })] },
      { id: "stream.list", resource: "Stream", label: "Streams", method: "GET", path: "/streams", output: "streams" },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me" }
    ]
  },
  {
    id: "cisco-webex", name: "Cisco Webex", category: "Communicatie", description: "Berichten en vergaderingen", color: "#00bceb",
    website: "https://webex.com", docs: "https://developer.webex.com/docs/api/getting-started",
    baseUrl: "https://webexapis.com/v1", auth: { type: "bearer", label: "Bot- of integratietoken" }, test: "me",
    operations: [
      { id: "message.create", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "/messages", params: [P("roomId", "Ruimte-ID"), P("toPersonEmail", "Of: aan (e-mail)"), P("text", "Tekst", { type: "text" }), P("markdown", "Markdown", { type: "text" })] },
      { id: "room.list", resource: "Ruimte", label: "Ruimtes", method: "GET", path: "/rooms", output: "items" },
      { id: "meeting.create", resource: "Vergadering", label: "Vergadering plannen", method: "POST", path: "/meetings", params: [P("title", "Titel", { required: true }), P("start", "Start (ISO)", { required: true }), P("end", "Einde (ISO)", { required: true }), P("invitees", "Genodigden", { type: "json", placeholder: '[{"email":"jan@bedrijf.nl"}]' })] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/people/me" }
    ]
  },
  {
    id: "discourse", name: "Discourse", category: "Communicatie", description: "Forumposts, categorieën en gebruikers", color: "#231f20",
    website: "https://discourse.org", docs: "https://docs.discourse.org",
    baseUrl: "{{url}}", auth: { type: "headers", headers: { "Api-Key": "{{apiKey}}", "Api-Username": "{{apiUsername}}" }, fields: [{ key: "apiKey", label: "API-key", secret: true }, { key: "apiUsername", label: "API-gebruikersnaam", default: "system" }] },
    fields: [urlField("Forum-URL")], test: "category.list",
    operations: [
      { id: "topic.create", resource: "Onderwerp", label: "Onderwerp plaatsen", method: "POST", path: "/posts.json", params: [P("title", "Titel", { required: true }), P("raw", "Tekst (markdown)", { type: "text", required: true }), num("category", "Categorie-ID")] },
      { id: "post.reply", resource: "Onderwerp", label: "Reageren", method: "POST", path: "/posts.json", params: [num("topic_id", "Onderwerp-ID", { required: true }), P("raw", "Tekst", { type: "text", required: true })] },
      { id: "topic.get", resource: "Onderwerp", label: "Onderwerp ophalen", method: "GET", path: "/t/{{id}}.json", params: [path("id", "Onderwerp-ID")] },
      { id: "category.list", resource: "Categorie", label: "Categorieën", method: "GET", path: "/categories.json", output: "category_list.categories" },
      { id: "user.get", resource: "Gebruiker", label: "Gebruiker", method: "GET", path: "/u/{{username}}.json", output: "user", params: [path("username", "Gebruikersnaam")] }
    ]
  },
  {
    id: "pushover", name: "Pushover", category: "Communicatie", description: "Pushberichten naar telefoon", color: "#249df1",
    website: "https://pushover.net", docs: "https://pushover.net/api",
    baseUrl: "https://api.pushover.net/1", auth: { type: "headers", headers: {}, fields: [{ key: "appToken", label: "Applicatie-token", secret: true }, { key: "userKey", label: "Gebruikers-/groepssleutel" }] },
    operations: [{ id: "message.send", resource: "Bericht", label: "Pushbericht", method: "POST", path: "/messages.json", bodyType: "form",
      body: { token: "{{appToken}}", user: "{{userKey}}", message: "{{message}}", title: "{{title}}", url: "{{url}}", priority: "{{priority}}", sound: "{{sound}}" },
      params: [P("message", "Bericht", { type: "text", required: true }), P("title", "Titel"), P("url", "Link"), num("priority", "Prioriteit (-2 t/m 2)", { default: 0 }), P("sound", "Geluid")] }]
  },
  {
    id: "pushbullet", name: "Pushbullet", category: "Communicatie", description: "Pushberichten", color: "#4ab367",
    website: "https://pushbullet.com", docs: "https://docs.pushbullet.com",
    baseUrl: "https://api.pushbullet.com/v2", auth: { type: "headers", headers: { "Access-Token": "{{accessToken}}" }, fields: [{ key: "accessToken", label: "Access token", secret: true }] }, test: "me",
    operations: [
      { id: "push.note", resource: "Push", label: "Notitie pushen", method: "POST", path: "/pushes", body: { type: "note", title: "{{title}}", body: "{{body}}", email: "{{email}}" }, params: [P("title", "Titel"), P("body", "Tekst", { type: "text", required: true }), P("email", "Naar (e-mail, leeg = jezelf)")] },
      { id: "push.link", resource: "Push", label: "Link pushen", method: "POST", path: "/pushes", body: { type: "link", title: "{{title}}", url: "{{url}}", body: "{{body}}" }, params: [P("title", "Titel"), P("url", "URL", { required: true }), P("body", "Tekst")] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/users/me" }
    ]
  },
  {
    id: "gotify", name: "Gotify", category: "Communicatie", description: "Pushberichten via een eigen Gotify-server", color: "#3d8fd1",
    website: "https://gotify.net", docs: "https://gotify.net/api-docs",
    baseUrl: "{{url}}", auth: { type: "headers", headers: { "X-Gotify-Key": "{{appToken}}" }, fields: [{ key: "appToken", label: "App-token", secret: true }] }, fields: [urlField("Server-URL")],
    operations: [{ id: "message.send", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "/message", params: [P("title", "Titel"), P("message", "Bericht", { type: "text", required: true }), num("priority", "Prioriteit", { default: 5 })] }]
  },
  {
    id: "signl4", name: "SIGNL4", category: "Cloud & infra", description: "Alarmen naar teams", color: "#ff6f00",
    website: "https://signl4.com", docs: "https://docs.signl4.com/integrations/webhook/webhook.html",
    baseUrl: "https://connect.signl4.com/webhook/{{teamSecret}}", auth: { type: "headers", headers: {}, fields: [{ key: "teamSecret", label: "Team secret", secret: true }] },
    operations: [
      { id: "alert.send", resource: "Alarm", label: "Alarm versturen", method: "POST", path: "", body: { Title: "{{title}}", Message: "{{message}}", "X-S4-Service": "{{service}}", "X-S4-ExternalID": "{{externalId}}", "X-S4-Status": "new" }, params: [P("title", "Titel", { required: true }), P("message", "Bericht", { type: "text" }), P("service", "Dienst"), P("externalId", "Externe ID (om later op te lossen)")] },
      { id: "alert.resolve", resource: "Alarm", label: "Alarm oplossen", method: "POST", path: "", body: { "X-S4-ExternalID": "{{externalId}}", "X-S4-Status": "resolved" }, params: [P("externalId", "Externe ID", { required: true })] }
    ]
  },
  {
    id: "vonage", name: "Vonage", category: "Communicatie", description: "Sms versturen", color: "#000000",
    website: "https://vonage.com", docs: "https://developer.vonage.com/en/api/sms",
    baseUrl: "https://rest.nexmo.com", auth: { type: "headers", headers: {}, fields: [{ key: "apiKey", label: "API-key" }, { key: "apiSecret", label: "API-secret", secret: true }] },
    operations: [{ id: "sms.send", resource: "Sms", label: "Sms versturen", method: "POST", path: "/sms/json", bodyType: "form", output: "messages", body: { api_key: "{{apiKey}}", api_secret: "{{apiSecret}}", from: "{{from}}", to: "{{to}}", text: "{{text}}" },
      params: [P("from", "Van (naam of nummer)", { required: true }), P("to", "Naar (internationaal)", { required: true }), P("text", "Tekst", { required: true })] }]
  },
  {
    id: "plivo", name: "Plivo", category: "Communicatie", description: "Sms en gesprekken", color: "#43a047",
    website: "https://plivo.com", docs: "https://www.plivo.com/docs/sms/api/message",
    baseUrl: "https://api.plivo.com/v1/Account/{{user}}", auth: { type: "basic", userLabel: "Auth ID", passLabel: "Auth token" }, test: "account",
    operations: [
      { id: "sms.send", resource: "Sms", label: "Sms versturen", method: "POST", path: "/Message/", params: [P("src", "Van", { required: true }), P("dst", "Naar", { required: true }), P("text", "Tekst", { required: true })] },
      { id: "account", resource: "Account", label: "Account", method: "GET", path: "/" }
    ]
  },
  {
    id: "seven", name: "seven (sms77)", category: "Communicatie", description: "Sms en spraakberichten", color: "#00d488",
    website: "https://seven.io", docs: "https://docs.seven.io/en/rest-api/endpoints/sms",
    baseUrl: "https://gateway.seven.io/api", auth: { type: "apiKey", in: "header", name: "X-Api-Key", label: "API-key" }, test: "balance",
    operations: [
      { id: "sms.send", resource: "Sms", label: "Sms versturen", method: "POST", path: "/sms", params: [P("to", "Naar", { required: true }), P("text", "Tekst", { required: true }), P("from", "Afzender")] },
      { id: "voice.call", resource: "Spraak", label: "Spraakbericht", method: "POST", path: "/voice", params: [P("to", "Naar", { required: true }), P("text", "Tekst", { required: true })] },
      { id: "balance", resource: "Account", label: "Tegoed", method: "GET", path: "/balance" }
    ]
  },
  {
    id: "msg91", name: "MSG91", category: "Communicatie", description: "Sms versturen", color: "#1d7bff",
    website: "https://msg91.com", docs: "https://docs.msg91.com",
    baseUrl: "https://control.msg91.com/api/v5", auth: { type: "apiKey", in: "header", name: "authkey", label: "Auth key" },
    operations: [{ id: "flow.send", resource: "Sms", label: "Sms via flow/template", method: "POST", path: "/flow", body: { template_id: "{{templateId}}", short_url: "0", recipients: "{{recipients}}" },
      params: [P("templateId", "Template-ID", { required: true }), json("recipients", "Ontvangers met variabelen", { required: true, placeholder: '[{"mobiles":"919999999999","var":"waarde"}]' })] }]
  },
  {
    id: "mocean", name: "Mocean", category: "Communicatie", description: "Sms en spraakberichten", color: "#2b4c9b",
    website: "https://moceanapi.com", docs: "https://moceanapi.com/docs",
    baseUrl: "https://rest.moceanapi.com/rest/2", auth: { type: "headers", headers: {}, fields: [{ key: "apiKey", label: "API-key" }, { key: "apiSecret", label: "API-secret", secret: true }] },
    operations: [{ id: "sms.send", resource: "Sms", label: "Sms versturen", method: "POST", path: "/sms", bodyType: "form", body: { "mocean-api-key": "{{apiKey}}", "mocean-api-secret": "{{apiSecret}}", "mocean-from": "{{from}}", "mocean-to": "{{to}}", "mocean-text": "{{text}}", "mocean-resp-format": "json" },
      params: [P("from", "Van", { required: true }), P("to", "Naar", { required: true }), P("text", "Tekst", { required: true })] }]
  }
];
