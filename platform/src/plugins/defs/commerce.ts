import type { PluginDef } from "../types";
import { P, bool, json, num, path, q, urlField } from "./_shared";

// E-commerce en financiën.
export const COMMERCE: PluginDef[] = [
  {
    id: "stripe", name: "Stripe", category: "Financiën", description: "Klanten, betalingen, facturen en producten", color: "#635bff",
    website: "https://stripe.com", docs: "https://docs.stripe.com/api",
    baseUrl: "https://api.stripe.com/v1", auth: { type: "bearer", label: "Secret key (sk_…) of restricted key" }, test: "balance",
    operations: [
      { id: "customer.create", resource: "Klant", label: "Klant maken", method: "POST", path: "/customers", bodyType: "form", params: [P("email", "E-mail"), P("name", "Naam"), P("phone", "Telefoon"), P("description", "Omschrijving"), json("metadata", "Metadata")] },
      { id: "customer.search", resource: "Klant", label: "Klanten zoeken", method: "GET", path: "/customers/search", output: "data", params: [q("query", "Zoekvraag", { required: true, placeholder: "email:'jan@bedrijf.nl'" })] },
      { id: "customer.get", resource: "Klant", label: "Klant ophalen", method: "GET", path: "/customers/{{id}}", params: [path("id", "Klant-ID (cus_…)")] },
      { id: "customer.update", resource: "Klant", label: "Klant bijwerken", method: "POST", path: "/customers/{{id}}", bodyType: "form", params: [path("id", "Klant-ID"), P("email", "E-mail"), P("name", "Naam"), json("metadata", "Metadata")] },
      { id: "paymentIntent.create", resource: "Betaling", label: "Payment intent maken", method: "POST", path: "/payment_intents", bodyType: "form", params: [num("amount", "Bedrag (centen)", { required: true }), P("currency", "Valuta", { default: "eur" }), P("customer", "Klant-ID"), P("description", "Omschrijving"), P("payment_method_types", "Betaalmethoden", { format: "list", placeholder: "card,ideal" }), json("metadata", "Metadata")] },
      { id: "paymentIntent.get", resource: "Betaling", label: "Payment intent ophalen", method: "GET", path: "/payment_intents/{{id}}", params: [path("id", "ID (pi_…)")] },
      { id: "checkout.create", resource: "Betaling", label: "Checkout-sessie (betaallink)", method: "POST", path: "/checkout/sessions", bodyType: "form",
        body: { mode: "payment", success_url: "{{successUrl}}", cancel_url: "{{cancelUrl}}", customer_email: "{{email}}", line_items: [{ quantity: "{{quantity}}", price_data: { currency: "{{currency}}", unit_amount: "{{amount}}", product_data: { name: "{{product}}" } } }] },
        params: [P("product", "Product", { required: true }), num("amount", "Prijs (centen)", { required: true }), num("quantity", "Aantal", { default: 1 }), P("currency", "Valuta", { default: "eur" }), P("email", "E-mail klant"), P("successUrl", "Na betaling naar", { required: true }), P("cancelUrl", "Bij annuleren naar", { required: true })] },
      { id: "charge.list", resource: "Betaling", label: "Betalingen (charges)", method: "GET", path: "/charges", output: "data", params: [q("customer", "Klant-ID"), q("limit", "Aantal", { default: "25" })] },
      { id: "refund.create", resource: "Terugbetaling", label: "Terugbetalen", method: "POST", path: "/refunds", bodyType: "form", params: [P("payment_intent", "Payment intent-ID", { required: true }), num("amount", "Bedrag (centen, leeg = alles)"), P("reason", "Reden", { options: ["duplicate", "fraudulent", "requested_by_customer"] })] },
      { id: "invoice.create", resource: "Factuur", label: "Factuur maken", method: "POST", path: "/invoices", bodyType: "form", params: [P("customer", "Klant-ID", { required: true }), P("collection_method", "Innen", { default: "send_invoice", options: ["send_invoice", "charge_automatically"] }), num("days_until_due", "Betaaltermijn (dagen)", { default: 14 }), P("description", "Omschrijving")] },
      { id: "invoiceItem.create", resource: "Factuur", label: "Factuurregel toevoegen", method: "POST", path: "/invoiceitems", bodyType: "form", params: [P("customer", "Klant-ID", { required: true }), P("invoice", "Factuur-ID"), num("amount", "Bedrag (centen)", { required: true }), P("currency", "Valuta", { default: "eur" }), P("description", "Omschrijving")] },
      { id: "invoice.finalize", resource: "Factuur", label: "Factuur definitief maken", method: "POST", path: "/invoices/{{id}}/finalize", params: [path("id", "Factuur-ID")] },
      { id: "invoice.send", resource: "Factuur", label: "Factuur versturen", method: "POST", path: "/invoices/{{id}}/send", params: [path("id", "Factuur-ID")] },
      { id: "invoice.list", resource: "Factuur", label: "Facturen", method: "GET", path: "/invoices", output: "data", params: [q("customer", "Klant-ID"), q("status", "Status"), q("limit", "Aantal", { default: "25" })] },
      { id: "product.create", resource: "Product", label: "Product maken", method: "POST", path: "/products", bodyType: "form", params: [P("name", "Naam", { required: true }), P("description", "Omschrijving")] },
      { id: "price.create", resource: "Product", label: "Prijs maken", method: "POST", path: "/prices", bodyType: "form", params: [P("product", "Product-ID", { required: true }), num("unit_amount", "Prijs (centen)", { required: true }), P("currency", "Valuta", { default: "eur" }), P("recurring.interval", "Abonnement (interval)", { options: ["day", "week", "month", "year"] })] },
      { id: "subscription.list", resource: "Abonnement", label: "Abonnementen", method: "GET", path: "/subscriptions", output: "data", params: [q("customer", "Klant-ID"), q("status", "Status", { default: "active" })] },
      { id: "event.list", resource: "Event", label: "Events", method: "GET", path: "/events", output: "data", params: [q("type", "Type", { placeholder: "invoice.paid" }), q("limit", "Aantal", { default: "25" })] },
      { id: "balance", resource: "Account", label: "Saldo", method: "GET", path: "/balance" }
    ]
  },
  {
    id: "shopify", name: "Shopify", category: "E-commerce", description: "Producten, bestellingen en klanten (Admin API)", color: "#95bf47",
    website: "https://shopify.com", docs: "https://shopify.dev/docs/api/admin-rest",
    baseUrl: "https://{{shop}}.myshopify.com/admin/api/2024-10", auth: { type: "headers", headers: { "X-Shopify-Access-Token": "{{adminToken}}" }, fields: [{ key: "adminToken", label: "Admin API access token (shpat_…)", secret: true }], help: "Maak in je Shopify-admin een custom app (Apps → Develop apps), geef Admin API-scopes en installeer hem." },
    fields: [{ key: "shop", label: "Winkelnaam", placeholder: "mijnwinkel (van mijnwinkel.myshopify.com)" }], test: "shop",
    operations: [
      { id: "order.list", resource: "Bestelling", label: "Bestellingen", method: "GET", path: "/orders.json", output: "orders", params: [q("status", "Status", { default: "any", options: ["open", "closed", "cancelled", "any"] }), q("created_at_min", "Vanaf (ISO)"), q("limit", "Aantal", { default: "50" }), q("fields", "Velden")] },
      { id: "order.get", resource: "Bestelling", label: "Bestelling ophalen", method: "GET", path: "/orders/{{id}}.json", output: "order", params: [path("id", "Bestelling-ID")] },
      { id: "order.update", resource: "Bestelling", label: "Bestelling bijwerken", method: "PUT", path: "/orders/{{id}}.json", output: "order", params: [path("id", "Bestelling-ID"), P("order.note", "Notitie"), P("order.tags", "Tags (komma)")] },
      { id: "order.fulfill", resource: "Bestelling", label: "Fulfillment-orders", method: "GET", path: "/orders/{{id}}/fulfillment_orders.json", output: "fulfillment_orders", params: [path("id", "Bestelling-ID")] },
      { id: "product.list", resource: "Product", label: "Producten", method: "GET", path: "/products.json", output: "products", params: [q("limit", "Aantal", { default: "50" }), q("title", "Titel"), q("vendor", "Leverancier")] },
      { id: "product.get", resource: "Product", label: "Product ophalen", method: "GET", path: "/products/{{id}}.json", output: "product", params: [path("id", "Product-ID")] },
      { id: "product.create", resource: "Product", label: "Product maken", method: "POST", path: "/products.json", output: "product", params: [P("product.title", "Titel", { required: true }), P("product.body_html", "Omschrijving (HTML)", { type: "text" }), P("product.vendor", "Leverancier"), P("product.product_type", "Type"), json("product.variants", "Varianten", { placeholder: '[{"price":"19.95","sku":"ABC-1"}]' })] },
      { id: "product.update", resource: "Product", label: "Product bijwerken", method: "PUT", path: "/products/{{id}}.json", output: "product", params: [path("id", "Product-ID"), P("product.title", "Titel"), P("product.body_html", "Omschrijving"), P("product.status", "Status", { options: ["active", "draft", "archived"] })] },
      { id: "inventory.set", resource: "Voorraad", label: "Voorraad instellen", method: "POST", path: "/inventory_levels/set.json", params: [num("location_id", "Locatie-ID", { required: true }), num("inventory_item_id", "Voorraaditem-ID", { required: true }), num("available", "Beschikbaar", { required: true })] },
      { id: "customer.list", resource: "Klant", label: "Klanten zoeken", method: "GET", path: "/customers/search.json", output: "customers", params: [q("query", "Zoekvraag", { placeholder: "email:jan@bedrijf.nl" })] },
      { id: "customer.create", resource: "Klant", label: "Klant maken", method: "POST", path: "/customers.json", output: "customer", params: [P("customer.email", "E-mail", { required: true }), P("customer.first_name", "Voornaam"), P("customer.last_name", "Achternaam"), P("customer.phone", "Telefoon"), P("customer.tags", "Tags")] },
      { id: "shop", resource: "Winkel", label: "Winkelinfo", method: "GET", path: "/shop.json", output: "shop" }
    ]
  },
  {
    id: "woocommerce", name: "WooCommerce", category: "E-commerce", description: "Producten, bestellingen en klanten", color: "#7f54b3",
    website: "https://woocommerce.com", docs: "https://woocommerce.github.io/woocommerce-rest-api-docs/",
    baseUrl: "{{url}}/wp-json/wc/v3", auth: { type: "basic", userLabel: "Consumer key", passLabel: "Consumer secret" }, fields: [urlField("Winkel-URL (https)", "https://winkel.nl")], test: "product.list",
    operations: [
      { id: "order.list", resource: "Bestelling", label: "Bestellingen", method: "GET", path: "/orders", params: [q("status", "Status", { placeholder: "processing" }), q("after", "Na (ISO)"), q("per_page", "Aantal", { default: "50" })] },
      { id: "order.get", resource: "Bestelling", label: "Bestelling ophalen", method: "GET", path: "/orders/{{id}}", params: [path("id", "Bestelling-ID")] },
      { id: "order.update", resource: "Bestelling", label: "Status wijzigen", method: "PUT", path: "/orders/{{id}}", params: [path("id", "Bestelling-ID"), P("status", "Status", { required: true, options: ["pending", "processing", "on-hold", "completed", "cancelled", "refunded"] })] },
      { id: "order.note", resource: "Bestelling", label: "Notitie toevoegen", method: "POST", path: "/orders/{{id}}/notes", params: [path("id", "Bestelling-ID"), P("note", "Notitie", { required: true }), bool("customer_note", "Zichtbaar voor klant", { default: false })] },
      { id: "product.list", resource: "Product", label: "Producten", method: "GET", path: "/products", params: [q("search", "Zoektekst"), q("sku", "SKU"), q("per_page", "Aantal", { default: "20" })] },
      { id: "product.create", resource: "Product", label: "Product maken", method: "POST", path: "/products", params: [P("name", "Naam", { required: true }), P("type", "Type", { default: "simple" }), P("regular_price", "Prijs"), P("sku", "SKU"), P("description", "Omschrijving", { type: "text" }), bool("manage_stock", "Voorraad bijhouden"), num("stock_quantity", "Voorraad")] },
      { id: "product.update", resource: "Product", label: "Product bijwerken (prijs/voorraad)", method: "PUT", path: "/products/{{id}}", params: [path("id", "Product-ID"), P("regular_price", "Prijs"), P("sale_price", "Aanbiedingsprijs"), num("stock_quantity", "Voorraad"), P("status", "Status", { options: ["publish", "draft", "private"] })] },
      { id: "customer.create", resource: "Klant", label: "Klant maken", method: "POST", path: "/customers", params: [P("email", "E-mail", { required: true }), P("first_name", "Voornaam"), P("last_name", "Achternaam")] },
      { id: "customer.list", resource: "Klant", label: "Klanten", method: "GET", path: "/customers", params: [q("email", "E-mail"), q("per_page", "Aantal", { default: "20" })] }
    ]
  },
  {
    id: "magento", name: "Magento 2", category: "E-commerce", description: "Producten, klanten en bestellingen", color: "#f26322",
    website: "https://business.adobe.com/products/magento/magento-commerce.html", docs: "https://developer.adobe.com/commerce/webapi/rest/",
    baseUrl: "{{url}}/rest/V1", auth: { type: "bearer", label: "Integratie-access token" }, fields: [urlField("Winkel-URL")],
    operations: [
      { id: "order.list", resource: "Bestelling", label: "Bestellingen", method: "GET", path: "/orders", output: "items", params: [P("criteria", "Zoekcriteria", { in: "rawQuery", default: "searchCriteria[pageSize]=20&searchCriteria[sortOrders][0][field]=created_at&searchCriteria[sortOrders][0][direction]=DESC" })] },
      { id: "order.get", resource: "Bestelling", label: "Bestelling ophalen", method: "GET", path: "/orders/{{id}}", params: [path("id", "Bestelling-ID")] },
      { id: "product.get", resource: "Product", label: "Product ophalen", method: "GET", path: "/products/{{sku}}", params: [path("sku", "SKU")] },
      { id: "product.list", resource: "Product", label: "Producten zoeken", method: "GET", path: "/products", output: "items", params: [P("criteria", "Zoekcriteria", { in: "rawQuery", default: "searchCriteria[pageSize]=20" })] },
      { id: "stock.update", resource: "Voorraad", label: "Voorraad bijwerken", method: "PUT", path: "/products/{{sku}}/stockItems/1", body: { stockItem: { qty: "{{qty}}", is_in_stock: "{{inStock}}" } }, params: [path("sku", "SKU"), num("qty", "Aantal", { required: true }), bool("inStock", "Op voorraad", { default: true })] },
      { id: "customer.get", resource: "Klant", label: "Klant ophalen", method: "GET", path: "/customers/{{id}}", params: [path("id", "Klant-ID")] }
    ]
  },
  {
    id: "paypal", name: "PayPal", category: "Financiën", description: "Bestellingen, facturen en uitbetalingen", color: "#003087",
    website: "https://paypal.com", docs: "https://developer.paypal.com/api/rest/",
    baseUrl: "https://{{host}}", auth: { type: "oauth2-client", tokenUrl: "https://{{host}}/v1/oauth2/token", tokenAuth: "basic", help: "Maak een REST-app in het PayPal Developer Dashboard en vul Client ID en Secret in." },
    fields: [{ key: "host", label: "API-host", default: "api-m.paypal.com", placeholder: "api-m.sandbox.paypal.com voor testen" }],
    operations: [
      { id: "order.create", resource: "Bestelling", label: "Bestelling maken", method: "POST", path: "/v2/checkout/orders", body: { intent: "CAPTURE", purchase_units: [{ reference_id: "{{reference}}", description: "{{description}}", amount: { currency_code: "{{currency}}", value: "{{value}}" } }] },
        params: [P("value", "Bedrag (bv. 19.95)", { required: true }), P("currency", "Valuta", { default: "EUR" }), P("reference", "Referentie"), P("description", "Omschrijving")] },
      { id: "order.get", resource: "Bestelling", label: "Bestelling ophalen", method: "GET", path: "/v2/checkout/orders/{{id}}", params: [path("id", "Bestelling-ID")] },
      { id: "order.capture", resource: "Bestelling", label: "Betaling innen (capture)", method: "POST", path: "/v2/checkout/orders/{{id}}/capture", contentType: "application/json", params: [path("id", "Bestelling-ID")] },
      { id: "payout.create", resource: "Uitbetaling", label: "Uitbetaling", method: "POST", path: "/v1/payments/payouts", body: { sender_batch_header: { sender_batch_id: "{{batchId}}", email_subject: "{{subject}}" }, items: [{ recipient_type: "EMAIL", receiver: "{{receiver}}", amount: { value: "{{value}}", currency: "{{currency}}" }, note: "{{note}}" }] },
        params: [P("batchId", "Batch-ID (uniek)", { required: true }), P("receiver", "Ontvanger (e-mail)", { required: true }), P("value", "Bedrag", { required: true }), P("currency", "Valuta", { default: "EUR" }), P("subject", "Onderwerp"), P("note", "Notitie")] },
      { id: "invoice.list", resource: "Factuur", label: "Facturen", method: "GET", path: "/v2/invoicing/invoices", output: "items", params: [q("page_size", "Aantal", { default: "20" })] }
    ]
  },
  {
    id: "xero", name: "Xero", category: "Financiën", description: "Contacten, facturen en betalingen", color: "#13b5ea",
    website: "https://xero.com", docs: "https://developer.xero.com/documentation/api/accounting/overview",
    baseUrl: "https://api.xero.com/api.xro/2.0",
    auth: { type: "oauth2", authUrl: "https://login.xero.com/identity/connect/authorize", tokenUrl: "https://identity.xero.com/connect/token", tokenAuth: "basic", scopes: ["openid", "profile", "email", "offline_access", "accounting.transactions", "accounting.contacts", "accounting.settings.read"], help: "Maak een app op developer.xero.com (Web app). Vul na het verbinden de Tenant-ID in (zie 'Organisaties')." },
    fields: [{ key: "tenantId", label: "Tenant-ID (organisatie)", help: "Te vinden via de operatie Organisaties na het verbinden" }], headers: { "xero-tenant-id": "{{tenantId}}" }, test: "connections",
    operations: [
      { id: "connections", resource: "Organisatie", label: "Organisaties (tenant-ID's)", method: "GET", baseUrl: "https://api.xero.com", path: "/connections" },
      { id: "contact.list", resource: "Contact", label: "Contacten", method: "GET", path: "/Contacts", output: "Contacts", params: [q("where", "Filter", { placeholder: 'EmailAddress=="jan@bedrijf.nl"' })] },
      { id: "contact.create", resource: "Contact", label: "Contact maken", method: "POST", path: "/Contacts", output: "Contacts.0", body: { Contacts: [{ Name: "{{name}}", EmailAddress: "{{email}}", AccountNumber: "{{accountNumber}}" }] }, params: [P("name", "Naam", { required: true }), P("email", "E-mail"), P("accountNumber", "Klantnummer")] },
      { id: "invoice.list", resource: "Factuur", label: "Facturen", method: "GET", path: "/Invoices", output: "Invoices", params: [q("where", "Filter", { placeholder: 'Status=="AUTHORISED"' }), q("page", "Pagina", { default: "1" })] },
      { id: "invoice.create", resource: "Factuur", label: "Verkoopfactuur maken", method: "POST", path: "/Invoices", output: "Invoices.0", body: { Invoices: [{ Type: "ACCREC", Contact: { ContactID: "{{contactId}}" }, Date: "{{date}}", DueDate: "{{dueDate}}", Reference: "{{reference}}", Status: "{{status}}", LineItems: "{{lineItems}}" }] },
        params: [P("contactId", "Contact-ID", { required: true }), P("date", "Datum (JJJJ-MM-DD)"), P("dueDate", "Vervaldatum"), P("reference", "Referentie"), P("status", "Status", { default: "DRAFT", options: ["DRAFT", "SUBMITTED", "AUTHORISED"] }), json("lineItems", "Regels", { required: true, placeholder: '[{"Description":"Advies","Quantity":1,"UnitAmount":100,"AccountCode":"200"}]' })] }
    ]
  },
  {
    id: "quickbooks", name: "QuickBooks Online", category: "Financiën", description: "Klanten, facturen en betalingen", color: "#2ca01c",
    website: "https://quickbooks.intuit.com", docs: "https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer",
    baseUrl: "https://{{host}}/v3/company/{{realmId}}", auth: { type: "oauth2", authUrl: "https://appcenter.intuit.com/connect/oauth2", tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", tokenAuth: "basic", scopes: ["com.intuit.quickbooks.accounting"] },
    fields: [{ key: "realmId", label: "Company-ID (realm)" }, { key: "host", label: "API-host", default: "quickbooks.api.intuit.com", placeholder: "sandbox-quickbooks.api.intuit.com" }], test: "company",
    operations: [
      { id: "query", resource: "Query", label: "Query", method: "GET", path: "/query", output: "QueryResponse", params: [q("query", "Query", { required: true, placeholder: "select * from Customer maxresults 20" })] },
      { id: "customer.create", resource: "Klant", label: "Klant maken", method: "POST", path: "/customer", output: "Customer", params: [P("DisplayName", "Naam", { required: true }), P("PrimaryEmailAddr.Address", "E-mail"), P("CompanyName", "Bedrijf")] },
      { id: "invoice.create", resource: "Factuur", label: "Factuur maken", method: "POST", path: "/invoice", output: "Invoice", body: { CustomerRef: { value: "{{customerId}}" }, Line: "{{lines}}" }, params: [P("customerId", "Klant-ID", { required: true }), json("lines", "Regels", { required: true, placeholder: '[{"Amount":100,"DetailType":"SalesItemLineDetail","SalesItemLineDetail":{"ItemRef":{"value":"1"}}}]' })] },
      { id: "company", resource: "Bedrijf", label: "Bedrijfsinfo", method: "GET", path: "/companyinfo/{{realmId}}", output: "CompanyInfo" }
    ]
  },
  {
    id: "paddle", name: "Paddle", category: "Financiën", description: "Klanten, abonnementen en transacties (Paddle Billing)", color: "#fddd35",
    website: "https://paddle.com", docs: "https://developer.paddle.com/api-reference/overview",
    baseUrl: "https://{{host}}", auth: { type: "bearer", label: "API-key" }, fields: [{ key: "host", label: "API-host", default: "api.paddle.com", placeholder: "sandbox-api.paddle.com" }], test: "eventType.list",
    operations: [
      { id: "customer.list", resource: "Klant", label: "Klanten", method: "GET", path: "/customers", output: "data", params: [q("email", "E-mail")] },
      { id: "customer.create", resource: "Klant", label: "Klant maken", method: "POST", path: "/customers", output: "data", params: [P("email", "E-mail", { required: true }), P("name", "Naam")] },
      { id: "subscription.list", resource: "Abonnement", label: "Abonnementen", method: "GET", path: "/subscriptions", output: "data", params: [q("status", "Status", { default: "active" })] },
      { id: "subscription.cancel", resource: "Abonnement", label: "Abonnement opzeggen", method: "POST", path: "/subscriptions/{{id}}/cancel", output: "data", params: [path("id", "Abonnement-ID"), P("effective_from", "Per", { default: "next_billing_period", options: ["next_billing_period", "immediately"] })] },
      { id: "transaction.list", resource: "Transactie", label: "Transacties", method: "GET", path: "/transactions", output: "data" },
      { id: "eventType.list", resource: "Event", label: "Eventtypes", method: "GET", path: "/event-types", output: "data" }
    ]
  },
  {
    id: "chargebee", name: "Chargebee", category: "Financiën", description: "Abonnementen, klanten en facturen", color: "#ff7846",
    website: "https://chargebee.com", docs: "https://apidocs.chargebee.com/docs/api",
    baseUrl: "https://{{site}}.chargebee.com/api/v2", auth: { type: "basic", userLabel: "API-key", passLabel: "(leeg laten)" }, fields: [{ key: "site", label: "Site", placeholder: "bedrijf (-test)" }], test: "customer.list",
    operations: [
      { id: "customer.list", resource: "Klant", label: "Klanten", method: "GET", path: "/customers", output: "list", params: [q("limit", "Aantal", { default: "20" }), q("email[is]", "E-mail")] },
      { id: "customer.create", resource: "Klant", label: "Klant maken", method: "POST", path: "/customers", bodyType: "form", output: "customer", params: [P("email", "E-mail"), P("first_name", "Voornaam"), P("last_name", "Achternaam"), P("company", "Bedrijf")] },
      { id: "subscription.list", resource: "Abonnement", label: "Abonnementen", method: "GET", path: "/subscriptions", output: "list", params: [q("status[is]", "Status", { placeholder: "active" })] },
      { id: "invoice.list", resource: "Factuur", label: "Facturen", method: "GET", path: "/invoices", output: "list", params: [q("limit", "Aantal", { default: "20" })] }
    ]
  },
  {
    id: "gumroad", name: "Gumroad", category: "E-commerce", description: "Producten en verkopen", color: "#ff90e8",
    website: "https://gumroad.com", docs: "https://app.gumroad.com/api",
    baseUrl: "https://api.gumroad.com/v2", auth: { type: "apiKey", in: "query", name: "access_token", label: "Access token" }, okField: "success", test: "user",
    operations: [
      { id: "product.list", resource: "Product", label: "Producten", method: "GET", path: "/products", output: "products" },
      { id: "sale.list", resource: "Verkoop", label: "Verkopen", method: "GET", path: "/sales", output: "sales", params: [q("after", "Na (JJJJ-MM-DD)"), q("email", "E-mail koper")] },
      { id: "user", resource: "Account", label: "Account", method: "GET", path: "/user", output: "user" }
    ]
  },
  {
    id: "invoice-ninja", name: "Invoice Ninja", category: "Financiën", description: "Facturen, klanten en betalingen", color: "#2f7dc3",
    website: "https://invoiceninja.com", docs: "https://api-docs.invoicing.co",
    baseUrl: "{{url}}/api/v1", auth: { type: "headers", headers: { "X-API-TOKEN": "{{apiToken}}", "X-Requested-With": "XMLHttpRequest" }, fields: [{ key: "apiToken", label: "API-token", secret: true }] },
    fields: [{ key: "url", label: "URL", default: "https://invoicing.co" }], test: "client.list",
    operations: [
      { id: "client.list", resource: "Klant", label: "Klanten", method: "GET", path: "/clients", output: "data", params: [q("email", "E-mail"), q("per_page", "Aantal", { default: "20" })] },
      { id: "client.create", resource: "Klant", label: "Klant maken", method: "POST", path: "/clients", output: "data", params: [P("name", "Naam", { required: true }), json("contacts", "Contactpersonen", { placeholder: '[{"email":"jan@bedrijf.nl","first_name":"Jan"}]' })] },
      { id: "invoice.create", resource: "Factuur", label: "Factuur maken", method: "POST", path: "/invoices", output: "data", params: [P("client_id", "Klant-ID", { required: true }), json("line_items", "Regels", { required: true, placeholder: '[{"product_key":"Advies","quantity":1,"cost":100}]' })] },
      { id: "invoice.list", resource: "Factuur", label: "Facturen", method: "GET", path: "/invoices", output: "data", params: [q("client_status", "Status", { placeholder: "unpaid" })] }
    ]
  },
  {
    id: "erpnext", name: "ERPNext", category: "Financiën", description: "Elk document (klanten, orders, facturen …)", color: "#0089ff",
    website: "https://erpnext.com", docs: "https://frappeframework.com/docs/user/en/api/rest",
    baseUrl: "{{url}}/api/resource", auth: { type: "headers", headers: { Authorization: "token {{apiKey}}:{{apiSecret}}" }, fields: [{ key: "apiKey", label: "API-key" }, { key: "apiSecret", label: "API-secret", secret: true }] }, fields: [urlField("ERPNext-URL")],
    operations: [
      { id: "doc.list", resource: "Document", label: "Documenten", method: "GET", path: "/{{doctype}}", output: "data", params: [path("doctype", "Doctype", { default: "Customer", placeholder: "Customer, Sales Order, Item" }), q("fields", "Velden (JSON)", { default: '["*"]' }), q("filters", "Filters (JSON)"), q("limit_page_length", "Aantal", { default: "20" })] },
      { id: "doc.get", resource: "Document", label: "Document ophalen", method: "GET", path: "/{{doctype}}/{{name}}", output: "data", params: [path("doctype", "Doctype"), path("name", "Naam/ID")] },
      { id: "doc.create", resource: "Document", label: "Document maken", method: "POST", path: "/{{doctype}}", output: "data", bodyParam: "doc", params: [path("doctype", "Doctype"), json("doc", "Velden", { required: true })] },
      { id: "doc.update", resource: "Document", label: "Document bijwerken", method: "PUT", path: "/{{doctype}}/{{name}}", output: "data", bodyParam: "doc", params: [path("doctype", "Doctype"), path("name", "Naam/ID"), json("doc", "Velden", { required: true })] },
      { id: "doc.delete", resource: "Document", label: "Document verwijderen", method: "DELETE", path: "/{{doctype}}/{{name}}", params: [path("doctype", "Doctype"), path("name", "Naam/ID")] }
    ]
  },
  {
    id: "wise", name: "Wise", category: "Financiën", description: "Profielen, saldi en wisselkoersen", color: "#9fe870",
    website: "https://wise.com", docs: "https://docs.wise.com/api-docs/api-reference",
    baseUrl: "https://{{host}}", auth: { type: "bearer", label: "API-token" }, fields: [{ key: "host", label: "API-host", default: "api.transferwise.com", placeholder: "api.sandbox.transferwise.tech" }], test: "profile.list",
    operations: [
      { id: "profile.list", resource: "Profiel", label: "Profielen", method: "GET", path: "/v2/profiles" },
      { id: "balance.list", resource: "Saldo", label: "Saldi", method: "GET", path: "/v4/profiles/{{profileId}}/balances", params: [path("profileId", "Profiel-ID"), q("types", "Types", { default: "STANDARD" })] },
      { id: "rate.get", resource: "Koers", label: "Wisselkoers", method: "GET", path: "/v1/rates", params: [q("source", "Van", { default: "EUR" }), q("target", "Naar", { default: "USD" })] }
    ]
  },
  {
    id: "coingecko", name: "CoinGecko", category: "Financiën", description: "Cryptokoersen en marktdata", color: "#8dc63f",
    website: "https://coingecko.com", docs: "https://docs.coingecko.com/v3.0.1/reference/introduction",
    baseUrl: "https://api.coingecko.com/api/v3", auth: { type: "none" }, test: "ping",
    operations: [
      { id: "price", resource: "Koers", label: "Koersen", method: "GET", path: "/simple/price", params: [q("ids", "Munten", { required: true, default: "bitcoin,ethereum" }), q("vs_currencies", "In valuta", { default: "eur" }), q("include_24hr_change", "Wijziging 24u", { default: "true" })] },
      { id: "coin.get", resource: "Munt", label: "Muntgegevens", method: "GET", path: "/coins/{{id}}", params: [path("id", "Munt-ID", { default: "bitcoin" }), q("localization", "Vertalingen", { default: "false" })] },
      { id: "markets", resource: "Markt", label: "Marktoverzicht", method: "GET", path: "/coins/markets", params: [q("vs_currency", "Valuta", { default: "eur" }), q("per_page", "Aantal", { default: "20" })] },
      { id: "ping", resource: "Status", label: "Status", method: "GET", path: "/ping" }
    ]
  },
  {
    id: "marketstack", name: "Marketstack", category: "Financiën", description: "Beurskoersen", color: "#1f4b99",
    website: "https://marketstack.com", docs: "https://marketstack.com/documentation",
    baseUrl: "https://api.marketstack.com/v1", auth: { type: "apiKey", in: "query", name: "access_key", label: "Access key" },
    operations: [
      { id: "eod", resource: "Koers", label: "Slotkoersen", method: "GET", path: "/eod", output: "data", params: [q("symbols", "Symbolen", { required: true, placeholder: "AAPL,ASML.XAMS" }), q("limit", "Aantal", { default: "10" })] },
      { id: "ticker.get", resource: "Aandeel", label: "Aandeelinfo", method: "GET", path: "/tickers/{{symbol}}", params: [path("symbol", "Symbool")] }
    ]
  },
  {
    id: "dhl", name: "DHL", category: "E-commerce", description: "Zendingen volgen (Unified Tracking)", color: "#ffcc00",
    website: "https://developer.dhl.com", docs: "https://developer.dhl.com/api-reference/shipment-tracking",
    baseUrl: "https://api-eu.dhl.com", auth: { type: "apiKey", in: "header", name: "DHL-API-Key", label: "API-key" },
    operations: [{ id: "shipment.track", resource: "Zending", label: "Zending volgen", method: "GET", path: "/track/shipments", output: "shipments", params: [q("trackingNumber", "Trackingnummer", { required: true }), q("language", "Taal", { default: "nl" })] }]
  },
  {
    id: "onfleet", name: "Onfleet", category: "E-commerce", description: "Bezorgtaken en koeriers", color: "#2e9bd6",
    website: "https://onfleet.com", docs: "https://docs.onfleet.com",
    baseUrl: "https://onfleet.com/api/v2", auth: { type: "basic", userLabel: "API-key", passLabel: "(leeg laten)" }, test: "organization",
    operations: [
      { id: "task.create", resource: "Taak", label: "Bezorgtaak maken", method: "POST", path: "/tasks", params: [json("destination", "Bestemming", { required: true, placeholder: '{"address":{"unparsed":"Damrak 1, Amsterdam"}}' }), json("recipients", "Ontvangers", { placeholder: '[{"name":"Jan","phone":"+31612345678"}]' }), P("notes", "Notities"), num("completeAfter", "Niet vóór (ms)"), num("completeBefore", "Uiterlijk (ms)")] },
      { id: "task.get", resource: "Taak", label: "Taak ophalen", method: "GET", path: "/tasks/{{id}}", params: [path("id", "Taak-ID")] },
      { id: "worker.list", resource: "Koerier", label: "Koeriers", method: "GET", path: "/workers" },
      { id: "organization", resource: "Organisatie", label: "Organisatie", method: "GET", path: "/organization" }
    ]
  }
];
