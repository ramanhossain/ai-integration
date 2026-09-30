import type { FieldDef, PluginDef } from "../types";
import { P, json, num, path, q } from "./_shared";

// Amazon Web Services — ondertekend met AWS Signature V4 (geen SDK nodig).
const AWS_FIELDS: FieldDef[] = [
  { key: "accessKeyId", label: "Access key ID" },
  { key: "secretAccessKey", label: "Secret access key", secret: true },
  { key: "region", label: "Regio", default: "eu-west-1", placeholder: "eu-west-1, eu-central-1, …" },
  { key: "sessionToken", label: "Session token (optioneel)", secret: true }
];
const HELP = "Maak in IAM een gebruiker of rol met alleen de rechten die dit proces nodig heeft en vul de access key in.";
const J10 = "application/x-amz-json-1.0";
const J11 = "application/x-amz-json-1.1";

export const AWS: PluginDef[] = [
  {
    id: "aws-s3", name: "AWS S3", category: "Bestanden", description: "Buckets en objecten in Amazon S3", color: "#569a31",
    website: "https://aws.amazon.com/s3", docs: "https://docs.aws.amazon.com/AmazonS3/latest/API/",
    baseUrl: "https://s3.{{region}}.amazonaws.com", auth: { type: "aws", service: "s3", help: HELP }, fields: AWS_FIELDS, test: "bucket.list",
    operations: [
      { id: "bucket.list", resource: "Bucket", label: "Buckets", method: "GET", path: "/", output: "ListAllMyBucketsResult.Buckets.Bucket" },
      { id: "object.list", resource: "Object", label: "Objecten", method: "GET", path: "/{{bucket}}", output: "ListBucketResult.Contents", params: [path("bucket", "Bucket"), q("list-type", "Versie", { default: "2" }), q("prefix", "Voorvoegsel"), q("max-keys", "Aantal", { default: "1000" })] },
      { id: "object.get", resource: "Object", label: "Object lezen (tekst)", method: "GET", path: "/{{bucket}}/{{key}}", params: [path("bucket", "Bucket"), path("key", "Sleutel", { format: "raw", placeholder: "uit/order-1.json" })] },
      { id: "object.put", resource: "Object", label: "Object schrijven (tekst/JSON)", method: "PUT", path: "/{{bucket}}/{{key}}", bodyParam: "content", contentType: "application/octet-stream", params: [path("bucket", "Bucket"), path("key", "Sleutel", { format: "raw" }), P("content", "Inhoud", { type: "text", required: true })] },
      { id: "object.delete", resource: "Object", label: "Object verwijderen", method: "DELETE", path: "/{{bucket}}/{{key}}", params: [path("bucket", "Bucket"), path("key", "Sleutel", { format: "raw" })] }
    ]
  },
  {
    id: "aws-ses", name: "AWS SES", category: "Communicatie", description: "E-mail versturen via Amazon SES", color: "#dd344c",
    website: "https://aws.amazon.com/ses", docs: "https://docs.aws.amazon.com/ses/latest/APIReference-V2/",
    baseUrl: "https://email.{{region}}.amazonaws.com", auth: { type: "aws", service: "ses", help: HELP }, fields: AWS_FIELDS, test: "account",
    operations: [
      { id: "email.send", resource: "E-mail", label: "E-mail versturen", method: "POST", path: "/v2/email/outbound-emails",
        body: { FromEmailAddress: "{{from}}", Destination: { ToAddresses: "{{to}}", CcAddresses: "{{cc}}" }, Content: { Simple: { Subject: { Data: "{{subject}}", Charset: "UTF-8" }, Body: { Text: { $if: "{{text}}", Data: "{{text}}", Charset: "UTF-8" }, Html: { $if: "{{html}}", Data: "{{html}}", Charset: "UTF-8" } } } } },
        params: [P("from", "Van (geverifieerd)", { required: true }), P("to", "Aan", { format: "list", required: true }), P("cc", "Cc", { format: "list" }), P("subject", "Onderwerp", { required: true }), P("text", "Tekst", { type: "text" }), P("html", "HTML", { type: "text" })] },
      { id: "account", resource: "Account", label: "Accountstatus", method: "GET", path: "/v2/email/account" }
    ]
  },
  {
    id: "aws-sqs", name: "AWS SQS", category: "Ontwikkeling", description: "Berichten op Amazon SQS-queues", color: "#e7157b",
    website: "https://aws.amazon.com/sqs", docs: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/",
    baseUrl: "https://sqs.{{region}}.amazonaws.com", auth: { type: "aws", service: "sqs", help: HELP }, fields: AWS_FIELDS, test: "queue.list",
    operations: [
      { id: "message.send", resource: "Bericht", label: "Bericht versturen", method: "POST", path: "/", target: "AmazonSQS.SendMessage", contentType: J10, params: [P("QueueUrl", "Queue-URL", { required: true }), P("MessageBody", "Bericht", { type: "text", required: true }), num("DelaySeconds", "Vertraging (s)"), P("MessageGroupId", "Groep (FIFO)")] },
      { id: "message.receive", resource: "Bericht", label: "Berichten ophalen", method: "POST", path: "/", target: "AmazonSQS.ReceiveMessage", contentType: J10, output: "Messages", params: [P("QueueUrl", "Queue-URL", { required: true }), num("MaxNumberOfMessages", "Aantal (1-10)", { default: 10 }), num("WaitTimeSeconds", "Wachten (s)", { default: 0 })] },
      { id: "message.delete", resource: "Bericht", label: "Bericht bevestigen (verwijderen)", method: "POST", path: "/", target: "AmazonSQS.DeleteMessage", contentType: J10, params: [P("QueueUrl", "Queue-URL", { required: true }), P("ReceiptHandle", "Receipt handle", { required: true })] },
      { id: "queue.list", resource: "Queue", label: "Queues", method: "POST", path: "/", target: "AmazonSQS.ListQueues", contentType: J10, output: "QueueUrls", params: [P("QueueNamePrefix", "Voorvoegsel")] }
    ]
  },
  {
    id: "aws-sns", name: "AWS SNS", category: "Communicatie", description: "Notificaties publiceren", color: "#e7157b",
    website: "https://aws.amazon.com/sns", docs: "https://docs.aws.amazon.com/sns/latest/api/",
    baseUrl: "https://sns.{{region}}.amazonaws.com", auth: { type: "aws", service: "sns", help: HELP }, fields: AWS_FIELDS, test: "topic.list",
    operations: [
      { id: "publish", resource: "Bericht", label: "Bericht publiceren", method: "POST", path: "/", bodyType: "form", body: { Action: "Publish", Version: "2010-03-31", TopicArn: "{{topicArn}}", PhoneNumber: "{{phoneNumber}}", Subject: "{{subject}}", Message: "{{message}}" }, output: "PublishResponse.PublishResult",
        params: [P("topicArn", "Topic-ARN"), P("phoneNumber", "Of: telefoonnummer (sms)"), P("subject", "Onderwerp"), P("message", "Bericht", { type: "text", required: true })] },
      { id: "topic.list", resource: "Topic", label: "Topics", method: "POST", path: "/", bodyType: "form", body: { Action: "ListTopics", Version: "2010-03-31" }, output: "ListTopicsResponse.ListTopicsResult.Topics.member" }
    ]
  },
  {
    id: "aws-lambda", name: "AWS Lambda", category: "Cloud & infra", description: "Lambda-functies aanroepen", color: "#ed7100",
    website: "https://aws.amazon.com/lambda", docs: "https://docs.aws.amazon.com/lambda/latest/api/",
    baseUrl: "https://lambda.{{region}}.amazonaws.com", auth: { type: "aws", service: "lambda", help: HELP }, fields: AWS_FIELDS, test: "function.list",
    operations: [
      { id: "function.invoke", resource: "Functie", label: "Functie aanroepen", method: "POST", path: "/2015-03-31/functions/{{functionName}}/invocations", bodyParam: "payload", params: [path("functionName", "Functienaam of ARN"), json("payload", "Invoer", { default: {} }), P("X-Amz-Invocation-Type", "Type", { in: "header", default: "RequestResponse", options: ["RequestResponse", "Event"] })] },
      { id: "function.list", resource: "Functie", label: "Functies", method: "GET", path: "/2015-03-31/functions/", output: "Functions" }
    ]
  },
  {
    id: "aws-dynamodb", name: "AWS DynamoDB", category: "Data & opslag", description: "Items in DynamoDB-tabellen", color: "#4053d6",
    website: "https://aws.amazon.com/dynamodb", docs: "https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/",
    baseUrl: "https://dynamodb.{{region}}.amazonaws.com", auth: { type: "aws", service: "dynamodb", help: HELP }, fields: AWS_FIELDS, test: "table.list",
    operations: [
      { id: "item.put", resource: "Item", label: "Item opslaan", method: "POST", path: "/", target: "DynamoDB_20120810.PutItem", contentType: J10, params: [P("TableName", "Tabel", { required: true }), json("Item", "Item (DynamoDB-typen)", { required: true, placeholder: '{"id":{"S":"{{orderId}}"},"bedrag":{"N":"12.5"}}' })] },
      { id: "item.get", resource: "Item", label: "Item ophalen", method: "POST", path: "/", target: "DynamoDB_20120810.GetItem", contentType: J10, output: "Item", params: [P("TableName", "Tabel", { required: true }), json("Key", "Sleutel", { required: true, placeholder: '{"id":{"S":"123"}}' })] },
      { id: "item.delete", resource: "Item", label: "Item verwijderen", method: "POST", path: "/", target: "DynamoDB_20120810.DeleteItem", contentType: J10, params: [P("TableName", "Tabel", { required: true }), json("Key", "Sleutel", { required: true })] },
      { id: "query", resource: "Query", label: "Query", method: "POST", path: "/", target: "DynamoDB_20120810.Query", contentType: J10, output: "Items", params: [P("TableName", "Tabel", { required: true }), P("KeyConditionExpression", "Sleutelvoorwaarde", { required: true, placeholder: "klant = :k" }), json("ExpressionAttributeValues", "Waarden", { required: true, placeholder: '{":k":{"S":"Jansen"}}' }), num("Limit", "Aantal")] },
      { id: "scan", resource: "Query", label: "Scan", method: "POST", path: "/", target: "DynamoDB_20120810.Scan", contentType: J10, output: "Items", params: [P("TableName", "Tabel", { required: true }), num("Limit", "Aantal", { default: 100 })] },
      { id: "table.list", resource: "Tabel", label: "Tabellen", method: "POST", path: "/", target: "DynamoDB_20120810.ListTables", contentType: J10, output: "TableNames" }
    ]
  },
  {
    id: "aws-comprehend", name: "AWS Comprehend", category: "AI", description: "Tekstanalyse: taal, sentiment en entiteiten", color: "#01a88d",
    website: "https://aws.amazon.com/comprehend", docs: "https://docs.aws.amazon.com/comprehend/latest/APIReference/",
    baseUrl: "https://comprehend.{{region}}.amazonaws.com", auth: { type: "aws", service: "comprehend", help: HELP }, fields: AWS_FIELDS,
    operations: [
      { id: "sentiment", resource: "Analyse", label: "Sentiment", method: "POST", path: "/", target: "Comprehend_20171127.DetectSentiment", contentType: J11, params: [P("Text", "Tekst", { type: "text", required: true }), P("LanguageCode", "Taal", { default: "en", options: ["en", "de", "fr", "es", "it", "pt", "nl"] })] },
      { id: "language", resource: "Analyse", label: "Taal herkennen", method: "POST", path: "/", target: "Comprehend_20171127.DetectDominantLanguage", contentType: J11, output: "Languages", params: [P("Text", "Tekst", { type: "text", required: true })] },
      { id: "entities", resource: "Analyse", label: "Entiteiten", method: "POST", path: "/", target: "Comprehend_20171127.DetectEntities", contentType: J11, output: "Entities", params: [P("Text", "Tekst", { type: "text", required: true }), P("LanguageCode", "Taal", { default: "en" })] }
    ]
  },
  {
    id: "aws-rekognition", name: "AWS Rekognition", category: "AI", description: "Beeldanalyse op afbeeldingen in S3", color: "#01a88d",
    website: "https://aws.amazon.com/rekognition", docs: "https://docs.aws.amazon.com/rekognition/latest/APIReference/",
    baseUrl: "https://rekognition.{{region}}.amazonaws.com", auth: { type: "aws", service: "rekognition", help: HELP }, fields: AWS_FIELDS,
    operations: [
      { id: "labels", resource: "Afbeelding", label: "Objecten herkennen", method: "POST", path: "/", target: "RekognitionService.DetectLabels", contentType: J11, output: "Labels", body: { Image: { S3Object: { Bucket: "{{bucket}}", Name: "{{key}}" } }, MaxLabels: "{{max}}" }, params: [P("bucket", "Bucket", { required: true }), P("key", "Sleutel", { required: true }), num("max", "Max. labels", { default: 10 })] },
      { id: "text", resource: "Afbeelding", label: "Tekst in afbeelding", method: "POST", path: "/", target: "RekognitionService.DetectText", contentType: J11, output: "TextDetections", body: { Image: { S3Object: { Bucket: "{{bucket}}", Name: "{{key}}" } } }, params: [P("bucket", "Bucket", { required: true }), P("key", "Sleutel", { required: true })] }
    ]
  },
  {
    id: "aws-textract", name: "AWS Textract", category: "AI", description: "Tekst en tabellen uit documenten in S3", color: "#01a88d",
    website: "https://aws.amazon.com/textract", docs: "https://docs.aws.amazon.com/textract/latest/dg/API_Reference.html",
    baseUrl: "https://textract.{{region}}.amazonaws.com", auth: { type: "aws", service: "textract", help: HELP }, fields: AWS_FIELDS,
    operations: [
      { id: "text", resource: "Document", label: "Tekst uitlezen", method: "POST", path: "/", target: "Textract.DetectDocumentText", contentType: J11, output: "Blocks", body: { Document: { S3Object: { Bucket: "{{bucket}}", Name: "{{key}}" } } }, params: [P("bucket", "Bucket", { required: true }), P("key", "Sleutel", { required: true })] },
      { id: "expense", resource: "Document", label: "Factuur/bon analyseren", method: "POST", path: "/", target: "Textract.AnalyzeExpense", contentType: J11, output: "ExpenseDocuments", body: { Document: { S3Object: { Bucket: "{{bucket}}", Name: "{{key}}" } } }, params: [P("bucket", "Bucket", { required: true }), P("key", "Sleutel", { required: true })] }
    ]
  },
  {
    id: "aws-transcribe", name: "AWS Transcribe", category: "AI", description: "Spraak naar tekst (audio in S3)", color: "#01a88d",
    website: "https://aws.amazon.com/transcribe", docs: "https://docs.aws.amazon.com/transcribe/latest/APIReference/",
    baseUrl: "https://transcribe.{{region}}.amazonaws.com", auth: { type: "aws", service: "transcribe", help: HELP }, fields: AWS_FIELDS,
    operations: [
      { id: "job.start", resource: "Taak", label: "Transcriptie starten", method: "POST", path: "/", target: "Transcribe.StartTranscriptionJob", contentType: J11, body: { TranscriptionJobName: "{{jobName}}", LanguageCode: "{{language}}", Media: { MediaFileUri: "{{mediaUri}}" } }, params: [P("jobName", "Taaknaam (uniek)", { required: true }), P("language", "Taal", { default: "nl-NL" }), P("mediaUri", "S3-URI van audio", { required: true, placeholder: "s3://bucket/opname.mp3" })] },
      { id: "job.get", resource: "Taak", label: "Transcriptie ophalen", method: "POST", path: "/", target: "Transcribe.GetTranscriptionJob", contentType: J11, output: "TranscriptionJob", params: [P("TranscriptionJobName", "Taaknaam", { required: true })] }
    ]
  },
  {
    id: "aws-cognito", name: "AWS Cognito", category: "Beveiliging", description: "Gebruikers in user pools", color: "#dd344c",
    website: "https://aws.amazon.com/cognito", docs: "https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/",
    baseUrl: "https://cognito-idp.{{region}}.amazonaws.com", auth: { type: "aws", service: "cognito-idp", help: HELP }, fields: AWS_FIELDS,
    operations: [
      { id: "user.list", resource: "Gebruiker", label: "Gebruikers", method: "POST", path: "/", target: "AWSCognitoIdentityProviderService.ListUsers", contentType: J11, output: "Users", params: [P("UserPoolId", "User pool-ID", { required: true }), P("Filter", "Filter", { placeholder: 'email = "jan@bedrijf.nl"' }), num("Limit", "Aantal", { default: 60 })] },
      { id: "user.create", resource: "Gebruiker", label: "Gebruiker maken", method: "POST", path: "/", target: "AWSCognitoIdentityProviderService.AdminCreateUser", contentType: J11, body: { UserPoolId: "{{poolId}}", Username: "{{username}}", UserAttributes: [{ Name: "email", Value: "{{email}}" }] }, params: [P("poolId", "User pool-ID", { required: true }), P("username", "Gebruikersnaam", { required: true }), P("email", "E-mail", { required: true })] },
      { id: "user.disable", resource: "Gebruiker", label: "Gebruiker blokkeren", method: "POST", path: "/", target: "AWSCognitoIdentityProviderService.AdminDisableUser", contentType: J11, params: [P("UserPoolId", "User pool-ID", { required: true }), P("Username", "Gebruikersnaam", { required: true })] }
    ]
  },
  {
    id: "aws-iam", name: "AWS IAM", category: "Beveiliging", description: "Gebruikers, groepen en rollen", color: "#dd344c",
    website: "https://aws.amazon.com/iam", docs: "https://docs.aws.amazon.com/IAM/latest/APIReference/",
    baseUrl: "https://iam.amazonaws.com", auth: { type: "aws", service: "iam", help: `${HELP} IAM is globaal: gebruik regio us-east-1.` }, fields: AWS_FIELDS.map((f) => (f.key === "region" ? { ...f, default: "us-east-1" } : f)), test: "user.list",
    operations: [
      { id: "user.list", resource: "Gebruiker", label: "Gebruikers", method: "POST", path: "/", bodyType: "form", body: { Action: "ListUsers", Version: "2010-05-08" }, output: "ListUsersResponse.ListUsersResult.Users.member" },
      { id: "group.addUser", resource: "Groep", label: "Gebruiker aan groep toevoegen", method: "POST", path: "/", bodyType: "form", body: { Action: "AddUserToGroup", Version: "2010-05-08", GroupName: "{{group}}", UserName: "{{user}}" }, params: [P("group", "Groep", { required: true }), P("user", "Gebruiker", { required: true })] }
    ]
  },
  {
    id: "aws-certificate-manager", name: "AWS Certificate Manager", category: "Cloud & infra", description: "Certificaten bekijken", color: "#dd344c",
    website: "https://aws.amazon.com/certificate-manager", docs: "https://docs.aws.amazon.com/acm/latest/APIReference/",
    baseUrl: "https://acm.{{region}}.amazonaws.com", auth: { type: "aws", service: "acm", help: HELP }, fields: AWS_FIELDS, test: "certificate.list",
    operations: [
      { id: "certificate.list", resource: "Certificaat", label: "Certificaten", method: "POST", path: "/", target: "CertificateManager.ListCertificates", contentType: J11, output: "CertificateSummaryList" },
      { id: "certificate.get", resource: "Certificaat", label: "Certificaat-details", method: "POST", path: "/", target: "CertificateManager.DescribeCertificate", contentType: J11, output: "Certificate", params: [P("CertificateArn", "Certificaat-ARN", { required: true })] }
    ]
  },
  {
    id: "aws-elb", name: "AWS Elastic Load Balancing", category: "Cloud & infra", description: "Load balancers", color: "#8c4fff",
    website: "https://aws.amazon.com/elasticloadbalancing", docs: "https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/",
    baseUrl: "https://elasticloadbalancing.{{region}}.amazonaws.com", auth: { type: "aws", service: "elasticloadbalancing", help: HELP }, fields: AWS_FIELDS,
    operations: [{ id: "lb.list", resource: "Load balancer", label: "Load balancers", method: "POST", path: "/", bodyType: "form", body: { Action: "DescribeLoadBalancers", Version: "2015-12-01" }, output: "DescribeLoadBalancersResponse.DescribeLoadBalancersResult.LoadBalancers.member" }]
  }
];
