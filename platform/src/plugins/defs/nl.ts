import type { FieldDef, PluginDef } from "../types";
import { P, json, path, q, urlField } from "./_shared";

// Nederlandse overheid (Common Ground / ZGW, Haal Centraal, KvK) en Nederlandse bedrijfssoftware (Exact Online),
// plus Atlassian Confluence en Microsoft Dataverse.

// ZGW: één koppeling per component (Zaken, Documenten, Catalogi, Besluiten, Notificaties) met JWT-authenticatie.
const zgwAuth = { type: "custom" as const, signer: "zgw-jwt", help: "Client-ID en secret zoals geregistreerd in de autorisatiecomponent (bv. Open Zaak → API-autorisaties). Of vul alleen een vast token in.",
  fields: [{ key: "clientId", label: "Client-ID" }, { key: "secret", label: "Secret", secret: true }, { key: "userId", label: "Gebruikers-ID (optioneel)" }, { key: "token", label: "Of: vast token", secret: true, help: "Bv. voor Open Notificaties: 'Token abc…'" }] as FieldDef[] };
const zgwBase = (label: string, ph: string): FieldDef => ({ ...urlField(label, ph), key: "url" });

export const NL: PluginDef[] = [
  {
    id: "zgw-zaken", name: "ZGW Zaken API", category: "Overheid", description: "Zaken, statussen, rollen, zaakobjecten en zaakinformatieobjecten (Open Zaak, VNG-standaard)", color: "#154273",
    website: "https://vng-realisatie.github.io/gemma-zaken/", docs: "https://vng-realisatie.github.io/gemma-zaken/standaard/zaken/",
    baseUrl: "{{url}}", fields: [zgwBase("Basis-URL Zaken API", "https://openzaak.gemeente.nl/zaken/api/v1")], auth: zgwAuth, test: "zaak.list",
    operations: [
      { id: "zaak.list", resource: "Zaak", label: "Zaken zoeken", method: "GET", path: "/zaken", output: "results", params: [q("identificatie", "Identificatie"), q("bronorganisatie", "Bronorganisatie (RSIN)"), q("zaaktype", "Zaaktype (URL)"), q("rol__betrokkeneIdentificatie__natuurlijkPersoon__inpBsn", "BSN van betrokkene"), q("page", "Pagina")] },
      { id: "zaak.get", resource: "Zaak", label: "Zaak ophalen", method: "GET", path: "/zaken/{{uuid}}", params: [path("uuid", "UUID")] },
      { id: "zaak.create", resource: "Zaak", label: "Zaak aanmaken", method: "POST", path: "/zaken",
        params: [P("bronorganisatie", "Bronorganisatie (RSIN)", { required: true }), P("zaaktype", "Zaaktype (URL)", { required: true }), P("verantwoordelijkeOrganisatie", "Verantwoordelijke organisatie (RSIN)", { required: true }), P("startdatum", "Startdatum", { required: true, placeholder: "{{$date}}" }), P("omschrijving", "Omschrijving"), P("toelichting", "Toelichting", { type: "text" }), P("registratiedatum", "Registratiedatum"), json("zaakgeometrie", "Zaakgeometrie (GeoJSON)")] },
      { id: "zaak.update", resource: "Zaak", label: "Zaak deels bijwerken", method: "PATCH", path: "/zaken/{{uuid}}", params: [path("uuid", "UUID"), P("omschrijving", "Omschrijving"), P("toelichting", "Toelichting", { type: "text" }), P("einddatumGepland", "Geplande einddatum"), P("uiterlijkeEinddatumAfdoening", "Uiterlijke einddatum afdoening")] },
      { id: "zaak.delete", resource: "Zaak", label: "Zaak verwijderen", method: "DELETE", path: "/zaken/{{uuid}}", params: [path("uuid", "UUID")] },
      { id: "status.create", resource: "Status", label: "Status zetten", method: "POST", path: "/statussen", params: [P("zaak", "Zaak (URL)", { required: true }), P("statustype", "Statustype (URL)", { required: true }), P("datumStatusGezet", "Datum status gezet", { required: true, placeholder: "{{$now}}" }), P("statustoelichting", "Toelichting")] },
      { id: "status.list", resource: "Status", label: "Statussen van een zaak", method: "GET", path: "/statussen", output: "results", params: [q("zaak", "Zaak (URL)", { required: true })] },
      { id: "rol.create", resource: "Rol", label: "Rol (betrokkene) toevoegen", method: "POST", path: "/rollen", params: [P("zaak", "Zaak (URL)", { required: true }), P("roltype", "Roltype (URL)", { required: true }), P("betrokkeneType", "Type betrokkene", { required: true, options: ["natuurlijk_persoon", "niet_natuurlijk_persoon", "vestiging", "organisatorische_eenheid", "medewerker"] }), P("roltoelichting", "Toelichting", { required: true }), json("betrokkeneIdentificatie", "Identificatie betrokkene", { placeholder: '{"inpBsn":"999993653"}' })] },
      { id: "rol.list", resource: "Rol", label: "Rollen van een zaak", method: "GET", path: "/rollen", output: "results", params: [q("zaak", "Zaak (URL)", { required: true })] },
      { id: "zio.create", resource: "Document bij zaak", label: "Document aan zaak koppelen", method: "POST", path: "/zaakinformatieobjecten", params: [P("zaak", "Zaak (URL)", { required: true }), P("informatieobject", "Informatieobject (URL)", { required: true }), P("titel", "Titel")] },
      { id: "zio.list", resource: "Document bij zaak", label: "Documenten bij een zaak", method: "GET", path: "/zaakinformatieobjecten", params: [q("zaak", "Zaak (URL)", { required: true })] },
      { id: "zaakobject.create", resource: "Zaakobject", label: "Zaakobject toevoegen", method: "POST", path: "/zaakobjecten", params: [P("zaak", "Zaak (URL)", { required: true }), P("objectType", "Objecttype", { required: true, placeholder: "adres" }), P("object", "Object (URL)"), json("objectIdentificatie", "Objectidentificatie")] },
      { id: "resultaat.create", resource: "Resultaat", label: "Resultaat vastleggen", method: "POST", path: "/resultaten", params: [P("zaak", "Zaak (URL)", { required: true }), P("resultaattype", "Resultaattype (URL)", { required: true }), P("toelichting", "Toelichting")] }
    ]
  },
  {
    id: "zgw-documenten", name: "ZGW Documenten API", category: "Overheid", description: "Enkelvoudige informatieobjecten (documenten) opslaan, ophalen en downloaden", color: "#154273",
    website: "https://vng-realisatie.github.io/gemma-zaken/", docs: "https://vng-realisatie.github.io/gemma-zaken/standaard/documenten/",
    baseUrl: "{{url}}", fields: [zgwBase("Basis-URL Documenten API", "https://openzaak.gemeente.nl/documenten/api/v1")], auth: zgwAuth, test: "document.list",
    operations: [
      { id: "document.list", resource: "Document", label: "Documenten zoeken", method: "GET", path: "/enkelvoudiginformatieobjecten", output: "results", params: [q("identificatie", "Identificatie"), q("bronorganisatie", "Bronorganisatie"), q("page", "Pagina")] },
      { id: "document.get", resource: "Document", label: "Document ophalen", method: "GET", path: "/enkelvoudiginformatieobjecten/{{uuid}}", params: [path("uuid", "UUID")] },
      { id: "document.create", resource: "Document", label: "Document aanmaken (base64-inhoud)", method: "POST", path: "/enkelvoudiginformatieobjecten",
        params: [P("bronorganisatie", "Bronorganisatie (RSIN)", { required: true }), P("informatieobjecttype", "Informatieobjecttype (URL)", { required: true }), P("titel", "Titel", { required: true }), P("auteur", "Auteur", { required: true }), P("creatiedatum", "Creatiedatum", { required: true, placeholder: "{{$date}}" }), P("taal", "Taal (ISO 639-2/B)", { default: "nld" }), P("bestandsnaam", "Bestandsnaam"), P("formaat", "MIME-type", { placeholder: "application/pdf" }), P("inhoud", "Inhoud (base64)", { type: "text" }), P("vertrouwelijkheidaanduiding", "Vertrouwelijkheid", { options: ["openbaar", "beperkt_openbaar", "intern", "zaakvertrouwelijk", "vertrouwelijk", "confidentieel", "geheim", "zeer_geheim"] }), P("indicatieGebruiksrecht", "Indicatie gebruiksrecht", { type: "boolean" })] },
      { id: "document.update", resource: "Document", label: "Document deels bijwerken", method: "PATCH", path: "/enkelvoudiginformatieobjecten/{{uuid}}", params: [path("uuid", "UUID"), P("lock", "Lock-ID", { required: true }), P("titel", "Titel"), P("beschrijving", "Beschrijving", { type: "text" })] },
      { id: "document.lock", resource: "Document", label: "Document vergrendelen", method: "POST", path: "/enkelvoudiginformatieobjecten/{{uuid}}/lock", params: [path("uuid", "UUID")] },
      { id: "document.unlock", resource: "Document", label: "Document ontgrendelen", method: "POST", path: "/enkelvoudiginformatieobjecten/{{uuid}}/unlock", params: [path("uuid", "UUID"), P("lock", "Lock-ID", { required: true })] },
      { id: "document.download", resource: "Document", label: "Inhoud downloaden", method: "GET", path: "/enkelvoudiginformatieobjecten/{{uuid}}/download", params: [path("uuid", "UUID")] },
      { id: "document.delete", resource: "Document", label: "Document verwijderen", method: "DELETE", path: "/enkelvoudiginformatieobjecten/{{uuid}}", params: [path("uuid", "UUID")] }
    ]
  },
  {
    id: "zgw-catalogi", name: "ZGW Catalogi API", category: "Overheid", description: "Zaaktypen, statustypen, roltypen, resultaattypen en informatieobjecttypen", color: "#154273",
    website: "https://vng-realisatie.github.io/gemma-zaken/", docs: "https://vng-realisatie.github.io/gemma-zaken/standaard/catalogi/",
    baseUrl: "{{url}}", fields: [zgwBase("Basis-URL Catalogi API", "https://openzaak.gemeente.nl/catalogi/api/v1")], auth: zgwAuth, test: "catalogus.list",
    operations: [
      { id: "catalogus.list", resource: "Catalogus", label: "Catalogi", method: "GET", path: "/catalogussen", output: "results", params: [q("domein", "Domein"), q("rsin", "RSIN")] },
      { id: "zaaktype.list", resource: "Zaaktype", label: "Zaaktypen", method: "GET", path: "/zaaktypen", output: "results", params: [q("catalogus", "Catalogus (URL)"), q("identificatie", "Identificatie"), q("status", "Status", { options: ["alles", "concept", "definitief"] })] },
      { id: "zaaktype.get", resource: "Zaaktype", label: "Zaaktype ophalen", method: "GET", path: "/zaaktypen/{{uuid}}", params: [path("uuid", "UUID")] },
      { id: "statustype.list", resource: "Statustype", label: "Statustypen", method: "GET", path: "/statustypen", output: "results", params: [q("zaaktype", "Zaaktype (URL)")] },
      { id: "roltype.list", resource: "Roltype", label: "Roltypen", method: "GET", path: "/roltypen", output: "results", params: [q("zaaktype", "Zaaktype (URL)"), q("omschrijvingGeneriek", "Generieke omschrijving")] },
      { id: "resultaattype.list", resource: "Resultaattype", label: "Resultaattypen", method: "GET", path: "/resultaattypen", output: "results", params: [q("zaaktype", "Zaaktype (URL)")] },
      { id: "informatieobjecttype.list", resource: "Informatieobjecttype", label: "Informatieobjecttypen", method: "GET", path: "/informatieobjecttypen", output: "results", params: [q("catalogus", "Catalogus (URL)")] }
    ]
  },
  {
    id: "zgw-besluiten", name: "ZGW Besluiten API", category: "Overheid", description: "Besluiten en besluitinformatieobjecten", color: "#154273",
    website: "https://vng-realisatie.github.io/gemma-zaken/", docs: "https://vng-realisatie.github.io/gemma-zaken/standaard/besluiten/",
    baseUrl: "{{url}}", fields: [zgwBase("Basis-URL Besluiten API", "https://openzaak.gemeente.nl/besluiten/api/v1")], auth: zgwAuth, test: "besluit.list",
    operations: [
      { id: "besluit.list", resource: "Besluit", label: "Besluiten", method: "GET", path: "/besluiten", output: "results", params: [q("zaak", "Zaak (URL)"), q("identificatie", "Identificatie")] },
      { id: "besluit.get", resource: "Besluit", label: "Besluit ophalen", method: "GET", path: "/besluiten/{{uuid}}", params: [path("uuid", "UUID")] },
      { id: "besluit.create", resource: "Besluit", label: "Besluit vastleggen", method: "POST", path: "/besluiten", params: [P("verantwoordelijkeOrganisatie", "Verantwoordelijke organisatie (RSIN)", { required: true }), P("besluittype", "Besluittype (URL)", { required: true }), P("datum", "Datum", { required: true }), P("ingangsdatum", "Ingangsdatum", { required: true }), P("zaak", "Zaak (URL)"), P("toelichting", "Toelichting", { type: "text" })] },
      { id: "bio.create", resource: "Document bij besluit", label: "Document aan besluit koppelen", method: "POST", path: "/besluitinformatieobjecten", params: [P("besluit", "Besluit (URL)", { required: true }), P("informatieobject", "Informatieobject (URL)", { required: true })] }
    ]
  },
  {
    id: "open-notificaties", name: "Notificaties API (ZGW)", category: "Overheid", description: "Kanalen, abonnementen en notificaties versturen (Open Notificaties)", color: "#154273",
    website: "https://vng-realisatie.github.io/gemma-zaken/", docs: "https://vng-realisatie.github.io/gemma-zaken/standaard/notificaties/",
    baseUrl: "{{url}}", fields: [zgwBase("Basis-URL Notificaties API", "https://opennotificaties.gemeente.nl/api/v1")], auth: zgwAuth, test: "kanaal.list",
    operations: [
      { id: "kanaal.list", resource: "Kanaal", label: "Kanalen", method: "GET", path: "/kanaal", params: [q("naam", "Naam")] },
      { id: "kanaal.create", resource: "Kanaal", label: "Kanaal aanmaken", method: "POST", path: "/kanaal", params: [P("naam", "Naam", { required: true, placeholder: "zaken" }), P("documentatieLink", "Documentatielink"), P("filters", "Filters", { format: "list" })] },
      { id: "abonnement.list", resource: "Abonnement", label: "Abonnementen", method: "GET", path: "/abonnement" },
      { id: "abonnement.create", resource: "Abonnement", label: "Abonneren (webhook van dit platform)", method: "POST", path: "/abonnement", description: "Gebruik als callback de URL van een webhook-trigger; de notificatie start dan het proces.",
        params: [P("callbackUrl", "Callback-URL", { required: true }), P("auth", "Authorization-header voor de callback", { required: true }), json("kanalen", "Kanalen", { required: true, placeholder: '[{"naam":"zaken","filters":{"bronorganisatie":"123456782"}}]' })] },
      { id: "notificatie.send", resource: "Notificatie", label: "Notificatie versturen", method: "POST", path: "/notificaties", params: [P("kanaal", "Kanaal", { required: true }), P("hoofdObject", "Hoofdobject (URL)", { required: true }), P("resource", "Resource", { required: true, placeholder: "zaak" }), P("resourceUrl", "Resource-URL", { required: true }), P("actie", "Actie", { required: true, options: ["create", "update", "partial_update", "destroy"] }), P("aanmaakdatum", "Aanmaakdatum", { required: true, placeholder: "{{$now}}" }), json("kenmerken", "Kenmerken")] }
    ]
  },
  {
    id: "haal-centraal-brp", name: "Haal Centraal BRP Personen", category: "Overheid", description: "Personen bevragen in de BRP (Basisregistratie Personen) via de Haal Centraal API", color: "#154273",
    website: "https://brp-api.github.io/Haal-Centraal-BRP-bevragen/", docs: "https://brp-api.github.io/Haal-Centraal-BRP-bevragen/v2/getting-started",
    baseUrl: "{{url}}", fields: [{ ...urlField("Basis-URL", "https://api.brp.example.nl/haalcentraal/api/brp"), key: "url" }],
    auth: { type: "apiKey", in: "header", name: "X-API-KEY", label: "API-key" }, headers: { accept: "application/json" },
    operations: [
      { id: "persoon.bsn", resource: "Persoon", label: "Raadplegen op BSN", method: "POST", path: "/personen", output: "personen", body: { type: "RaadpleegMetBurgerservicenummer", burgerservicenummer: "{{burgerservicenummer}}", fields: "{{fields}}", gemeenteVanInschrijving: "{{gemeenteVanInschrijving}}" },
        params: [P("burgerservicenummer", "BSN('s)", { required: true, format: "list", placeholder: "999993653" }), P("fields", "Velden", { required: true, format: "list", default: "naam,geboorte,adressering" }), P("gemeenteVanInschrijving", "Gemeentecode (optioneel)")] },
      { id: "persoon.zoek", resource: "Persoon", label: "Zoeken op naam en geboortedatum", method: "POST", path: "/personen", output: "personen", body: { type: "ZoekMetGeslachtsnaamEnGeboortedatum", geslachtsnaam: "{{geslachtsnaam}}", geboortedatum: "{{geboortedatum}}", voornamen: "{{voornamen}}", fields: "{{fields}}" },
        params: [P("geslachtsnaam", "Geslachtsnaam", { required: true }), P("geboortedatum", "Geboortedatum", { required: true, placeholder: "1983-05-26" }), P("voornamen", "Voornamen"), P("fields", "Velden", { required: true, format: "list", default: "burgerservicenummer,naam,geboorte" })] },
      { id: "persoon.adres", resource: "Persoon", label: "Zoeken op postcode en huisnummer", method: "POST", path: "/personen", output: "personen", body: { type: "ZoekMetPostcodeEnHuisnummer", postcode: "{{postcode}}", huisnummer: "{{huisnummer}}", fields: "{{fields}}" },
        params: [P("postcode", "Postcode", { required: true, placeholder: "2595AK" }), P("huisnummer", "Huisnummer", { required: true }), P("fields", "Velden", { required: true, format: "list", default: "burgerservicenummer,naam" })] }
    ]
  },
  {
    id: "kvk", name: "KVK Handelsregister", category: "Overheid", description: "Bedrijven zoeken, basisprofielen en vestigingsprofielen (KVK API's)", color: "#00526e",
    website: "https://developers.kvk.nl", docs: "https://developers.kvk.nl/documentation",
    baseUrl: "https://api.kvk.nl/api", auth: { type: "apiKey", in: "header", name: "apikey", label: "API-key" }, test: "zoeken",
    operations: [
      { id: "zoeken", resource: "Zoeken", label: "Zoeken", method: "GET", path: "/v2/zoeken", output: "resultaten", params: [q("kvkNummer", "KVK-nummer"), q("naam", "Naam"), q("plaats", "Plaats"), q("postcode", "Postcode"), q("huisnummer", "Huisnummer"), q("type", "Type", { options: ["hoofdvestiging", "nevenvestiging", "rechtspersoon"] }), q("resultatenPerPagina", "Per pagina", { default: "10" })] },
      { id: "basisprofiel", resource: "Basisprofiel", label: "Basisprofiel", method: "GET", path: "/v1/basisprofielen/{{kvkNummer}}", params: [path("kvkNummer", "KVK-nummer"), q("geoData", "Met geodata", { options: ["true", "false"] })] },
      { id: "basisprofiel.vestigingen", resource: "Basisprofiel", label: "Vestigingen van een bedrijf", method: "GET", path: "/v1/basisprofielen/{{kvkNummer}}/vestigingen", output: "vestigingen", params: [path("kvkNummer", "KVK-nummer")] },
      { id: "vestigingsprofiel", resource: "Vestiging", label: "Vestigingsprofiel", method: "GET", path: "/v1/vestigingsprofielen/{{vestigingsnummer}}", params: [path("vestigingsnummer", "Vestigingsnummer")] },
      { id: "naamgeving", resource: "Naamgeving", label: "Naamgevingen", method: "GET", path: "/v1/naamgevingen/kvknummer/{{kvkNummer}}", params: [path("kvkNummer", "KVK-nummer")] }
    ]
  },
  {
    id: "exact-online", name: "Exact Online", category: "Financiën", description: "Relaties, artikelen, verkooporders, verkoopfacturen en grootboek", color: "#e4002b",
    website: "https://www.exact.com/nl", docs: "https://start.exactonline.nl/docs/HlpRestAPIResources.aspx",
    baseUrl: "https://{{host}}/api/v1/{{division}}",
    auth: { type: "oauth2", authUrl: "https://{{host}}/api/oauth2/auth", tokenUrl: "https://{{host}}/api/oauth2/token", scopes: [], help: "Registreer een app in het Exact App Center, zet de redirect-URI hieronder erbij en klik op Verbinden. Vul daarna de divisie in (zie 'Mijn divisie')." },
    fields: [{ key: "host", label: "Host", default: "start.exactonline.nl", placeholder: "start.exactonline.nl (NL) of start.exactonline.be" }, { key: "division", label: "Divisie (administratie)", help: "Te vinden via de operatie Mijn divisie" }],
    headers: { accept: "application/json" }, test: "me",
    operations: [
      { id: "me", resource: "Account", label: "Mijn divisie", method: "GET", baseUrl: "https://{{host}}/api/v1", path: "/current/Me?$select=CurrentDivision,FullName,Email", output: "d.results" },
      { id: "account.list", resource: "Relatie", label: "Relaties", method: "GET", path: "/crm/Accounts", output: "d.results", params: [q("$filter", "Filter (OData)", { placeholder: "Name eq 'Jansen BV'" }), q("$select", "Velden", { default: "ID,Code,Name,Email,City" }), q("$top", "Aantal", { default: "50" })] },
      { id: "account.create", resource: "Relatie", label: "Relatie aanmaken", method: "POST", path: "/crm/Accounts", output: "d", params: [P("Name", "Naam", { required: true }), P("Email", "E-mail"), P("City", "Plaats"), P("Country", "Land", { default: "NL" }), P("Status", "Status", { options: ["C", "P", "S"], help: "C = klant, P = prospect, S = suspect" }), P("ChamberOfCommerce", "KVK-nummer"), P("VATNumber", "Btw-nummer")] },
      { id: "account.update", resource: "Relatie", label: "Relatie bijwerken", method: "PUT", path: "/crm/Accounts(guid'{{id}}')", params: [path("id", "ID (GUID)"), P("Name", "Naam"), P("Email", "E-mail"), P("City", "Plaats")] },
      { id: "contact.create", resource: "Contactpersoon", label: "Contactpersoon aanmaken", method: "POST", path: "/crm/Contacts", output: "d", params: [P("Account", "Relatie-ID (GUID)", { required: true }), P("FirstName", "Voornaam"), P("LastName", "Achternaam", { required: true }), P("Email", "E-mail")] },
      { id: "item.list", resource: "Artikel", label: "Artikelen", method: "GET", path: "/logistics/Items", output: "d.results", params: [q("$filter", "Filter (OData)"), q("$select", "Velden", { default: "ID,Code,Description,SalesPrice" }), q("$top", "Aantal", { default: "50" })] },
      { id: "salesorder.create", resource: "Verkooporder", label: "Verkooporder aanmaken", method: "POST", path: "/salesorder/SalesOrders", output: "d", params: [P("OrderedBy", "Klant-ID (GUID)", { required: true }), P("Description", "Omschrijving"), P("YourRef", "Uw referentie"), json("SalesOrderLines", "Regels", { required: true, placeholder: '[{"Item":"<guid>","Quantity":2}]' })] },
      { id: "salesorder.list", resource: "Verkooporder", label: "Verkooporders", method: "GET", path: "/salesorder/SalesOrders", output: "d.results", params: [q("$filter", "Filter (OData)"), q("$top", "Aantal", { default: "50" })] },
      { id: "salesinvoice.create", resource: "Verkoopfactuur", label: "Verkoopfactuur aanmaken", method: "POST", path: "/salesinvoice/SalesInvoices", output: "d", params: [P("OrderedBy", "Klant-ID (GUID)", { required: true }), P("Journal", "Dagboek", { required: true, placeholder: "70" }), P("Description", "Omschrijving"), json("SalesInvoiceLines", "Regels", { required: true, placeholder: '[{"Item":"<guid>","Quantity":1}]' })] },
      { id: "salesinvoice.list", resource: "Verkoopfactuur", label: "Verkoopfacturen", method: "GET", path: "/salesinvoice/SalesInvoices", output: "d.results", params: [q("$filter", "Filter (OData)"), q("$top", "Aantal", { default: "50" })] },
      { id: "glaccount.list", resource: "Grootboek", label: "Grootboekrekeningen", method: "GET", path: "/financial/GLAccounts", output: "d.results", params: [q("$select", "Velden", { default: "ID,Code,Description" })] }
    ]
  },
  {
    id: "confluence", name: "Confluence", category: "Productiviteit", description: "Pagina's, spaces, labels en reacties (Confluence Cloud)", color: "#0052cc",
    website: "https://www.atlassian.com/software/confluence", docs: "https://developer.atlassian.com/cloud/confluence/rest/v2/",
    baseUrl: "https://{{domain}}/wiki/api/v2", auth: { type: "basic", userLabel: "E-mail (Atlassian-account)", passLabel: "API-token", help: "Maak een API-token op id.atlassian.com → Security → API tokens." },
    fields: [{ key: "domain", label: "Atlassian-domein", placeholder: "bedrijf.atlassian.net" }], test: "space.list",
    operations: [
      { id: "space.list", resource: "Space", label: "Spaces", method: "GET", path: "/spaces", output: "results", params: [q("keys", "Sleutels (komma)"), q("limit", "Aantal", { default: "25" })] },
      { id: "page.list", resource: "Pagina", label: "Pagina's", method: "GET", path: "/pages", output: "results", params: [q("space-id", "Space-ID"), q("title", "Titel"), q("body-format", "Inhoud meenemen", { options: ["storage", "atlas_doc_format"] }), q("limit", "Aantal", { default: "25" })] },
      { id: "page.get", resource: "Pagina", label: "Pagina ophalen", method: "GET", path: "/pages/{{id}}", params: [path("id", "Pagina-ID"), q("body-format", "Inhoudsformaat", { default: "storage", options: ["storage", "atlas_doc_format", "view"] })] },
      { id: "page.create", resource: "Pagina", label: "Pagina maken", method: "POST", path: "/pages", body: { spaceId: "{{spaceId}}", status: "{{status}}", title: "{{title}}", parentId: "{{parentId}}", body: { representation: "storage", value: "{{body}}" } },
        params: [P("spaceId", "Space-ID", { required: true }), P("title", "Titel", { required: true }), P("body", "Inhoud (HTML / storage-formaat)", { type: "text", required: true, placeholder: "<p>Hallo</p>" }), P("parentId", "Bovenliggende pagina-ID"), P("status", "Status", { default: "current", options: ["current", "draft"] })] },
      { id: "page.update", resource: "Pagina", label: "Pagina bijwerken", method: "PUT", path: "/pages/{{id}}", body: { id: "{{id}}", status: "current", title: "{{title}}", body: { representation: "storage", value: "{{body}}" }, version: { number: "{{version}}", message: "{{message}}" } },
        params: [path("id", "Pagina-ID"), P("title", "Titel", { required: true }), P("body", "Inhoud (storage-formaat)", { type: "text", required: true }), P("version", "Nieuw versienummer", { type: "number", required: true, help: "Huidige versie + 1" }), P("message", "Wijzigingsbericht")] },
      { id: "page.delete", resource: "Pagina", label: "Pagina verwijderen", method: "DELETE", path: "/pages/{{id}}", params: [path("id", "Pagina-ID")] },
      { id: "page.children", resource: "Pagina", label: "Onderliggende pagina's", method: "GET", path: "/pages/{{id}}/children", output: "results", params: [path("id", "Pagina-ID")] },
      { id: "page.labels", resource: "Label", label: "Labels van een pagina", method: "GET", path: "/pages/{{id}}/labels", output: "results", params: [path("id", "Pagina-ID")] },
      { id: "comment.create", resource: "Reactie", label: "Reactie plaatsen", method: "POST", path: "/footer-comments", body: { pageId: "{{pageId}}", body: { representation: "storage", value: "{{body}}" } }, params: [P("pageId", "Pagina-ID", { required: true }), P("body", "Reactie (storage-formaat)", { type: "text", required: true })] },
      { id: "search", resource: "Zoeken", label: "Zoeken (CQL)", method: "GET", baseUrl: "https://{{domain}}/wiki/rest/api", path: "/search", output: "results", params: [q("cql", "CQL", { required: true, placeholder: "type=page AND text ~ \"handleiding\"" }), q("limit", "Aantal", { default: "25" })] }
    ]
  },
  {
    id: "microsoft-dataverse", name: "Microsoft Dataverse", category: "Data & opslag", description: "Rijen in Dataverse-tabellen (Power Platform / Dynamics 365) via de Web API", color: "#742774",
    website: "https://learn.microsoft.com/power-apps/maker/data-platform/", docs: "https://learn.microsoft.com/power-apps/developer/data-platform/webapi/overview",
    baseUrl: "https://{{environment}}/api/data/v9.2",
    auth: { type: "oauth2", authUrl: "https://login.microsoftonline.com/{{tenant}}/oauth2/v2.0/authorize", tokenUrl: "https://login.microsoftonline.com/{{tenant}}/oauth2/v2.0/token", scopes: ["https://{{environment}}/user_impersonation", "offline_access"], help: "Registreer een app in Microsoft Entra ID met de gedelegeerde Dynamics CRM-machtiging user_impersonation en voeg de redirect-URI hieronder toe." },
    fields: [{ key: "tenant", label: "Tenant", default: "common", placeholder: "common of tenant-id" }, { key: "environment", label: "Omgeving", placeholder: "org123.crm4.dynamics.com" }],
    headers: { accept: "application/json", "OData-Version": "4.0", "OData-MaxVersion": "4.0" }, test: "whoami",
    operations: [
      { id: "whoami", resource: "Account", label: "Wie ben ik", method: "GET", path: "/WhoAmI" },
      { id: "row.list", resource: "Rij", label: "Rijen", method: "GET", path: "/{{table}}", output: "value", params: [path("table", "Tabel (entity set)", { placeholder: "accounts" }), q("$select", "Kolommen", { placeholder: "name,emailaddress1" }), q("$filter", "Filter (OData)"), q("$top", "Aantal", { default: "50" })] },
      { id: "row.get", resource: "Rij", label: "Rij ophalen", method: "GET", path: "/{{table}}({{id}})", params: [path("table", "Tabel (entity set)"), path("id", "ID (GUID)"), q("$select", "Kolommen")] },
      { id: "row.create", resource: "Rij", label: "Rij maken", method: "POST", path: "/{{table}}", bodyParam: "row", headers: { Prefer: "return=representation" }, params: [path("table", "Tabel (entity set)"), json("row", "Rij", { required: true, placeholder: '{"name":"Jansen BV"}' })] },
      { id: "row.update", resource: "Rij", label: "Rij bijwerken", method: "PATCH", path: "/{{table}}({{id}})", bodyParam: "row", params: [path("table", "Tabel (entity set)"), path("id", "ID (GUID)"), json("row", "Velden", { required: true })] },
      { id: "row.delete", resource: "Rij", label: "Rij verwijderen", method: "DELETE", path: "/{{table}}({{id}})", params: [path("table", "Tabel (entity set)"), path("id", "ID (GUID)")] }
    ]
  }
];
