import type { FieldDef, OperationDef, PluginDef } from "../types";
import { P, json, num, path, q, bool, urlField } from "./_shared";

// Databases, message brokers, directory/mail/SSH en opslagdiensten.
// Niet-HTTP-diensten lopen via een driver (src/plugins/drivers.ts); de rest is REST.

const DRIVER = "driver://";
const f = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, ...o });
const secret = (key: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ key, label, secret: true, ...o });
const conn = (fields: FieldDef[], help?: string) => ({ type: "custom" as const, signer: "driver", fields, help });

const sqlFields = (port: string, dbLabel = "Database"): FieldDef[] => [
  f("host", "Host", { placeholder: "db.intern.local" }), f("port", "Poort", { default: port }), f("database", dbLabel),
  f("user", "Gebruiker"), secret("password", "Wachtwoord"), f("ssl", "TLS/SSL", { placeholder: "ja of nee", default: "nee" })
];
const sqlOps = (driver: string, ph: string): OperationDef[] => [
  { id: "query", resource: "SQL", label: "Query uitvoeren", method: "POST", path: "", driver: `${driver}:query`, description: `Parameters veilig meegeven met ${ph} in de SQL en een JSON-array.`,
    params: [P("sql", "SQL", { type: "text", required: true, placeholder: `SELECT * FROM klanten WHERE id = ${ph}` }), json("parameters", "Parameters (JSON-array)", { placeholder: '["{{klantId}}"]' })] },
  { id: "insert", resource: "Rij", label: "Rijen toevoegen", method: "POST", path: "", driver: `${driver}:insert`, params: [P("table", "Tabel", { required: true }), json("rows", "Rijen (object of array)", { required: true, placeholder: '[{"naam":"Jan","plaats":"Utrecht"}]' })] },
  { id: "update", resource: "Rij", label: "Rij bijwerken (op sleutel)", method: "POST", path: "", driver: `${driver}:update`, params: [P("table", "Tabel", { required: true }), P("key", "Sleutelkolom", { required: true, default: "id" }), json("row", "Rij (met sleutel)", { required: true, placeholder: '{"id":7,"plaats":"Delft"}' })] },
  { id: "tables", resource: "Schema", label: "Tabellen", method: "GET", path: "", driver: `${driver}:tables` }
];

export const DATA: PluginDef[] = [
  // ---------------------------------------------------------------- SQL
  { id: "mysql", name: "MySQL", category: "Data & opslag", description: "SQL op MySQL/MariaDB", color: "#00758f", website: "https://mysql.com", docs: "https://dev.mysql.com/doc/",
    baseUrl: DRIVER, auth: conn(sqlFields("3306")), test: "tables", operations: sqlOps("mysql", "?") },
  { id: "microsoft-sql", name: "Microsoft SQL Server", category: "Data & opslag", description: "SQL op Microsoft SQL Server / Azure SQL", color: "#cc2927", website: "https://www.microsoft.com/sql-server", docs: "https://learn.microsoft.com/sql/",
    baseUrl: DRIVER, auth: conn([...sqlFields("1433"), f("trustCert", "Servercertificaat vertrouwen", { placeholder: "ja voor self-signed" })], "Azure SQL: TLS/SSL op 'ja'."), test: "tables", operations: sqlOps("mssql", "@p1") },
  { id: "oracle-sql", name: "Oracle Database", category: "Data & opslag", description: "SQL op Oracle (thin-modus, geen Oracle Client nodig)", color: "#c74634", website: "https://oracle.com/database", docs: "https://node-oracledb.readthedocs.io/",
    baseUrl: DRIVER, auth: conn([f("host", "Host"), f("port", "Poort", { default: "1521" }), f("database", "Servicenaam", { placeholder: "XEPDB1" }), f("connectString", "Of: connect string", { placeholder: "host:1521/service (overschrijft host/poort/service)" }), f("user", "Gebruiker"), secret("password", "Wachtwoord")]),
    test: "tables", operations: sqlOps("oracle", ":1") },
  { id: "timescaledb", name: "TimescaleDB", category: "Data & opslag", description: "Tijdreeksen in Postgres (TimescaleDB, ook gewone PostgreSQL)", color: "#fdb515", website: "https://timescale.com", docs: "https://docs.timescale.com/",
    baseUrl: DRIVER, auth: conn(sqlFields("5432")), test: "tables",
    operations: [...sqlOps("postgres", "$1"),
      { id: "hypertable", resource: "Schema", label: "Tabel omzetten naar hypertable", method: "POST", path: "", driver: "postgres:query",
        params: [P("sql", "SQL", { type: "text", default: "SELECT create_hypertable($1, by_range($2), if_not_exists => TRUE)" }), json("parameters", "Tabel en tijdkolom", { required: true, placeholder: '["metingen","tijd"]' })] }] },
  { id: "cratedb", name: "CrateDB", category: "Data & opslag", description: "SQL op CrateDB (HTTP-endpoint)", color: "#009dc7", website: "https://cratedb.com", docs: "https://cratedb.com/docs/crate/reference/en/latest/interfaces/http.html",
    baseUrl: "{{url}}", fields: [urlField("Adres", "https://cluster.cratedb.net:4200")], auth: { type: "basic", userLabel: "Gebruiker", passLabel: "Wachtwoord" }, test: "ping",
    operations: [
      { id: "query", resource: "SQL", label: "Query uitvoeren", method: "POST", path: "/_sql", params: [P("stmt", "SQL", { type: "text", required: true, placeholder: "SELECT * FROM doc.metingen WHERE sensor = ?" }), json("args", "Parameters (JSON-array)")] },
      { id: "bulk", resource: "SQL", label: "Bulk (zelfde SQL, veel rijen)", method: "POST", path: "/_sql", params: [P("stmt", "SQL", { type: "text", required: true, placeholder: "INSERT INTO doc.metingen (sensor, waarde) VALUES (?, ?)" }), json("bulk_args", "Rijen (array van arrays)", { required: true, placeholder: '[["a",1],["b",2]]' })] },
      { id: "ping", resource: "Cluster", label: "Clusterinfo", method: "POST", path: "/_sql", body: { stmt: "SELECT name FROM sys.cluster" } }
    ] },
  { id: "questdb", name: "QuestDB", category: "Data & opslag", description: "Tijdreeksdatabase: SQL en line protocol via HTTP", color: "#d14671", website: "https://questdb.io", docs: "https://questdb.io/docs/reference/api/rest/",
    baseUrl: "{{url}}", fields: [urlField("Adres", "http://questdb:9000")], auth: { type: "basic", userLabel: "Gebruiker (leeg = geen)", passLabel: "Wachtwoord" }, test: "ping",
    operations: [
      { id: "query", resource: "SQL", label: "Query uitvoeren", method: "GET", path: "/exec", params: [q("query", "SQL", { required: true, placeholder: "SELECT * FROM trades LIMIT 10" }), q("limit", "Limiet", { placeholder: "0,1000" })] },
      { id: "write", resource: "Data", label: "Schrijven (InfluxDB line protocol)", method: "POST", path: "/write", bodyParam: "lines", contentType: "text/plain", params: [P("lines", "Regels", { type: "text", required: true, placeholder: "sensoren,locatie=utrecht temp=21.5" }), q("precision", "Precisie", { options: ["n", "u", "ms", "s"] })] },
      { id: "ping", resource: "Server", label: "Verbinding testen", method: "GET", path: "/exec?query=SELECT%201" }
    ] },
  { id: "snowflake", name: "Snowflake", category: "Data & opslag", description: "SQL op Snowflake (SQL API)", color: "#29b5e8", website: "https://snowflake.com", docs: "https://docs.snowflake.com/en/developer-guide/sql-api/index",
    baseUrl: "https://{{account}}.snowflakecomputing.com/api/v2", fields: [f("account", "Account-ID", { placeholder: "orgnaam-accountnaam" }), f("warehouse", "Warehouse"), f("database", "Database"), f("schema", "Schema"), f("role", "Rol")],
    auth: { type: "bearer", label: "Programmatic access token", help: "Maak in Snowsight een programmatic access token (PAT) voor een gebruiker met de juiste rol." },
    headers: { "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN" }, test: "ping",
    operations: [
      { id: "statement", resource: "SQL", label: "SQL uitvoeren", method: "POST", path: "/statements", body: { statement: "{{statement}}", timeout: "{{timeout}}", warehouse: "{{warehouse}}", database: "{{database}}", schema: "{{schema}}", role: "{{role}}", bindings: "{{bindings}}" },
        params: [P("statement", "SQL", { type: "text", required: true }), num("timeout", "Time-out (s)", { default: 60 }), json("bindings", "Bindings", { placeholder: '{"1":{"type":"TEXT","value":"Jan"}}' })] },
      { id: "status", resource: "SQL", label: "Resultaat/status ophalen", method: "GET", path: "/statements/{{handle}}", params: [path("handle", "Statement-handle"), q("partition", "Partitie")] },
      { id: "cancel", resource: "SQL", label: "Annuleren", method: "POST", path: "/statements/{{handle}}/cancel", params: [path("handle", "Statement-handle")] },
      { id: "ping", resource: "SQL", label: "Verbinding testen", method: "POST", path: "/statements", body: { statement: "SELECT CURRENT_VERSION()", warehouse: "{{warehouse}}", role: "{{role}}" } }
    ] },
  { id: "databricks", name: "Databricks", category: "Data & opslag", description: "SQL-warehouses, jobs en clusters", color: "#ff3621", website: "https://databricks.com", docs: "https://docs.databricks.com/api/workspace/introduction",
    baseUrl: "{{url}}/api", fields: [urlField("Workspace-URL", "https://adb-123.4.azuredatabricks.net")], auth: { type: "bearer", label: "Personal access token of service-principal-token" }, test: "me",
    operations: [
      { id: "sql.execute", resource: "SQL", label: "SQL uitvoeren", method: "POST", path: "/2.0/sql/statements", params: [P("warehouse_id", "Warehouse-ID", { required: true }), P("statement", "SQL", { type: "text", required: true }), P("catalog", "Catalog"), P("schema", "Schema"), P("wait_timeout", "Wachten", { default: "30s" }), json("parameters", "Parameters", { placeholder: '[{"name":"id","value":"7"}]' })] },
      { id: "sql.get", resource: "SQL", label: "Statement ophalen", method: "GET", path: "/2.0/sql/statements/{{id}}", params: [path("id", "Statement-ID")] },
      { id: "warehouse.list", resource: "SQL", label: "Warehouses", method: "GET", path: "/2.0/sql/warehouses", output: "warehouses" },
      { id: "job.list", resource: "Job", label: "Jobs", method: "GET", path: "/2.1/jobs/list", output: "jobs", params: [q("name", "Naam"), q("limit", "Aantal", { default: "25" })] },
      { id: "job.run", resource: "Job", label: "Job starten", method: "POST", path: "/2.1/jobs/run-now", params: [num("job_id", "Job-ID", { required: true }), json("job_parameters", "Parameters", { placeholder: '{"datum":"2026-09-30"}' })] },
      { id: "run.get", resource: "Job", label: "Run-status", method: "GET", path: "/2.1/jobs/runs/get", params: [q("run_id", "Run-ID", { required: true })] },
      { id: "cluster.list", resource: "Cluster", label: "Clusters", method: "GET", path: "/2.0/clusters/list", output: "clusters" },
      { id: "cluster.start", resource: "Cluster", label: "Cluster starten", method: "POST", path: "/2.0/clusters/start", params: [P("cluster_id", "Cluster-ID", { required: true })] },
      { id: "me", resource: "Account", label: "Huidige gebruiker", method: "GET", path: "/2.0/preview/scim/v2/Me" }
    ] },

  // ---------------------------------------------------------------- NoSQL en caches
  { id: "mongodb", name: "MongoDB", category: "Data & opslag", description: "Documenten zoeken, invoegen, bijwerken en aggregeren", color: "#47a248", website: "https://mongodb.com", docs: "https://www.mongodb.com/docs/drivers/node/current/",
    baseUrl: DRIVER, auth: conn([secret("connectionString", "Connection string", { placeholder: "mongodb+srv://user:wachtwoord@cluster.mongodb.net" }), f("database", "Database")]), test: "collections",
    operations: [
      { id: "find", resource: "Document", label: "Zoeken", method: "POST", path: "", driver: "mongodb:find", params: [P("collection", "Collectie", { required: true }), json("filter", "Filter", { placeholder: '{"status":"open"}' }), json("projection", "Velden", { placeholder: '{"naam":1}' }), json("sort", "Sortering", { placeholder: '{"datum":-1}' }), num("limit", "Aantal", { default: 100 }), num("skip", "Overslaan")] },
      { id: "findOne", resource: "Document", label: "Eén document", method: "POST", path: "", driver: "mongodb:findOne", params: [P("collection", "Collectie", { required: true }), json("filter", "Filter", { required: true, placeholder: '{"klantId":"{{klantId}}"}' })] },
      { id: "insert", resource: "Document", label: "Invoegen", method: "POST", path: "", driver: "mongodb:insert", params: [P("collection", "Collectie", { required: true }), json("documents", "Document(en)", { required: true, placeholder: '{"naam":"Jan"}' })] },
      { id: "update", resource: "Document", label: "Bijwerken", method: "POST", path: "", driver: "mongodb:update", params: [P("collection", "Collectie", { required: true }), json("filter", "Filter", { required: true }), json("update", "Wijziging", { required: true, placeholder: '{"status":"klaar"} of {"$inc":{"teller":1}}' }), bool("upsert", "Invoegen als niet gevonden")] },
      { id: "delete", resource: "Document", label: "Verwijderen", method: "POST", path: "", driver: "mongodb:delete", params: [P("collection", "Collectie", { required: true }), json("filter", "Filter", { required: true }), bool("all", "Alles verwijderen bij leeg filter")] },
      { id: "aggregate", resource: "Document", label: "Aggregatie", method: "POST", path: "", driver: "mongodb:aggregate", params: [P("collection", "Collectie", { required: true }), json("pipeline", "Pipeline", { required: true, placeholder: '[{"$group":{"_id":"$status","n":{"$sum":1}}}]' })] },
      { id: "count", resource: "Document", label: "Tellen", method: "POST", path: "", driver: "mongodb:count", params: [P("collection", "Collectie", { required: true }), json("filter", "Filter")] },
      { id: "collections", resource: "Database", label: "Collecties", method: "GET", path: "", driver: "mongodb:collections" }
    ] },
  { id: "redis", name: "Redis", category: "Data & opslag", description: "Sleutels, hashes, lijsten en pub/sub", color: "#dc382d", website: "https://redis.io", docs: "https://redis.io/docs/latest/commands/",
    baseUrl: DRIVER, auth: conn([f("url", "Adres", { placeholder: "redis://host:6379 of rediss://…" }), secret("password", "Wachtwoord"), f("database", "Database-nummer", { placeholder: "0" })]), test: "info",
    operations: [
      { id: "get", resource: "Sleutel", label: "Waarde ophalen", method: "GET", path: "", driver: "redis:get", params: [P("key", "Sleutel", { required: true })] },
      { id: "set", resource: "Sleutel", label: "Waarde zetten", method: "POST", path: "", driver: "redis:set", params: [P("key", "Sleutel", { required: true }), P("value", "Waarde", { type: "text", required: true }), num("ttl", "Verloopt na (s)")] },
      { id: "delete", resource: "Sleutel", label: "Verwijderen", method: "POST", path: "", driver: "redis:delete", params: [P("key", "Sleutel(s), komma-gescheiden", { required: true })] },
      { id: "incr", resource: "Sleutel", label: "Ophogen", method: "POST", path: "", driver: "redis:incr", params: [P("key", "Sleutel", { required: true }), num("by", "Met", { default: 1 })] },
      { id: "keys", resource: "Sleutel", label: "Sleutels zoeken", method: "GET", path: "", driver: "redis:keys", params: [P("pattern", "Patroon", { default: "*" }), num("limit", "Max", { default: 1000 })] },
      { id: "hget", resource: "Hash", label: "Hash lezen", method: "GET", path: "", driver: "redis:hget", params: [P("key", "Sleutel", { required: true }), P("field", "Veld (leeg = alle)")] },
      { id: "hset", resource: "Hash", label: "Hash-velden zetten", method: "POST", path: "", driver: "redis:hset", params: [P("key", "Sleutel", { required: true }), json("fields", "Velden", { required: true, placeholder: '{"status":"open"}' })] },
      { id: "push", resource: "Lijst", label: "Aan lijst toevoegen", method: "POST", path: "", driver: "redis:push", params: [P("key", "Lijst", { required: true }), P("value", "Waarde", { type: "text", required: true }), P("side", "Kant", { options: ["rechts", "links"], default: "rechts" })] },
      { id: "pop", resource: "Lijst", label: "Uit lijst halen", method: "POST", path: "", driver: "redis:pop", params: [P("key", "Lijst", { required: true }), P("side", "Kant", { options: ["links", "rechts"], default: "links" })] },
      { id: "publish", resource: "Pub/sub", label: "Publiceren op kanaal", method: "POST", path: "", driver: "redis:publish", params: [P("channel", "Kanaal", { required: true }), P("message", "Bericht", { type: "text", required: true })] },
      { id: "info", resource: "Server", label: "Serverinfo", method: "GET", path: "", driver: "redis:info" }
    ] },
  { id: "azure-cosmos-db", name: "Azure Cosmos DB", category: "Data & opslag", description: "Containers en items (NoSQL API)", color: "#0078d4", website: "https://azure.microsoft.com/products/cosmos-db", docs: "https://learn.microsoft.com/rest/api/cosmos-db/",
    baseUrl: "https://{{account}}.documents.azure.com", auth: { type: "custom", signer: "azure-cosmos", fields: [f("account", "Accountnaam"), secret("accountKey", "Primaire sleutel")], help: "Azure Portal → Cosmos DB-account → Keys: accountnaam en primary key." }, test: "database.list",
    operations: [
      { id: "database.list", resource: "Database", label: "Databases", method: "GET", path: "/dbs", output: "Databases" },
      { id: "container.list", resource: "Container", label: "Containers", method: "GET", path: "/dbs/{{db}}/colls", output: "DocumentCollections", params: [path("db", "Database")] },
      { id: "query", resource: "Item", label: "Query (SQL)", method: "POST", path: "/dbs/{{db}}/colls/{{container}}/docs", contentType: "application/query+json", output: "Documents", body: { query: "{{query}}", parameters: "{{parameters}}" },
        params: [path("db", "Database"), path("container", "Container"), P("query", "Query", { type: "text", required: true, placeholder: "SELECT * FROM c WHERE c.status = @status" }), json("parameters", "Parameters", { placeholder: '[{"name":"@status","value":"open"}]' })] },
      { id: "item.get", resource: "Item", label: "Item ophalen", method: "GET", path: "/dbs/{{db}}/colls/{{container}}/docs/{{id}}", headers: { "x-ms-documentdb-partitionkey": '["{{partitionKey}}"]' }, params: [path("db", "Database"), path("container", "Container"), path("id", "Item-ID"), P("partitionKey", "Partitiesleutel", { in: "template", required: true })] },
      { id: "item.create", resource: "Item", label: "Item maken/upserten", method: "POST", path: "/dbs/{{db}}/colls/{{container}}/docs", bodyParam: "item", headers: { "x-ms-documentdb-partitionkey": '["{{partitionKey}}"]', "x-ms-documentdb-is-upsert": "{{upsert}}" },
        params: [path("db", "Database"), path("container", "Container"), json("item", "Item (met id)", { required: true, placeholder: '{"id":"7","klant":"Jan"}' }), P("partitionKey", "Partitiesleutel", { in: "template", required: true }), P("upsert", "Upsert", { in: "template", options: ["True", "False"], default: "True" })] },
      { id: "item.replace", resource: "Item", label: "Item vervangen", method: "PUT", path: "/dbs/{{db}}/colls/{{container}}/docs/{{id}}", bodyParam: "item", headers: { "x-ms-documentdb-partitionkey": '["{{partitionKey}}"]' },
        params: [path("db", "Database"), path("container", "Container"), path("id", "Item-ID"), json("item", "Item", { required: true }), P("partitionKey", "Partitiesleutel", { in: "template", required: true })] },
      { id: "item.delete", resource: "Item", label: "Item verwijderen", method: "DELETE", path: "/dbs/{{db}}/colls/{{container}}/docs/{{id}}", headers: { "x-ms-documentdb-partitionkey": '["{{partitionKey}}"]' }, params: [path("db", "Database"), path("container", "Container"), path("id", "Item-ID"), P("partitionKey", "Partitiesleutel", { in: "template", required: true })] }
    ] },

  // ---------------------------------------------------------------- berichten
  { id: "kafka", name: "Kafka", category: "Ontwikkeling", description: "Berichten op Kafka-topics zetten (ook Confluent, Redpanda, Event Hubs)", color: "#231f20", website: "https://kafka.apache.org", docs: "https://kafka.js.org/",
    baseUrl: DRIVER, auth: conn([f("brokers", "Brokers", { placeholder: "broker1:9092,broker2:9092" }), f("clientId", "Client-ID", { default: "aip" }), f("ssl", "TLS/SSL", { placeholder: "ja of nee" }), f("mechanism", "SASL-mechanisme", { placeholder: "plain, scram-sha-256, scram-sha-512" }), f("user", "SASL-gebruiker"), secret("password", "SASL-wachtwoord")]), test: "topics",
    operations: [
      { id: "send", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "", driver: "kafka:send", params: [P("topic", "Topic", { required: true }), json("message", "Bericht(en)", { required: true, placeholder: '{"orderId":"{{orderId}}"} of een array' }), P("key", "Sleutel"), json("headers", "Headers"), bool("autoCreate", "Topic aanmaken als die niet bestaat")] },
      { id: "topics", resource: "Topic", label: "Topics", method: "GET", path: "", driver: "kafka:topics" }
    ] },
  { id: "mqtt", name: "MQTT", category: "Ontwikkeling", description: "Berichten publiceren via MQTT", color: "#660066", website: "https://mqtt.org", docs: "https://github.com/mqttjs/MQTT.js",
    baseUrl: DRIVER, auth: conn([f("url", "Broker", { placeholder: "mqtt://broker:1883 of mqtts://…:8883" }), f("user", "Gebruiker"), secret("password", "Wachtwoord"), f("clientId", "Client-ID")]),
    operations: [
      { id: "publish", resource: "Bericht", label: "Publiceren", method: "POST", path: "", driver: "mqtt:publish", params: [P("topic", "Topic", { required: true, placeholder: "fabriek/lijn1/status" }), P("message", "Bericht", { type: "text", required: true }), P("qos", "QoS", { options: ["0", "1", "2"], default: "0" }), bool("retain", "Retain")] }
    ] },
  { id: "rabbitmq", name: "RabbitMQ", category: "Ontwikkeling", description: "Berichten op queues/exchanges zetten en ophalen (AMQP 0-9-1)", color: "#ff6600", website: "https://rabbitmq.com", docs: "https://amqp-node.github.io/amqplib/",
    baseUrl: DRIVER, auth: conn([secret("url", "AMQP-URL", { placeholder: "amqps://user:wachtwoord@host:5671/vhost" })]),
    operations: [
      { id: "publish", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "", driver: "rabbitmq:publish", params: [P("queue", "Queue (direct)"), P("exchange", "Of: exchange"), P("routingKey", "Routing key"), json("message", "Bericht", { required: true }), bool("persistent", "Persistent", { default: true }), json("headers", "Headers")] },
      { id: "get", resource: "Bericht", label: "Berichten ophalen", method: "POST", path: "", driver: "rabbitmq:get", params: [P("queue", "Queue", { required: true }), num("max", "Maximaal", { default: 1 })] },
      { id: "queue", resource: "Queue", label: "Queue-status", method: "GET", path: "", driver: "rabbitmq:queue", params: [P("queue", "Queue", { required: true })] }
    ] },
  { id: "amqp", name: "AMQP", category: "Ontwikkeling", description: "Berichten via AMQP 1.0 (ActiveMQ Artemis, Azure Service Bus, Solace, …)", color: "#3c6eb4", website: "https://www.amqp.org", docs: "https://github.com/amqp/rhea",
    baseUrl: DRIVER, auth: conn([f("host", "Host"), f("port", "Poort", { placeholder: "5672 (5671 met TLS)" }), f("ssl", "TLS", { placeholder: "ja of nee" }), f("user", "Gebruiker / SAS-sleutelnaam"), secret("password", "Wachtwoord / SAS-sleutel")], "Azure Service Bus: host <namespace>.servicebus.windows.net, TLS ja, gebruiker = naam van de SAS-policy, wachtwoord = sleutel."),
    operations: [
      { id: "send", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "", driver: "amqp10:send", params: [P("address", "Queue/topic (adres)", { required: true }), json("message", "Bericht", { required: true }), P("subject", "Onderwerp"), json("properties", "Application properties")] }
    ] },

  // ---------------------------------------------------------------- directory, mail, servers
  { id: "ldap", name: "LDAP", category: "Beveiliging", description: "Gebruikers en groepen in een LDAP-directory (ook Active Directory)", color: "#3a6ea5", website: "https://ldap.com", docs: "https://github.com/ldapts/ldapts",
    baseUrl: DRIVER, auth: conn([f("url", "Server", { placeholder: "ldaps://dc01.bedrijf.local:636" }), f("bindDn", "Bind-DN", { placeholder: "CN=svc-aip,OU=Service,DC=bedrijf,DC=local" }), secret("password", "Wachtwoord"), f("baseDn", "Basis-DN", { placeholder: "DC=bedrijf,DC=local" }), f("insecure", "Certificaat niet controleren", { placeholder: "nee" })]), test: "search",
    operations: [
      { id: "search", resource: "Entry", label: "Zoeken", method: "GET", path: "", driver: "ldap:search", params: [P("baseDn", "Basis-DN"), P("filter", "Filter", { default: "(objectClass=*)", placeholder: "(&(objectClass=user)(mail={{email}}))" }), P("scope", "Bereik", { options: ["sub", "one", "base"], default: "sub" }), P("attributes", "Attributen", { placeholder: "cn,mail,memberOf" }), num("limit", "Max", { default: 100 })] },
      { id: "add", resource: "Entry", label: "Toevoegen", method: "POST", path: "", driver: "ldap:add", params: [P("dn", "DN", { required: true }), json("attributes", "Attributen", { required: true, placeholder: '{"objectClass":["inetOrgPerson"],"cn":"Jan","sn":"Jansen"}' })] },
      { id: "modify", resource: "Entry", label: "Wijzigen", method: "POST", path: "", driver: "ldap:modify", params: [P("dn", "DN", { required: true }), json("attributes", "Attributen", { required: true, placeholder: '{"telephoneNumber":"0612345678"}' }), P("operation", "Bewerking", { options: ["replace", "add", "delete"], default: "replace" })] },
      { id: "rename", resource: "Entry", label: "Hernoemen/verplaatsen", method: "POST", path: "", driver: "ldap:rename", params: [P("dn", "DN", { required: true }), P("newDn", "Nieuwe DN", { required: true })] },
      { id: "delete", resource: "Entry", label: "Verwijderen", method: "POST", path: "", driver: "ldap:delete", params: [P("dn", "DN", { required: true })] },
      { id: "compare", resource: "Entry", label: "Attribuut vergelijken", method: "POST", path: "", driver: "ldap:compare", params: [P("dn", "DN", { required: true }), P("attribute", "Attribuut", { required: true }), P("value", "Waarde", { required: true })] }
    ] },
  { id: "imap", name: "E-mail (IMAP)", category: "Communicatie", description: "Binnenkomende e-mail lezen, markeren en verplaatsen", color: "#6b7280", website: "https://en.wikipedia.org/wiki/Internet_Message_Access_Protocol", docs: "https://imapflow.com/",
    baseUrl: DRIVER, auth: conn([f("host", "IMAP-server", { placeholder: "imap.bedrijf.nl" }), f("port", "Poort", { default: "993" }), f("ssl", "TLS", { placeholder: "ja (993) of nee (143)" }), f("user", "Gebruiker"), secret("password", "Wachtwoord / app-wachtwoord")]), test: "mailboxes",
    operations: [
      { id: "list", resource: "Bericht", label: "Berichten lezen", method: "GET", path: "", driver: "imap:list", params: [P("mailbox", "Map", { default: "INBOX" }), bool("unseen", "Alleen ongelezen", { default: true }), P("since", "Sinds (datum)"), P("from", "Van"), P("subject", "Onderwerp bevat"), num("limit", "Max", { default: 20 }), bool("withBody", "Met volledige inhoud (bron)"), bool("markSeen", "Als gelezen markeren")] },
      { id: "flag", resource: "Bericht", label: "Vlag zetten/weghalen", method: "POST", path: "", driver: "imap:flag", params: [P("mailbox", "Map", { default: "INBOX" }), P("uid", "UID('s)", { required: true }), P("flag", "Vlag", { default: "\\Seen", options: ["\\Seen", "\\Flagged", "\\Answered", "\\Deleted"] }), bool("remove", "Weghalen")] },
      { id: "move", resource: "Bericht", label: "Verplaatsen", method: "POST", path: "", driver: "imap:move", params: [P("mailbox", "Map", { default: "INBOX" }), P("uid", "UID('s)", { required: true }), P("to", "Naar map", { required: true })] },
      { id: "delete", resource: "Bericht", label: "Verwijderen", method: "POST", path: "", driver: "imap:delete", params: [P("mailbox", "Map", { default: "INBOX" }), P("uid", "UID('s)", { required: true })] },
      { id: "mailboxes", resource: "Map", label: "Mappen", method: "GET", path: "", driver: "imap:mailboxes" }
    ] },
  { id: "ssh", name: "SSH", category: "Cloud & infra", description: "Commando's uitvoeren op een server", color: "#1f2937", website: "https://www.openssh.com", docs: "https://github.com/mscdex/ssh2",
    baseUrl: DRIVER, auth: conn([f("host", "Host"), f("port", "Poort", { default: "22" }), f("user", "Gebruiker"), secret("password", "Wachtwoord"), secret("privateKey", "Private key (PEM/OpenSSH)"), secret("passphrase", "Passphrase")]),
    operations: [
      { id: "exec", resource: "Commando", label: "Commando uitvoeren", method: "POST", path: "", driver: "ssh:exec", params: [P("command", "Commando", { type: "text", required: true, placeholder: "systemctl status nginx" }), P("cwd", "Werkmap"), bool("failOnError", "Fout bij exitcode ≠ 0", { default: true })] }
    ] },

  // ---------------------------------------------------------------- bestanden en no-code databases
  { id: "azure-storage", name: "Azure Storage", category: "Bestanden", description: "Blobs en containers (Blob Storage)", color: "#0078d4", website: "https://azure.microsoft.com/products/storage/blobs", docs: "https://learn.microsoft.com/rest/api/storageservices/blob-service-rest-api",
    baseUrl: "https://{{account}}.blob.core.windows.net", auth: { type: "custom", signer: "azure-storage", fields: [f("account", "Storage-account"), secret("accountKey", "Toegangssleutel (Shared Key)"), secret("sasToken", "Of: SAS-token", { placeholder: "sv=…&sig=… (optioneel, i.p.v. sleutel)" })], help: "Azure Portal → Storage-account → Access keys, of een SAS-token met de nodige rechten." }, test: "container.list",
    operations: [
      { id: "container.list", resource: "Container", label: "Containers", method: "GET", path: "/?comp=list", output: "EnumerationResults.Containers.Container", params: [q("prefix", "Prefix")] },
      { id: "container.create", resource: "Container", label: "Container maken", method: "PUT", path: "/{{container}}?restype=container", params: [path("container", "Container")] },
      { id: "container.delete", resource: "Container", label: "Container verwijderen", method: "DELETE", path: "/{{container}}?restype=container", params: [path("container", "Container")] },
      { id: "blob.list", resource: "Blob", label: "Blobs", method: "GET", path: "/{{container}}?restype=container&comp=list", output: "EnumerationResults.Blobs.Blob", params: [path("container", "Container"), q("prefix", "Prefix (map/)"), q("maxresults", "Max")] },
      { id: "blob.get", resource: "Blob", label: "Blob downloaden", method: "GET", path: "/{{container}}/{{blob}}", params: [path("container", "Container"), path("blob", "Blobnaam (pad)", { format: "raw" })] },
      { id: "blob.upload", resource: "Blob", label: "Blob uploaden", method: "PUT", path: "/{{container}}/{{blob}}", bodyParam: "content", contentType: "application/octet-stream", headers: { "x-ms-blob-type": "BlockBlob", "x-ms-blob-content-type": "{{mime}}" },
        params: [path("container", "Container"), path("blob", "Blobnaam (pad)", { format: "raw" }), P("content", "Inhoud", { type: "text", required: true }), P("mime", "Content-type", { in: "template", placeholder: "application/json" })] },
      { id: "blob.delete", resource: "Blob", label: "Blob verwijderen", method: "DELETE", path: "/{{container}}/{{blob}}", params: [path("container", "Container"), path("blob", "Blobnaam (pad)", { format: "raw" })] }
    ] },
  { id: "nextcloud", name: "Nextcloud", category: "Bestanden", description: "Bestanden, mappen, delen en gebruikers", color: "#0082c9", website: "https://nextcloud.com", docs: "https://docs.nextcloud.com/server/latest/developer_manual/client_apis/",
    baseUrl: "{{url}}", fields: [urlField("Adres", "https://cloud.bedrijf.nl")], auth: { type: "basic", userLabel: "Gebruiker", passLabel: "App-wachtwoord", help: "Nextcloud → Persoonlijke instellingen → Beveiliging → App-wachtwoord maken." },
    headers: { "OCS-APIRequest": "true" }, test: "me",
    operations: [
      { id: "folder.list", resource: "Map", label: "Map-inhoud", method: "PROPFIND", path: "/remote.php/dav/files/{{user}}{{folder}}", headers: { depth: "1" }, output: "d:multistatus.d:response", params: [P("folder", "Map", { in: "path", format: "raw", default: "/", placeholder: "/Documenten" })] },
      { id: "folder.create", resource: "Map", label: "Map maken", method: "MKCOL", path: "/remote.php/dav/files/{{user}}/{{folder}}", params: [path("folder", "Map", { format: "raw" })] },
      { id: "file.upload", resource: "Bestand", label: "Bestand uploaden", method: "PUT", path: "/remote.php/dav/files/{{user}}/{{file}}", bodyParam: "content", contentType: "application/octet-stream", params: [path("file", "Pad", { format: "raw", placeholder: "Documenten/rapport.csv" }), P("content", "Inhoud", { type: "text", required: true })] },
      { id: "file.download", resource: "Bestand", label: "Bestand downloaden", method: "GET", path: "/remote.php/dav/files/{{user}}/{{file}}", params: [path("file", "Pad", { format: "raw" })] },
      { id: "file.move", resource: "Bestand", label: "Verplaatsen/hernoemen", method: "MOVE", path: "/remote.php/dav/files/{{user}}/{{file}}", headers: { destination: "{{url}}/remote.php/dav/files/{{user}}/{{to}}", overwrite: "F" }, params: [path("file", "Pad", { format: "raw" }), P("to", "Nieuw pad", { in: "template", required: true })] },
      { id: "file.copy", resource: "Bestand", label: "Kopiëren", method: "COPY", path: "/remote.php/dav/files/{{user}}/{{file}}", headers: { destination: "{{url}}/remote.php/dav/files/{{user}}/{{to}}", overwrite: "F" }, params: [path("file", "Pad", { format: "raw" }), P("to", "Kopie-pad", { in: "template", required: true })] },
      { id: "file.delete", resource: "Bestand", label: "Verwijderen", method: "DELETE", path: "/remote.php/dav/files/{{user}}/{{file}}", params: [path("file", "Pad", { format: "raw" })] },
      { id: "share.create", resource: "Delen", label: "Delen (link of gebruiker)", method: "POST", path: "/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json", bodyType: "form", output: "ocs.data",
        params: [P("path", "Pad", { required: true, placeholder: "/Documenten/rapport.pdf" }), P("shareType", "Type", { options: ["3", "0", "1", "4"], default: "3", help: "3 = openbare link, 0 = gebruiker, 1 = groep, 4 = e-mail" }), P("shareWith", "Met (gebruiker/groep/e-mail)"), P("password", "Wachtwoord"), P("expireDate", "Verloopt (JJJJ-MM-DD)"), num("permissions", "Rechten", { placeholder: "1 = lezen, 31 = alles" })] },
      { id: "user.list", resource: "Gebruiker", label: "Gebruikers", method: "GET", path: "/ocs/v1.php/cloud/users?format=json", output: "ocs.data.users", params: [q("search", "Zoeken"), q("limit", "Aantal")] },
      { id: "user.get", resource: "Gebruiker", label: "Gebruiker ophalen", method: "GET", path: "/ocs/v1.php/cloud/users/{{userid}}?format=json", output: "ocs.data", params: [path("userid", "Gebruikers-ID")] },
      { id: "user.create", resource: "Gebruiker", label: "Gebruiker maken", method: "POST", path: "/ocs/v1.php/cloud/users?format=json", bodyType: "form", output: "ocs.data", params: [P("userid", "Gebruikers-ID", { required: true }), P("email", "E-mail"), P("displayName", "Weergavenaam"), P("password", "Wachtwoord")] },
      { id: "user.delete", resource: "Gebruiker", label: "Gebruiker verwijderen", method: "DELETE", path: "/ocs/v1.php/cloud/users/{{userid}}?format=json", params: [path("userid", "Gebruikers-ID")] },
      { id: "me", resource: "Gebruiker", label: "Mijn account", method: "GET", path: "/ocs/v1.php/cloud/user?format=json", output: "ocs.data" }
    ] },
  { id: "seatable", name: "SeaTable", category: "Data & opslag", description: "Rijen in SeaTable-bases (ook SQL)", color: "#ff8000", website: "https://seatable.io", docs: "https://api.seatable.io/",
    baseUrl: "{{url}}/api-gateway/api/v2/dtables/BASE_UUID", fields: [urlField("Server", "https://cloud.seatable.io")],
    auth: { type: "custom", signer: "seatable", fields: [secret("apiToken", "API-token van de base")], help: "Open de base → … → Geavanceerd → API-token. Eén koppeling per base." }, test: "metadata",
    operations: [
      { id: "rows.list", resource: "Rij", label: "Rijen", method: "GET", path: "/rows/", output: "rows", params: [q("table_name", "Tabel", { required: true }), q("view_name", "Weergave"), q("limit", "Aantal", { default: "100" }), q("start", "Vanaf"), q("convert_keys", "Kolomnamen", { default: "true" })] },
      { id: "rows.add", resource: "Rij", label: "Rijen toevoegen", method: "POST", path: "/rows/", params: [P("table_name", "Tabel", { required: true }), json("rows", "Rijen", { required: true, placeholder: '[{"Naam":"Jan"}]' })] },
      { id: "rows.update", resource: "Rij", label: "Rijen bijwerken", method: "PUT", path: "/rows/", params: [P("table_name", "Tabel", { required: true }), json("updates", "Wijzigingen", { required: true, placeholder: '[{"row_id":"abc","row":{"Status":"Klaar"}}]' })] },
      { id: "rows.delete", resource: "Rij", label: "Rijen verwijderen", method: "DELETE", path: "/rows/", params: [P("table_name", "Tabel", { required: true }), P("row_ids", "Rij-ID's", { required: true, format: "list" })] },
      { id: "sql", resource: "SQL", label: "SQL-query", method: "POST", path: "/sql/", output: "results", params: [P("sql", "SQL", { type: "text", required: true, placeholder: "SELECT * FROM Klanten WHERE Status = 'actief'" }), bool("convert_keys", "Kolomnamen", { default: true })] },
      { id: "metadata", resource: "Base", label: "Tabellen en kolommen", method: "GET", path: "/metadata/", output: "metadata" }
    ] },
  { id: "filemaker", name: "FileMaker", category: "Data & opslag", description: "Records in FileMaker-databases (Data API)", color: "#1f6fb8", website: "https://claris.com/filemaker", docs: "https://help.claris.com/en/data-api-guide/",
    baseUrl: "{{url}}/fmi/data/vLatest/databases/{{database}}",
    auth: { type: "custom", signer: "filemaker", fields: [urlField("Server", "https://fm.bedrijf.nl"), f("database", "Database (bestand)"), f("user", "Gebruiker"), secret("password", "Wachtwoord")], help: "Gebruiker met het extended privilege fmrest (Data API)." }, test: "layouts",
    operations: [
      { id: "records.list", resource: "Record", label: "Records", method: "GET", path: "/layouts/{{layout}}/records", output: "response.data", params: [path("layout", "Layout"), q("_limit", "Aantal", { default: "100" }), q("_offset", "Vanaf")] },
      { id: "record.get", resource: "Record", label: "Record ophalen", method: "GET", path: "/layouts/{{layout}}/records/{{id}}", output: "response.data", params: [path("layout", "Layout"), path("id", "Record-ID")] },
      { id: "find", resource: "Record", label: "Zoeken", method: "POST", path: "/layouts/{{layout}}/_find", output: "response.data", params: [path("layout", "Layout"), json("query", "Zoekvragen", { required: true, placeholder: '[{"Plaats":"Utrecht"}]' }), num("limit", "Aantal")] },
      { id: "record.create", resource: "Record", label: "Record maken", method: "POST", path: "/layouts/{{layout}}/records", output: "response", params: [path("layout", "Layout"), json("fieldData", "Velden", { required: true, placeholder: '{"Naam":"Jan"}' })] },
      { id: "record.edit", resource: "Record", label: "Record bijwerken", method: "PATCH", path: "/layouts/{{layout}}/records/{{id}}", output: "response", params: [path("layout", "Layout"), path("id", "Record-ID"), json("fieldData", "Velden", { required: true })] },
      { id: "record.delete", resource: "Record", label: "Record verwijderen", method: "DELETE", path: "/layouts/{{layout}}/records/{{id}}", params: [path("layout", "Layout"), path("id", "Record-ID")] },
      { id: "script", resource: "Script", label: "Script uitvoeren", method: "GET", path: "/layouts/{{layout}}/script/{{script}}", output: "response", params: [path("layout", "Layout"), path("script", "Script"), q("script.param", "Parameter")] },
      { id: "layouts", resource: "Database", label: "Layouts", method: "GET", path: "/layouts", output: "response.layouts" }
    ] },
  { id: "stackby", name: "Stackby", category: "Data & opslag", description: "Rijen in Stackby-tabellen", color: "#4f46e5", website: "https://stackby.com", docs: "https://stackby.com/api",
    baseUrl: "https://stackby.com/api/betav1", auth: { type: "apiKey", in: "header", name: "api-key", label: "API-key" },
    operations: [
      { id: "rows.list", resource: "Rij", label: "Rijen", method: "GET", path: "/rowlist/{{stackId}}/{{table}}", params: [path("stackId", "Stack-ID"), path("table", "Tabel"), q("maxrecord", "Aantal"), q("view", "Weergave")] },
      { id: "rows.create", resource: "Rij", label: "Rijen toevoegen", method: "POST", path: "/rowcreate/{{stackId}}/{{table}}", params: [path("stackId", "Stack-ID"), path("table", "Tabel"), json("records", "Rijen", { required: true, placeholder: '[{"field":{"Naam":"Jan"}}]' })] },
      { id: "rows.update", resource: "Rij", label: "Rijen bijwerken", method: "PATCH", path: "/rowupdate/{{stackId}}/{{table}}", params: [path("stackId", "Stack-ID"), path("table", "Tabel"), json("records", "Rijen", { required: true, placeholder: '[{"id":"rw123","field":{"Status":"Klaar"}}]' })] },
      { id: "rows.delete", resource: "Rij", label: "Rijen verwijderen", method: "DELETE", path: "/rowdelete/{{stackId}}/{{table}}", params: [path("stackId", "Stack-ID"), path("table", "Tabel"), q("rowIds[]", "Rij-ID", { required: true })] }
    ] },
  { id: "odoo", name: "Odoo", category: "Financiën", description: "Contacten, kansen, facturen en elk ander model (JSON-RPC)", color: "#714b67", website: "https://odoo.com", docs: "https://www.odoo.com/documentation/18.0/developer/reference/external_api.html",
    baseUrl: DRIVER, auth: conn([urlField("Adres", "https://bedrijf.odoo.com"), f("database", "Database"), f("user", "Gebruiker (login/e-mail)"), secret("apiKey", "API-key of wachtwoord")], "Odoo → Mijn profiel → Accountbeveiliging → Nieuwe API-key."), test: "count",
    operations: [
      { id: "search", resource: "Record", label: "Zoeken en lezen", method: "POST", path: "", driver: "odoo:search", params: [P("model", "Model", { default: "res.partner", placeholder: "res.partner, crm.lead, sale.order, account.move" }), json("domain", "Domein (filter)", { placeholder: '[["is_company","=",true]]' }), P("fields", "Velden", { placeholder: "name,email,phone" }), num("limit", "Aantal", { default: 80 }), num("offset", "Vanaf"), P("order", "Sortering", { placeholder: "name asc" })] },
      { id: "read", resource: "Record", label: "Record(s) lezen", method: "POST", path: "", driver: "odoo:read", params: [P("model", "Model", { default: "res.partner" }), P("id", "ID('s)", { required: true }), P("fields", "Velden")] },
      { id: "create", resource: "Record", label: "Record maken", method: "POST", path: "", driver: "odoo:create", params: [P("model", "Model", { default: "res.partner" }), json("values", "Waarden", { required: true, placeholder: '{"name":"Jan Jansen","email":"jan@example.nl"}' })] },
      { id: "update", resource: "Record", label: "Record(s) bijwerken", method: "POST", path: "", driver: "odoo:update", params: [P("model", "Model", { default: "res.partner" }), P("id", "ID('s)", { required: true }), json("values", "Waarden", { required: true })] },
      { id: "delete", resource: "Record", label: "Record(s) verwijderen", method: "POST", path: "", driver: "odoo:delete", params: [P("model", "Model", { default: "res.partner" }), P("id", "ID('s)", { required: true })] },
      { id: "count", resource: "Record", label: "Tellen", method: "POST", path: "", driver: "odoo:count", params: [P("model", "Model", { default: "res.partner" }), json("domain", "Domein (filter)")] },
      { id: "fields", resource: "Model", label: "Velden van een model", method: "POST", path: "", driver: "odoo:fields", params: [P("model", "Model", { default: "res.partner" })] },
      { id: "method", resource: "Model", label: "Methode aanroepen", method: "POST", path: "", driver: "odoo:method", params: [P("model", "Model", { required: true }), P("method", "Methode", { required: true, placeholder: "action_confirm" }), json("args", "Argumenten", { placeholder: "[[42]]" }), json("kwargs", "Keyword-argumenten")] }
    ] },
  { id: "rss", name: "RSS-feed", category: "Content & CMS", description: "RSS- en Atom-feeds lezen", color: "#f26522", website: "https://www.rssboard.org", docs: "https://www.rssboard.org/rss-specification",
    baseUrl: "{{feedUrl}}", auth: { type: "none" },
    operations: [
      { id: "read", resource: "Feed", label: "Feed lezen", method: "GET", path: "", transform: "feed", params: [P("feedUrl", "Feed-URL", { in: "template", required: true, placeholder: "https://nos.nl/export/rss/nieuws.xml" })] }
    ] }
];
