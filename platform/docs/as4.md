# AS4 Gateway plugin

De plugin `as4` verbindt processen met een afzonderlijk draaiende **AS4 Gateway**, via de officiële file-backendinterface. AS4 Gateway verwerkt ebMS3/AS4, SOAP, WS-Security, signing, encryptie, compressie, receipts en transportretries volgens zijn P-Modes. Het platform verwerkt duurzame aanlevering, inbox/outbox, correlatie, activatie per omgeving, binaire bijlagen en procestriggers. De bestaande ebMS 2.0-plugins blijven afzonderlijk beschikbaar.

## Gateway aansluiten

1. Installeer AS4 Gateway en de officiële file-backend volgens de AS4 Gateway-documentatie. De gateway moet afzonderlijk worden gestart en beheerd; de plugin installeert of start geen Java-server.
2. Maak op **Plugins → AS4 Gateway** een koppeling. Vul per omgeving `pmodeId`, eigen en partner-PartyId, PartyId-type, eigen en partnerrol, service, servicetype, actie en eventueel AgreementRef in. Gebruik de exacte waarden van de afgesproken P-Mode. Voor verschillende richtingen, rollen, partners of beveiligingsafspraken kunnen aparte koppelingen nodig zijn.
3. Gebruik `connection.check` om de configuratie en mappen te controleren. De operatie toont `outDirectory` en `deliveryDirectory`; deze staan ook in het pluginvenster. `configured: true` bevestigt lokale configuratie, **niet** dat AS4 Gateway draait of een P-Mode geladen heeft (`gatewayVerified: false`).
4. Configureer in AS4 Gateway een file-submitworker met `watchPath` gelijk aan `outDirectory`. Configureer de juiste P-Mode met `DefaultDelivery` naar `deliveryDirectory`, met formaat `ebms`. Laat zowel zakelijke berichten als receipts en fouten via deze delivery lopen.
5. Configureer in AS4 Gateway de AS4-endpoints, truststores/keystores, certificaten, TLS/mTLS, signing, encryptie, compressie en reception awareness volgens de partnerafspraken. Controleer de geladen P-Mode in AS4 Gateway en voer een ketentest uit.
6. Activeer de koppeling per omgeving in het pluginvenster of met `connection.activate`. Kies in een proces een **Connector**-stap voor verzending en/of een **AS4 Gateway ontvangst**-trigger voor ontvangst.

De mapstructuur wordt door het platform bepaald onder `AIP_AS4_ROOT` (standaard `platform/data/as4` bij uitvoering vanuit broncode): organisatiehash / omgeving / koppelinghash / `out` en `in`. Koppel de getoonde exacte mappen aan AS4 Gateway. Organisaties kunnen geen willekeurig lokaal pad instellen. Gebruik een eigen persistent volume, gescheiden per organisatie/omgeving/koppeling. Voor meerdere platformworkers is gedeelde spoolopslag én PostgreSQL nodig. Bestandsopslag ondersteunt één schrijvend platformproces.

Het platform schrijft met bestandsrechten 0600 en maakt mappen met 0700. Laat AS4 Gateway en het platform met dezelfde service-UID werken of richt expliciete ACL's in. Alleen het platform en de vertrouwde gateway mogen deze mappen wijzigen. Payloads staan in de spool noodzakelijkerwijs als bestanden; beveilig en versleutel het volume en de back-ups. Gebruik ook een eigen blijvende `AIP_SECRET_KEY` voor de versleutelde platformopslag. Plaats de spool buiten een webroot. Remote agents die deze connector uitvoeren moeten dezelfde beveiligde spool kunnen bereiken.

## AS4 Gateway-configuratie

Gebruik in `conf/workers.xml` de file-submitworker. De locatie wordt in AS4 Gateway geëvalueerd; bij containers kan de mountlocatie verschillen van het platformpad.

```xml
<worker name="submitFromFileWorker" interval="10" activate="true" delay="5"
        workerClass="org.holodeckb2b.backend.file.SubmitOperation">
  <parameter name="watchPath">/gateway-volume/koppeling/out</parameter>
</worker>
```

Voeg aan de juiste P-Mode-leg de delivery toe:

```xml
<DefaultDelivery xmlns="http://holodeck-b2b.org/schemas/2014/10/pmode">
  <DeliveryMethod>org.holodeckb2b.backend.file.NotifyAndDeliverOperation</DeliveryMethod>
  <Parameter><name>format</name><value>ebms</value></Parameter>
  <Parameter><name>deliveryDirectory</name><value>/gateway-volume/koppeling/in</value></Parameter>
</DefaultDelivery>
```

Configureer voor de verzendende kant receipt-notificaties:

```xml
<Receipt xmlns="http://holodeck-b2b.org/schemas/2014/10/pmode">
  <NotifyReceiptToBusinessApplication>true</NotifyReceiptToBusinessApplication>
</Receipt>
```

Plaats elementen in de volgorde van de AS4 Gateway P-Mode-XSD. Stel ook de toepasselijke `ErrorHandling` in zodat definitieve fouten en ontbrekende receipts worden gemeld. Een ontvangende P-Mode gebruikt bijvoorbeeld `Receipt/ReplyPattern=RESPONSE` of een afgesproken callback. Controleer dat specifieke ReceiptDelivery/ErrorDelivery-instellingen de gewenste DefaultDelivery niet overschrijven. Gebruik relatieve payloadlocaties in de file-delivery, of absolute locaties die voor het platform naar dezelfde ontvangmap wijzen. AS4-netwerkverkeer gaat naar **AS4 Gateway**, niet naar een nieuwe HTTP-AS4-route in het platform.

`pmode.inspect` toont ID, MEP/binding, adressen en indicaties van signing/encryptie/compressie. Het is geen volledige XSD- of beveiligingsvalidatie. De plugin schrijft geen P-Mode of sleutels naar de gateway; beheer die in AS4 Gateway.

## Verzenden in een proces

```json
{
  "type": "connector",
  "config": {
    "plugin": "as4",
    "operation": "message.send",
    "credential": "mijn-as4-gateway",
    "params": {
      "payload": "{{payload.xml}}",
      "contentType": "application/xml",
      "messageId": "{{payload.as4MessageId}}",
      "conversationId": "{{payload.conversationId}}",
      "properties": { "documentType": "voorbeeld" },
      "attachments": [
        { "contentId": "document@aip", "contentType": "application/pdf", "dataBase64": "{{payload.pdfBase64}}" }
      ]
    },
    "target": "as4Result"
  }
}
```

Gebruik voor een binaire hoofdpayload `dataBase64` in plaats van `payload`. De plugin ondersteunt maximaal 100 payloads en samen maximaal 20 MiB aan gedecodeerde inhoud. Alle uitgaande payloads worden als attachments aangeboden. Properties zijn objecten met tekstwaarden. `sendActions` en `receiveActions` zijn komma-gescheiden toestemmingslijsten; zonder lijst wordt de standaardactie gebruikt. Ontvangservice en servicetype kunnen afzonderlijk worden ingesteld. `sendEnabled` en `receiveEnabled` begrenzen zakelijke berichten.

Maak en bewaar vooraf een wereldwijd unieke MessageId (`id@domein`) als het proces retries kan uitvoeren. Hergebruik dezelfde ID en inhoud bij een procesretry. Zonder ID ontstaat iedere keer een nieuw bericht. De plugin schrijft eerst een versleuteld outboxrecord, daarna alle payloadbestanden, en publiceert als laatste atomair een `.mmd`-bestand. De MMD bevat relatieve payloadpaden en `deleteFilesAfterSubmit=false`. Dezelfde ID met andere inhoud/configuratie wordt geweigerd.

`message.build` geeft AS4 Gateway-submissionmetadata (MMD) en payloads terug, zonder publicatie. Dit is geen ondertekende AS4-wire-envelope; die maakt AS4 Gateway.

## Status, receipts en herstel

| Status | Betekenis |
| --- | --- |
| `queued` | Duurzaam opgeslagen, nog niet gepubliceerd |
| `publishing` | Spoolpublicatie geclaimd |
| `submitted` | MMD beschikbaar voor AS4 Gateway |
| `accepted` | AS4 Gateway heeft de submission geaccepteerd |
| `delivered` | Een gecorreleerde partnerreceipt is door AS4 Gateway aangeleverd |
| `received` | Zakelijk bericht duurzaam in de platforminbox |
| `processing` | Door proces of expliciete consumer geclaimd |
| `processed` | Proces geslaagd of claim expliciet afgerond |
| `failed` | Afwijzing door AS4 Gateway, definitieve protocolfout of gefaald proces |
| `uncertain` | Onderbroken publicatie/verwerking; beoordeling nodig |

`accepted` bevestigt uitsluitend gatewayacceptatie. `deliveryConfirmed=true` volgt alleen op een receipt uit de vertrouwde AS4 Gateway-delivery met een bekend `RefToMessageId`. AS4 Gateway is verantwoordelijk voor authenticatie en protocolvalidatie van die receipt. De file-backend geeft een receipttype door en bewaart hier geen volledige cryptografische bewijsvoering; raadpleeg daarvoor AS4 Gateway. Een receipt bewijst ontvangst bij de partner-MSH, geen geslaagde zakelijke verwerking.

Gebruik `message.status`, `message.list` of het pluginvenster. `message.wait` wacht 1–300 seconden op bevestiging; bij timeout komt `timedOut=true`, bij `failed`/`uncertain` een fout. De achtergrondworker scant ongeveer elke twee seconden; `message.scan` en **Nu inlezen** starten een scan direct.

AS4 Gateway beheert de transportretries. Bij een onzekere publicatie publiceert het platform niet automatisch opnieuw: gatewayconsumptie en platformopslag hebben geen gezamenlijke transactie. Controleer de MMD/accepted/rejected/processing-bestanden en AS4 Gateway-status. Uitgaand herstel loopt via AS4 Gateway; maak alleen na beoordeling een nieuw bericht met nieuwe ID. Deactiveren stopt nieuwe platformaanlevering en ontvangstverwerking, maar annuleert geen berichten die AS4 Gateway al heeft geaccepteerd.

## Ontvangst in een proces

Kies **AS4 Gateway ontvangst**, selecteer de AS4-koppeling en eventueel service-/actiefilters, deploy naar de omgeving en koppel precies één agentgroep. Er moet precies één actief proces overeenkomen. Een gepauzeerd of ontbrekend/ambigu proces laat de inbox wachten.

De invoer bevat:

- `payload.dataBase64` en `payload.contentType` voor de eerste payload;
- `payload.xml` voor XML-/tekstinhoud;
- `attachments` voor de overige payloads;
- `_as4` met MessageId, ConversationId, P-Mode, service, actie, koppeling en berichtproperties;
- `_trigger` met type `as4` en omgeving.

De plugin controleert namespaces, P-Mode, partijen, rollen, service, actie en lokale payloadpaden. DTD/entities en externe payloadlocaties worden geweigerd. Herlevering met hetzelfde ID en dezelfde inhoud start geen tweede proces. Gewijzigde inhoud onder dezelfde ID wordt afgewezen.

De ebms-file-delivery bevat MIME-informatie als `MimeType`-partproperty. Ontbreekt die, dan worden attachmentbytes als `application/octet-stream` doorgegeven; SOAP-bodypayloads worden als XML behandeld. Bij eigen verzending voegt de plugin de `MimeType`-property toe.

Als alternatief geeft `message.receive` één claim van vijf minuten terug. Rond die af met `message.complete` en het `claimToken`. Na een onderbroken/verlopen claim wordt het bericht `uncertain`; er volgt geen automatische replay. `message.redrive` en de herstelknop bieden alleen gefaalde/onzekere **inbox**-berichten opnieuw aan. Beoordeel eerst eerdere zakelijke effecten.

De ledger en spoolbestanden worden niet automatisch verwijderd. Richt retentie en onderhoud in; behoud duplicaatgegevens minstens gedurende de afgesproken retry-/bewaarperiode. De standaard gitignore sluit de AS4-spool uit.

## Beheer-API en tests

Authenticatie en bestaande omgevingsrechten gelden voor:

- `GET /api/v1/as4/:env/connections`
- `POST /api/v1/as4/:env/connections/:credential/activate|deactivate|scan`
- `GET /api/v1/as4/:env/messages` en `/messages/:id`
- `POST /api/v1/as4/:env/messages/:id/redrive`

Lijsten tonen metadata. Het detailendpoint levert inhoud uitsluitend met `includePayload=true`. Inbox/outbox en spoolmappen zijn per organisatie, omgeving en koppeling gescheiden. Een bestandsopslagfout voorkomt publicatie; beschadigde berichtenopslag verhindert starten.

Controle: `npm run typecheck`, `npm run test:as4`, `npm run test:ebms`, `npm run test:plugins`, `npm run test:auth`, `npm run test:apim`. De AS4-tests simuleren de officiële file-backendinterface en controleren binaire bijlagen, durable publicatie, concurrentie, receipts/fouten, duplicaten, padbeveiliging, claims, procesdispatch, activatie en metadata-API's. Er is geen echte AS4 Gateway-Java-instance, PostgreSQL-cluster of externe AS4-partner getest. Certificering, P-Mode-conformiteit en interoperabiliteit vereisen afzonderlijke ketentests.

## Bronnen

- [AS4 Gateway](https://github.com/holodeck-b2b/Holodeck-B2B)
- [Officiële file-backend API](https://github.com/holodeck-b2b/file-backend/blob/master/api_specification.md)
- [MMD XML-schema](https://github.com/holodeck-b2b/file-backend/blob/master/src/main/resources/xsd/messagemetadata.xsd)
- [AS4 Gateway getting started](https://holodeck-b2b.org/documentation/getting-started/)
- [P-Mode-schema](https://github.com/holodeck-b2b/Holodeck-B2B/blob/master/modules/holodeckb2b-core/src/main/resources/xsd/pmode.xsd)

De plugin implementeert de gedocumenteerde bestandsinterface. AS4 Gateway-componenten worden niet in het platform ingebed; de gateway blijft een afzonderlijk beheerde applicatie.
