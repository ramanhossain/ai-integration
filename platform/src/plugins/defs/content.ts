import type { PluginDef } from "../types";
import { P, bool, json, num, path, q, urlField } from "./_shared";

// Batch 3: communicatie, content/CMS, no-code apps, AI en overig.

export const CONTENT: PluginDef[] = [
  // ---------------------------------------------------------------- communicatie
  { id: "line", name: "Line", category: "Communicatie", description: "Berichten via de LINE Messaging API (LINE Notify is gestopt)", color: "#06c755", website: "https://developers.line.biz", docs: "https://developers.line.biz/en/reference/messaging-api/",
    baseUrl: "https://api.line.me/v2/bot", auth: { type: "bearer", label: "Channel access token", help: "LINE Developers Console → Messaging API-kanaal → Channel access token (long-lived)." }, test: "info",
    operations: [
      { id: "push", resource: "Bericht", label: "Bericht sturen (push)", method: "POST", path: "/message/push", body: { to: "{{to}}", messages: [{ type: "text", text: "{{text}}" }] }, params: [P("to", "Gebruikers-/groeps-ID", { required: true }), P("text", "Tekst", { type: "text", required: true })] },
      { id: "reply", resource: "Bericht", label: "Antwoorden (reply token)", method: "POST", path: "/message/reply", body: { replyToken: "{{replyToken}}", messages: [{ type: "text", text: "{{text}}" }] }, params: [P("replyToken", "Reply token", { required: true }), P("text", "Tekst", { type: "text", required: true })] },
      { id: "multicast", resource: "Bericht", label: "Naar meerdere gebruikers", method: "POST", path: "/message/multicast", body: { to: "{{to}}", messages: [{ type: "text", text: "{{text}}" }] }, params: [P("to", "Gebruikers-ID's", { required: true, format: "list" }), P("text", "Tekst", { type: "text", required: true })] },
      { id: "broadcast", resource: "Bericht", label: "Naar alle volgers", method: "POST", path: "/message/broadcast", body: { messages: [{ type: "text", text: "{{text}}" }] }, params: [P("text", "Tekst", { type: "text", required: true })] },
      { id: "messages", resource: "Bericht", label: "Eigen berichtobjecten sturen", method: "POST", path: "/message/push", params: [P("to", "Ontvanger-ID", { required: true }), json("messages", "Berichten", { required: true, placeholder: '[{"type":"sticker","packageId":"446","stickerId":"1988"}]' })] },
      { id: "profile", resource: "Gebruiker", label: "Profiel ophalen", method: "GET", path: "/profile/{{userId}}", params: [path("userId", "Gebruikers-ID")] },
      { id: "quota", resource: "Account", label: "Verbruik deze maand", method: "GET", path: "/message/quota/consumption" },
      { id: "info", resource: "Account", label: "Botinformatie", method: "GET", path: "/info" }
    ] },
  { id: "matrix", name: "Matrix", category: "Communicatie", description: "Berichten en ruimtes (Element, Synapse, …)", color: "#0dbd8b", website: "https://matrix.org", docs: "https://spec.matrix.org/latest/client-server-api/",
    baseUrl: "{{url}}/_matrix/client/v3", fields: [{ key: "url", label: "Homeserver", default: "https://matrix-client.matrix.org", placeholder: "https://matrix.bedrijf.nl" }],
    auth: { type: "bearer", label: "Access token", help: "Element → Instellingen → Help & Info → Access token (of via /login voor een botaccount)." }, test: "whoami",
    operations: [
      { id: "message.send", resource: "Bericht", label: "Bericht sturen", method: "PUT", path: "/rooms/{{roomId}}/send/m.room.message/{{$uuid}}", body: { msgtype: "{{msgtype}}", body: "{{text}}" },
        params: [path("roomId", "Ruimte-ID", { placeholder: "!abc123:matrix.org" }), P("text", "Tekst", { type: "text", required: true }), P("msgtype", "Soort", { options: ["m.text", "m.notice", "m.emote"], default: "m.text" })] },
      { id: "message.html", resource: "Bericht", label: "Opgemaakt bericht (HTML)", method: "PUT", path: "/rooms/{{roomId}}/send/m.room.message/{{$uuid}}", body: { msgtype: "m.text", body: "{{text}}", format: "org.matrix.custom.html", formatted_body: "{{html}}" },
        params: [path("roomId", "Ruimte-ID"), P("html", "HTML", { type: "text", required: true }), P("text", "Platte tekst (terugval)", { type: "text", required: true })] },
      { id: "room.create", resource: "Ruimte", label: "Ruimte maken", method: "POST", path: "/createRoom", params: [P("name", "Naam", { required: true }), P("topic", "Onderwerp"), P("preset", "Type", { options: ["private_chat", "public_chat", "trusted_private_chat"], default: "private_chat" }), P("invite", "Uitnodigen (gebruikers-ID's)", { format: "list" }), P("room_alias_name", "Alias")] },
      { id: "room.join", resource: "Ruimte", label: "Ruimte binnengaan", method: "POST", path: "/join/{{room}}", params: [path("room", "Ruimte-ID of alias")] },
      { id: "room.leave", resource: "Ruimte", label: "Ruimte verlaten", method: "POST", path: "/rooms/{{roomId}}/leave", params: [path("roomId", "Ruimte-ID")] },
      { id: "room.invite", resource: "Ruimte", label: "Gebruiker uitnodigen", method: "POST", path: "/rooms/{{roomId}}/invite", params: [path("roomId", "Ruimte-ID"), P("user_id", "Gebruiker", { required: true, placeholder: "@jan:matrix.org" })] },
      { id: "room.kick", resource: "Ruimte", label: "Gebruiker verwijderen", method: "POST", path: "/rooms/{{roomId}}/kick", params: [path("roomId", "Ruimte-ID"), P("user_id", "Gebruiker", { required: true }), P("reason", "Reden")] },
      { id: "room.messages", resource: "Ruimte", label: "Laatste berichten", method: "GET", path: "/rooms/{{roomId}}/messages", output: "chunk", params: [path("roomId", "Ruimte-ID"), q("dir", "Richting", { default: "b" }), q("limit", "Aantal", { default: "20" })] },
      { id: "room.members", resource: "Ruimte", label: "Leden", method: "GET", path: "/rooms/{{roomId}}/joined_members", output: "joined", params: [path("roomId", "Ruimte-ID")] },
      { id: "rooms", resource: "Ruimte", label: "Mijn ruimtes", method: "GET", path: "/joined_rooms", output: "joined_rooms" },
      { id: "whoami", resource: "Account", label: "Wie ben ik", method: "GET", path: "/account/whoami" }
    ] },
  { id: "mandrill", name: "Mandrill", category: "Communicatie", description: "Transactionele e-mail (Mailchimp Transactional)", color: "#c02539", website: "https://mailchimp.com/features/transactional-email/", docs: "https://mailchimp.com/developer/transactional/api/",
    baseUrl: "https://mandrillapp.com/api/1.0", auth: { type: "headers", headers: {}, fields: [{ key: "apiKey", label: "API-key", secret: true }], help: "Mailchimp Transactional → Settings → API keys." }, test: "ping",
    operations: [
      { id: "send", resource: "Bericht", label: "E-mail versturen", method: "POST", path: "/messages/send",
        body: { key: "{{apiKey}}", message: { subject: "{{subject}}", html: "{{html}}", text: "{{text}}", from_email: "{{fromEmail}}", from_name: "{{fromName}}", to: [{ email: "{{to}}", name: "{{toName}}", type: "to" }], tags: "{{tags}}", track_opens: true, track_clicks: true }, async: false },
        params: [P("to", "Aan", { required: true }), P("toName", "Naam ontvanger"), P("subject", "Onderwerp", { required: true }), P("html", "HTML", { type: "text" }), P("text", "Platte tekst", { type: "text" }), P("fromEmail", "Van (adres)", { required: true }), P("fromName", "Van (naam)"), P("tags", "Tags", { format: "list" })] },
      { id: "sendTemplate", resource: "Bericht", label: "Template versturen", method: "POST", path: "/messages/send-template",
        body: { key: "{{apiKey}}", template_name: "{{template}}", template_content: [], message: { to: [{ email: "{{to}}", type: "to" }], subject: "{{subject}}", from_email: "{{fromEmail}}", global_merge_vars: "{{mergeVars}}", merge_language: "handlebars" } },
        params: [P("template", "Templatenaam", { required: true }), P("to", "Aan", { required: true }), P("subject", "Onderwerp"), P("fromEmail", "Van (adres)"), json("mergeVars", "Variabelen", { placeholder: '[{"name":"voornaam","content":"Jan"}]' })] },
      { id: "search", resource: "Bericht", label: "Verzonden berichten zoeken", method: "POST", path: "/messages/search", body: { key: "{{apiKey}}", query: "{{query}}", date_from: "{{from}}", date_to: "{{to}}", limit: "{{limit}}" }, params: [P("query", "Zoekopdracht", { placeholder: "email:jan@example.nl" }), P("from", "Vanaf (JJJJ-MM-DD)"), P("to", "Tot"), num("limit", "Aantal", { default: 100 })] },
      { id: "info", resource: "Bericht", label: "Bericht-info", method: "POST", path: "/messages/info", body: { key: "{{apiKey}}", id: "{{id}}" }, params: [P("id", "Bericht-ID", { required: true })] },
      { id: "templates", resource: "Template", label: "Templates", method: "POST", path: "/templates/list", body: { key: "{{apiKey}}" } },
      { id: "ping", resource: "Account", label: "Verbinding testen", method: "POST", path: "/users/ping2", body: { key: "{{apiKey}}" } }
    ] },
  { id: "messagebird", name: "MessageBird (Bird)", category: "Communicatie", description: "Sms versturen en saldo (MessageBird REST API)", color: "#2481d7", website: "https://bird.com", docs: "https://developers.messagebird.com/api/sms-messaging/",
    baseUrl: "https://rest.messagebird.com", auth: { type: "apiKey", in: "header", name: "Authorization", prefix: "AccessKey ", label: "Live access key" }, test: "balance",
    operations: [
      { id: "sms.send", resource: "Sms", label: "Sms versturen", method: "POST", path: "/messages", params: [P("originator", "Afzender", { required: true, placeholder: "Bedrijf of +31…" }), P("recipients", "Ontvangers", { required: true, format: "list" }), P("body", "Tekst", { type: "text", required: true }), P("reference", "Referentie"), P("scheduledDatetime", "Gepland (ISO)")] },
      { id: "sms.get", resource: "Sms", label: "Sms-status", method: "GET", path: "/messages/{{id}}", params: [path("id", "Bericht-ID")] },
      { id: "sms.list", resource: "Sms", label: "Verzonden sms'en", method: "GET", path: "/messages", output: "items", params: [q("limit", "Aantal", { default: "20" }), q("status", "Status")] },
      { id: "lookup", resource: "Nummer", label: "Nummer opzoeken", method: "GET", path: "/lookup/{{number}}", params: [path("number", "Telefoonnummer"), q("countryCode", "Landcode", { default: "NL" })] },
      { id: "balance", resource: "Account", label: "Saldo", method: "GET", path: "/balance" }
    ] },
  { id: "pushcut", name: "Pushcut", category: "Communicatie", description: "iOS-notificaties en automatiseringen", color: "#ff375f", website: "https://pushcut.io", docs: "https://www.pushcut.io/webapi",
    baseUrl: "https://api.pushcut.io/v1", auth: { type: "apiKey", in: "header", name: "API-Key", label: "API-key" }, test: "devices",
    operations: [
      { id: "notify", resource: "Notificatie", label: "Notificatie sturen", method: "POST", path: "/notifications/{{name}}", params: [path("name", "Notificatienaam"), P("title", "Titel"), P("text", "Tekst"), P("input", "Invoer (voor acties)"), P("devices", "Apparaten", { format: "list" }), P("defaultAction", "Standaardactie (JSON)", { type: "json" })] },
      { id: "notifications", resource: "Notificatie", label: "Notificaties", method: "GET", path: "/notifications" },
      { id: "execute", resource: "Automatisering", label: "Shortcut/HomeKit uitvoeren", method: "POST", path: "/execute", params: [q("shortcut", "Shortcut"), q("homekit", "HomeKit-scène"), q("timeout", "Time-out"), P("input", "Invoer")] },
      { id: "devices", resource: "Apparaat", label: "Apparaten", method: "GET", path: "/devices" }
    ] },
  { id: "twist", name: "Twist", category: "Communicatie", description: "Kanalen, threads, reacties en berichten", color: "#18a4b6", website: "https://twist.com", docs: "https://developer.twist.com/v3/",
    baseUrl: "https://api.twist.com/api/v3", auth: { type: "oauth2", authUrl: "https://twist.com/oauth/authorize", tokenUrl: "https://twist.com/oauth/access_token", scopes: ["user:read", "workspaces:read", "channels:read", "threads:read", "threads:write", "comments:write", "messages:write"], scopeSeparator: ",", help: "Maak een integratie in Twist → Settings → Integrations → Build, met de redirect-URI hieronder." }, test: "workspaces",
    operations: [
      { id: "workspaces", resource: "Werkruimte", label: "Werkruimtes", method: "GET", path: "/workspaces/get" },
      { id: "channel.list", resource: "Kanaal", label: "Kanalen", method: "GET", path: "/channels/get", params: [q("workspace_id", "Werkruimte-ID", { required: true })] },
      { id: "channel.create", resource: "Kanaal", label: "Kanaal maken", method: "POST", path: "/channels/add", params: [num("workspace_id", "Werkruimte-ID", { required: true }), P("name", "Naam", { required: true }), P("description", "Omschrijving"), P("user_ids", "Leden (ID's)", { format: "list", type: "number" })] },
      { id: "thread.create", resource: "Thread", label: "Thread starten", method: "POST", path: "/threads/add", params: [num("channel_id", "Kanaal-ID", { required: true }), P("title", "Titel", { required: true }), P("content", "Tekst", { type: "text", required: true }), P("recipients", "Melden aan (ID's)", { format: "list", type: "number" })] },
      { id: "thread.list", resource: "Thread", label: "Threads", method: "GET", path: "/threads/get", params: [q("channel_id", "Kanaal-ID", { required: true }), q("limit", "Aantal")] },
      { id: "comment.create", resource: "Reactie", label: "Reactie plaatsen", method: "POST", path: "/comments/add", params: [num("thread_id", "Thread-ID", { required: true }), P("content", "Tekst", { type: "text", required: true })] },
      { id: "message.send", resource: "Bericht", label: "Direct bericht", method: "POST", path: "/conversation_messages/add", params: [num("conversation_id", "Gesprek-ID", { required: true }), P("content", "Tekst", { type: "text", required: true })] },
      { id: "conversation.list", resource: "Bericht", label: "Gesprekken", method: "GET", path: "/conversations/get", params: [q("workspace_id", "Werkruimte-ID", { required: true })] }
    ] },
  { id: "disqus", name: "Disqus", category: "Social media", description: "Fora, threads en reacties", color: "#2e9fff", website: "https://disqus.com", docs: "https://disqus.com/api/docs/",
    baseUrl: "https://disqus.com/api/3.0", auth: { type: "query", query: { api_key: "{{apiKey}}", access_token: "{{accessToken}}" }, fields: [{ key: "apiKey", label: "Public API-key", secret: true }, { key: "accessToken", label: "Access token (voor schrijven)", secret: true }], help: "disqus.com/api/applications → applicatie → API Key en Access Token." }, test: "forum.list",
    operations: [
      { id: "forum.get", resource: "Forum", label: "Forum ophalen", method: "GET", path: "/forums/details.json", output: "response", params: [q("forum", "Forum (shortname)", { required: true })] },
      { id: "forum.posts", resource: "Forum", label: "Reacties in forum", method: "GET", path: "/forums/listPosts.json", output: "response", params: [q("forum", "Forum", { required: true }), q("limit", "Aantal", { default: "25" }), q("since", "Sinds (ISO/unix)"), q("order", "Volgorde", { options: ["desc", "asc"] })] },
      { id: "forum.threads", resource: "Forum", label: "Threads in forum", method: "GET", path: "/forums/listThreads.json", output: "response", params: [q("forum", "Forum", { required: true }), q("limit", "Aantal", { default: "25" })] },
      { id: "forum.list", resource: "Forum", label: "Mijn fora", method: "GET", path: "/users/listForums.json", output: "response" },
      { id: "thread.get", resource: "Thread", label: "Thread ophalen", method: "GET", path: "/threads/details.json", output: "response", params: [q("thread", "Thread-ID", { required: true })] },
      { id: "post.get", resource: "Reactie", label: "Reactie ophalen", method: "GET", path: "/posts/details.json", output: "response", params: [q("post", "Reactie-ID", { required: true })] },
      { id: "post.create", resource: "Reactie", label: "Reactie plaatsen", method: "POST", path: "/posts/create.json", bodyType: "form", output: "response", params: [P("thread", "Thread-ID", { required: true }), P("message", "Tekst", { type: "text", required: true }), P("parent", "Antwoord op (reactie-ID)")] },
      { id: "post.remove", resource: "Reactie", label: "Reactie verwijderen", method: "POST", path: "/posts/remove.json", bodyType: "form", output: "response", params: [P("post", "Reactie-ID", { required: true })] }
    ] },

  { id: "twake", name: "Twake", category: "Communicatie", description: "Berichten in Twake-kanalen versturen en verwijderen (Linagora)", color: "#3a6ff7", website: "https://twake.app", docs: "https://doc.twake.app/developers-api/",
    baseUrl: "{{url}}/api/v1", fields: [{ key: "url", label: "API-adres", default: "https://api.twake.app", placeholder: "https://api.twake.app of eigen server" }],
    auth: { type: "basic", userLabel: "Public ID van de applicatie", passLabel: "Private API-key", help: "Twake → Company settings → Applications → eigen applicatie met schrijfrecht message_save." },
    operations: [
      { id: "message.send", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "/messages/save", output: "result", body: { group_id: "{{groupId}}", message: { channel_id: "{{channelId}}", content: "{{content}}", parent_message_id: "{{parentId}}" } },
        params: [P("groupId", "Company-ID (group_id)", { required: true }), P("channelId", "Kanaal-ID", { required: true }), P("content", "Tekst", { type: "text", required: true }), P("parentId", "Antwoord op bericht-ID")] },
      { id: "message.delete", resource: "Bericht", label: "Bericht verwijderen", method: "POST", path: "/messages/remove", output: "result", body: { group_id: "{{groupId}}", message: { channel_id: "{{channelId}}", id: "{{id}}" } },
        params: [P("groupId", "Company-ID (group_id)", { required: true }), P("channelId", "Kanaal-ID", { required: true }), P("id", "Bericht-ID", { required: true })] }
    ] },

  // ---------------------------------------------------------------- content en CMS
  { id: "ghost", name: "Ghost", category: "Content & CMS", description: "Posts, pagina's en leden op Ghost (Admin API)", color: "#15171a", website: "https://ghost.org", docs: "https://ghost.org/docs/admin-api/",
    baseUrl: "{{url}}/ghost/api/admin", fields: [urlField("Adres van je site", "https://blog.bedrijf.nl")],
    auth: { type: "custom", signer: "ghost", fields: [{ key: "adminKey", label: "Admin API-key", secret: true, placeholder: "id:secret" }], help: "Ghost Admin → Settings → Integrations → Add custom integration → Admin API key." }, test: "site",
    operations: [
      { id: "post.list", resource: "Post", label: "Posts", method: "GET", path: "/posts/", output: "posts", params: [q("limit", "Aantal", { default: "15" }), q("filter", "Filter", { placeholder: "status:published+tag:nieuws" }), q("fields", "Velden"), q("formats", "Formaten", { placeholder: "html" })] },
      { id: "post.get", resource: "Post", label: "Post ophalen", method: "GET", path: "/posts/{{id}}/", output: "posts.0", params: [path("id", "Post-ID"), q("formats", "Formaten", { default: "html" })] },
      { id: "post.create", resource: "Post", label: "Post maken", method: "POST", path: "/posts/?source=html", output: "posts.0", body: { posts: [{ title: "{{title}}", html: "{{html}}", status: "{{status}}", tags: "{{tags}}", excerpt: "{{excerpt}}", feature_image: "{{image}}", published_at: "{{publishedAt}}" }] },
        params: [P("title", "Titel", { required: true }), P("html", "Inhoud (HTML)", { type: "text" }), P("status", "Status", { options: ["draft", "published", "scheduled"], default: "draft" }), P("tags", "Tags", { format: "list" }), P("excerpt", "Samenvatting"), P("image", "Uitgelichte afbeelding (URL)"), P("publishedAt", "Publicatiedatum (ISO)")] },
      { id: "post.update", resource: "Post", label: "Post bijwerken", method: "PUT", path: "/posts/{{id}}/?source=html", output: "posts.0", body: { posts: [{ updated_at: "{{updatedAt}}", title: "{{title}}", html: "{{html}}", status: "{{status}}" }] },
        params: [path("id", "Post-ID"), P("updatedAt", "updated_at (huidige waarde)", { required: true, help: "Ghost vereist de huidige updated_at om conflicten te voorkomen." }), P("title", "Titel"), P("html", "Inhoud (HTML)", { type: "text" }), P("status", "Status", { options: ["draft", "published"] })] },
      { id: "post.delete", resource: "Post", label: "Post verwijderen", method: "DELETE", path: "/posts/{{id}}/", params: [path("id", "Post-ID")] },
      { id: "page.list", resource: "Pagina", label: "Pagina's", method: "GET", path: "/pages/", output: "pages", params: [q("limit", "Aantal", { default: "15" })] },
      { id: "member.list", resource: "Lid", label: "Leden", method: "GET", path: "/members/", output: "members", params: [q("filter", "Filter", { placeholder: "status:paid" }), q("limit", "Aantal", { default: "15" })] },
      { id: "member.create", resource: "Lid", label: "Lid toevoegen", method: "POST", path: "/members/", output: "members.0", body: { members: [{ email: "{{email}}", name: "{{name}}", note: "{{note}}", labels: "{{labels}}" }] }, params: [P("email", "E-mail", { required: true }), P("name", "Naam"), P("note", "Notitie"), P("labels", "Labels", { format: "list" })] },
      { id: "site", resource: "Site", label: "Site-info", method: "GET", path: "/site/", output: "site" }
    ] },
  { id: "medium", name: "Medium", category: "Content & CMS", description: "Posts publiceren (ook in publicaties)", color: "#000000", website: "https://medium.com", docs: "https://github.com/Medium/medium-api-docs",
    baseUrl: "https://api.medium.com/v1", auth: { type: "bearer", label: "Integration token", help: "Medium → Settings → Security and apps → Integration tokens (alleen bestaande tokens; Medium geeft geen nieuwe meer uit)." }, test: "me",
    operations: [
      { id: "post.create", resource: "Post", label: "Post publiceren", method: "POST", path: "/users/{{authorId}}/posts", output: "data",
        params: [path("authorId", "Auteur-ID (zie 'Mijn account')"), P("title", "Titel", { required: true }), P("contentFormat", "Formaat", { options: ["html", "markdown"], default: "html" }), P("content", "Inhoud", { type: "text", required: true }), P("tags", "Tags (max. 5)", { format: "list" }), P("canonicalUrl", "Canonieke URL"), P("publishStatus", "Status", { options: ["public", "draft", "unlisted"], default: "draft" }), P("license", "Licentie")] },
      { id: "publication.post", resource: "Post", label: "Post in publicatie", method: "POST", path: "/publications/{{publicationId}}/posts", output: "data",
        params: [path("publicationId", "Publicatie-ID"), P("title", "Titel", { required: true }), P("contentFormat", "Formaat", { options: ["html", "markdown"], default: "html" }), P("content", "Inhoud", { type: "text", required: true }), P("tags", "Tags", { format: "list" }), P("publishStatus", "Status", { options: ["public", "draft", "unlisted"], default: "draft" })] },
      { id: "publications", resource: "Publicatie", label: "Mijn publicaties", method: "GET", path: "/users/{{userId}}/publications", output: "data", params: [path("userId", "Gebruikers-ID")] },
      { id: "me", resource: "Account", label: "Mijn account", method: "GET", path: "/me", output: "data" }
    ] },
  { id: "cockpit", name: "Cockpit", category: "Content & CMS", description: "Collecties en singletons (headless CMS, v2)", color: "#1e293b", website: "https://getcockpit.com", docs: "https://getcockpit.com/documentation/core/api/content",
    baseUrl: "{{url}}/api", fields: [urlField("Adres", "https://cms.bedrijf.nl")], auth: { type: "apiKey", in: "header", name: "api-key", label: "API-key" },
    operations: [
      { id: "items.list", resource: "Item", label: "Items van een model", method: "GET", path: "/content/items/{{model}}", params: [path("model", "Model"), q("filter", "Filter (JSON)", { placeholder: '{"published":true}' }), q("sort", "Sortering (JSON)", { placeholder: '{"_created":-1}' }), q("limit", "Aantal"), q("skip", "Overslaan"), q("locale", "Taal"), q("populate", "Koppelingen laden", { placeholder: "1" })] },
      { id: "item.get", resource: "Item", label: "Item ophalen", method: "GET", path: "/content/item/{{model}}/{{id}}", params: [path("model", "Model"), path("id", "Item-ID"), q("locale", "Taal")] },
      { id: "item.save", resource: "Item", label: "Item opslaan (maken/bijwerken)", method: "POST", path: "/content/item/{{model}}", body: { data: "{{data}}" }, params: [path("model", "Model"), json("data", "Velden (met _id om bij te werken)", { required: true, placeholder: '{"title":"Hallo"}' })] },
      { id: "item.delete", resource: "Item", label: "Item verwijderen", method: "DELETE", path: "/content/item/{{model}}/{{id}}", params: [path("model", "Model"), path("id", "Item-ID")] },
      { id: "singleton.get", resource: "Singleton", label: "Singleton ophalen", method: "GET", path: "/content/item/{{model}}", params: [path("model", "Singleton"), q("locale", "Taal")] },
      { id: "tree", resource: "Item", label: "Boomstructuur", method: "GET", path: "/content/tree/{{model}}", params: [path("model", "Model")] }
    ] },

  // ---------------------------------------------------------------- no-code apps
  { id: "bubble", name: "Bubble", category: "Ontwikkeling", description: "Objecten en backend-workflows in Bubble-apps (Data API)", color: "#0205d3", website: "https://bubble.io", docs: "https://manual.bubble.io/core-resources/api/the-bubble-api",
    baseUrl: "{{url}}/api/1.1", fields: [{ key: "url", label: "App-adres", placeholder: "https://app.bubbleapps.io (of …/version-test voor development)" }], auth: { type: "bearer", label: "API-token", help: "Bubble → Settings → API: Data API aanzetten en een API-token maken." },
    operations: [
      { id: "object.list", resource: "Object", label: "Objecten zoeken", method: "GET", path: "/obj/{{type}}", output: "response.results", params: [path("type", "Datatype"), q("constraints", "Voorwaarden (JSON)", { placeholder: '[{"key":"status","constraint_type":"equals","value":"open"}]' }), q("limit", "Aantal", { default: "100" }), q("cursor", "Vanaf"), q("sort_field", "Sorteren op"), q("descending", "Aflopend")] },
      { id: "object.get", resource: "Object", label: "Object ophalen", method: "GET", path: "/obj/{{type}}/{{id}}", output: "response", params: [path("type", "Datatype"), path("id", "Object-ID")] },
      { id: "object.create", resource: "Object", label: "Object maken", method: "POST", path: "/obj/{{type}}", bodyParam: "fields", params: [path("type", "Datatype"), json("fields", "Velden", { required: true })] },
      { id: "object.update", resource: "Object", label: "Object bijwerken", method: "PATCH", path: "/obj/{{type}}/{{id}}", bodyParam: "fields", params: [path("type", "Datatype"), path("id", "Object-ID"), json("fields", "Velden", { required: true })] },
      { id: "object.delete", resource: "Object", label: "Object verwijderen", method: "DELETE", path: "/obj/{{type}}/{{id}}", params: [path("type", "Datatype"), path("id", "Object-ID")] },
      { id: "workflow.run", resource: "Workflow", label: "Backend-workflow starten", method: "POST", path: "/wf/{{workflow}}", bodyParam: "params", params: [path("workflow", "Workflow"), json("params", "Parameters", { default: {} })] }
    ] },
  { id: "adalo", name: "Adalo", category: "Ontwikkeling", description: "Collecties in Adalo-apps lezen en schrijven", color: "#6c47ff", website: "https://adalo.com", docs: "https://help.adalo.com/integrations/the-adalo-api",
    baseUrl: "https://api.adalo.com/v0/apps/{{appId}}", fields: [{ key: "appId", label: "App-ID" }], auth: { type: "bearer", label: "API-key", help: "Adalo → App settings → App Access → API-key (Team-plan of hoger)." },
    operations: [
      { id: "record.list", resource: "Record", label: "Records", method: "GET", path: "/collections/{{collectionId}}", output: "records", params: [path("collectionId", "Collectie-ID"), q("offset", "Vanaf"), q("limit", "Aantal", { default: "100" }), q("filterKey", "Filterveld"), q("filterValue", "Filterwaarde")] },
      { id: "record.get", resource: "Record", label: "Record ophalen", method: "GET", path: "/collections/{{collectionId}}/{{id}}", params: [path("collectionId", "Collectie-ID"), path("id", "Record-ID")] },
      { id: "record.create", resource: "Record", label: "Record maken", method: "POST", path: "/collections/{{collectionId}}", bodyParam: "fields", params: [path("collectionId", "Collectie-ID"), json("fields", "Velden", { required: true })] },
      { id: "record.update", resource: "Record", label: "Record bijwerken", method: "PUT", path: "/collections/{{collectionId}}/{{id}}", bodyParam: "fields", params: [path("collectionId", "Collectie-ID"), path("id", "Record-ID"), json("fields", "Velden", { required: true })] },
      { id: "record.delete", resource: "Record", label: "Record verwijderen", method: "DELETE", path: "/collections/{{collectionId}}/{{id}}", params: [path("collectionId", "Collectie-ID"), path("id", "Record-ID")] }
    ] },

  // ---------------------------------------------------------------- AI en overig
  { id: "airtop", name: "Airtop", category: "AI", description: "Cloud-browsers voor AI-agents: sessies, vensters, pagina-vragen en acties", color: "#111111", website: "https://airtop.ai", docs: "https://docs.airtop.ai/api-reference/airtop-api",
    baseUrl: "https://api.airtop.ai/api/v1", auth: { type: "bearer", label: "API-key" }, test: "session.list",
    operations: [
      { id: "session.create", resource: "Sessie", label: "Sessie starten", method: "POST", path: "/sessions", output: "data", body: { configuration: { timeoutMinutes: "{{timeout}}", profileName: "{{profile}}" } }, params: [num("timeout", "Time-out (min)", { default: 10 }), P("profile", "Profiel (ingelogde staat)")] },
      { id: "session.list", resource: "Sessie", label: "Sessies", method: "GET", path: "/sessions", output: "data" },
      { id: "session.get", resource: "Sessie", label: "Sessie-info", method: "GET", path: "/sessions/{{sessionId}}", output: "data", params: [path("sessionId", "Sessie-ID")] },
      { id: "session.end", resource: "Sessie", label: "Sessie beëindigen", method: "DELETE", path: "/sessions/{{sessionId}}", params: [path("sessionId", "Sessie-ID")] },
      { id: "window.create", resource: "Venster", label: "Venster openen", method: "POST", path: "/sessions/{{sessionId}}/windows", output: "data", params: [path("sessionId", "Sessie-ID"), P("url", "URL", { required: true })] },
      { id: "window.load", resource: "Venster", label: "URL laden", method: "POST", path: "/sessions/{{sessionId}}/windows/{{windowId}}", params: [path("sessionId", "Sessie-ID"), path("windowId", "Venster-ID"), P("url", "URL", { required: true })] },
      { id: "window.query", resource: "Venster", label: "Vraag over de pagina (AI)", method: "POST", path: "/sessions/{{sessionId}}/windows/{{windowId}}/page-query", output: "data", params: [path("sessionId", "Sessie-ID"), path("windowId", "Venster-ID"), P("prompt", "Vraag", { type: "text", required: true, placeholder: "Wat is de prijs van het product?" })] },
      { id: "window.scrape", resource: "Venster", label: "Pagina-inhoud ophalen", method: "POST", path: "/sessions/{{sessionId}}/windows/{{windowId}}/scrape-content", output: "data", params: [path("sessionId", "Sessie-ID"), path("windowId", "Venster-ID")] },
      { id: "window.click", resource: "Venster", label: "Klikken (beschrijving)", method: "POST", path: "/sessions/{{sessionId}}/windows/{{windowId}}/click", output: "data", params: [path("sessionId", "Sessie-ID"), path("windowId", "Venster-ID"), P("elementDescription", "Element", { required: true, placeholder: "de knop 'Inloggen'" })] },
      { id: "window.type", resource: "Venster", label: "Typen", method: "POST", path: "/sessions/{{sessionId}}/windows/{{windowId}}/type", output: "data", params: [path("sessionId", "Sessie-ID"), path("windowId", "Venster-ID"), P("text", "Tekst", { required: true }), P("elementDescription", "In element"), bool("pressEnterKey", "Enter drukken")] },
      { id: "window.screenshot", resource: "Venster", label: "Screenshot", method: "POST", path: "/sessions/{{sessionId}}/windows/{{windowId}}/screenshot", output: "data", params: [path("sessionId", "Sessie-ID"), path("windowId", "Venster-ID")] },
      { id: "window.close", resource: "Venster", label: "Venster sluiten", method: "DELETE", path: "/sessions/{{sessionId}}/windows/{{windowId}}", params: [path("sessionId", "Sessie-ID"), path("windowId", "Venster-ID")] }
    ] },
  { id: "lingvanex", name: "LingvaNex", category: "AI", description: "Tekst vertalen (100+ talen)", color: "#ef4444", website: "https://lingvanex.com", docs: "https://lingvanex.com/products/translationapi/",
    baseUrl: "https://api-b2b.backenster.com/b1/api/v3", auth: { type: "apiKey", in: "header", name: "Authorization", label: "API-key", help: "Vul de key in precies zoals in je Lingvanex-account staat (inclusief 'Bearer ' als die erbij staat)." }, test: "languages",
    operations: [
      { id: "translate", resource: "Vertaling", label: "Tekst vertalen", method: "POST", path: "/translate", output: "result", body: { platform: "api", from: "{{from}}", to: "{{to}}", data: "{{text}}", translateMode: "{{mode}}", enableTransliteration: false },
        params: [P("text", "Tekst", { type: "text", required: true }), P("to", "Naar (bv. en_GB, de_DE)", { required: true, default: "en_GB" }), P("from", "Van (leeg = automatisch)"), P("mode", "Modus", { options: ["", "html"] })] },
      { id: "languages", resource: "Taal", label: "Talen", method: "GET", path: "/getLanguages", output: "result", params: [q("platform", "Platform", { default: "api" }), q("code", "Weergavetaal", { default: "nl_NL" })] }
    ] },
  { id: "openthesaurus", name: "OpenThesaurus", category: "Overig", description: "Synoniemen zoeken (Duits)", color: "#5b8c2a", website: "https://www.openthesaurus.de", docs: "https://www.openthesaurus.de/about/api",
    baseUrl: "https://www.openthesaurus.de", auth: { type: "none" },
    operations: [
      { id: "synonyms", resource: "Synoniem", label: "Synoniemen zoeken", method: "GET", path: "/synonyme/search?format=application/json", output: "synsets", params: [q("q", "Woord", { required: true }), q("similar", "Vergelijkbare woorden", { options: ["", "true"] }), q("substring", "Deelwoorden", { options: ["", "true"] }), q("baseform", "Grondvorm", { options: ["", "true"] })] }
    ] },
  { id: "philips-hue", name: "Philips Hue", category: "Overig", description: "Lampen, groepen en scènes (lokale bridge)", color: "#0065d3", website: "https://www.philips-hue.com", docs: "https://developers.meethue.com/develop/hue-api/",
    baseUrl: "{{url}}/api/{{username}}", auth: { type: "headers", headers: {}, fields: [urlField("Bridge-adres", "http://192.168.1.20"), { key: "username", label: "Gebruikersnaam (app-key)", secret: true, help: "Druk op de knop van de bridge en doe binnen 30 s POST /api met {\"devicetype\":\"aip#server\"}." }], help: "Werkt via een agent in het netwerk van de bridge (lokaal adres)." }, test: "config",
    operations: [
      { id: "light.list", resource: "Lamp", label: "Lampen", method: "GET", path: "/lights" },
      { id: "light.state", resource: "Lamp", label: "Lamp aan/uit/kleur", method: "PUT", path: "/lights/{{id}}/state", params: [path("id", "Lamp-ID"), bool("on", "Aan"), num("bri", "Helderheid (1-254)"), num("hue", "Kleur (0-65535)"), num("sat", "Verzadiging (0-254)"), num("ct", "Kleurtemperatuur (153-500)"), num("transitiontime", "Overgang (×100 ms)"), P("alert", "Knipperen", { options: ["", "select", "lselect"] })] },
      { id: "group.list", resource: "Groep", label: "Groepen/ruimtes", method: "GET", path: "/groups" },
      { id: "group.action", resource: "Groep", label: "Groep aansturen", method: "PUT", path: "/groups/{{id}}/action", params: [path("id", "Groep-ID (0 = alle)"), bool("on", "Aan"), num("bri", "Helderheid"), P("scene", "Scène-ID"), num("ct", "Kleurtemperatuur")] },
      { id: "scene.list", resource: "Scène", label: "Scènes", method: "GET", path: "/scenes" },
      { id: "config", resource: "Bridge", label: "Bridge-configuratie", method: "GET", path: "/config" }
    ] }
];
