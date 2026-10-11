# ebXML / ebMS 2.0

De plugins `ebms`, `digipoort`, `berichtenbox`, `lopende-zaken` en `digilevering` delen een ebMS 2.0-driver. Ze ondersteunen verzending, ontvangst, duurzame inbox/outbox, duplicaatcontrole, acknowledgments, retries, meerdere MIME-bijlagen, signing, encryptie en procestriggers. Service, acties, rollen, PartyId-types, endpoints en zakelijke XML-schema's komen uit de aansluiting van de betreffende dienst.

## Configureren en activeren

1. Open **Plugins**, zoek de dienst en maak een koppeling. Configureer elke omgeving afzonderlijk.
2. Vul CPA-gegevens handmatig in of gebruik `cpa.inspect`, `cpa.validate` en `cpa.import` onder **Proberen**. Selecteer eigen PartyId, service, actie en eventueel channel/richting. Een ontvangst-only CPA kan met `direction: receive` worden geïmporteerd. Import deactiveert de koppeling voor controle van gewijzigde gegevens.
3. Vul eigen transportcertificaat met keten, private sleutel, eventuele passphrase, vertrouwde CA-keten en het exacte partnertransportcertificaat in. Voeg voor signed profielen het vertrouwde signingcertificaat van de partner toe. Eigen signingcertificaat/sleutel vallen standaard terug op transportcertificaat/sleutel. Encryptie gebruikt standaard het partner-signingcertificaat; decryptie de eigen signingsleutel. Geheimen worden versleuteld opgeslagen.
4. Gebruik `connection.check` voor lokale configuratie- en certificaatcontrole, zonder netwerkverkeer. `protocol.ping` test de partner-MSH na activatie.
5. Klik in het pluginvenster per omgeving op **Activeren**, of gebruik `connection.activate`. Hetzelfde venster toont het ontvangendpoint, inbox/outbox en berichtstatussen. Deactiveren pauzeert transport en automatische procesontvangst; opgeslagen berichten blijven behouden.

Ondersteunde profielen: `osb-be`, `osb-rm`, `osb-be-s`, `osb-rm-s`, `osb-be-e`, `osb-rm-e`. `-s` ondertekent; `-e` ondertekent én versleutelt payloads. `syncReplyMode` is `none` of `mshSignalsOnly`. Reliable messaging gebruikt configureerbare retries, interval, TimeToLive en PersistDuration. De bewaartermijn moet minstens de TTL en volledige retryperiode omvatten. `sendEnabled`, `receiveEnabled` en actie-/servicefilters begrenzen zakelijke berichten; protocolantwoorden blijven beschikbaar.

## Verzenden vanuit een proces

Voeg een **Connector**-stap toe:

```json
{
  "plugin": "berichtenbox",
  "operation": "message.send",
  "credential": "mijn-berichtenbox",
  "params": {
    "payload": "{{payload.xml}}",
    "messageId": "{{payload.ebmsMessageId}}",
    "conversationId": "{{payload.conversationId}}",
    "attachments": [
      { "contentId": "document@aip", "contentType": "application/pdf", "dataBase64": "{{payload.pdfBase64}}" }
    ]
  },
  "target": "ebmsResult"
}
```

Genereer en bewaar vooraf een unieke MessageId in de vorm `id@domein`. Hergebruik deze bij procesretries. Zonder opgegeven ID maakt iedere uitvoering een nieuw bericht. Het oorspronkelijke MIME-bericht wordt vóór verzending opgeslagen; transportretries hergebruiken exact die bytes en ID. Dezelfde ID met andere inhoud of CPA wordt geweigerd.

`message.send` kan een nog openstaande aflevering teruggeven terwijl de worker verder probeert. Gebruik `message.status` of `message.wait` en controleer `deliveryConfirmed`. `message.wait` accepteert 1–300 seconden en geeft bij overschrijding `timedOut: true`; een gefaalde aflevering geeft een fout. HTTP 200 (`transportAccepted`) bewijst uitsluitend transportacceptatie. Alleen een correct gecorreleerde acknowledgment bevestigt reliable aflevering. Ook een geldige acknowledgment bevestigt **duurzame ontvangst**, geen succesvolle zakelijke verwerking bij de partner.

## Ontvangst en procestrigger

Kies in de proceseditor de trigger **ebMS / ebXML**, selecteer de koppeling en eventueel service/actie. Deploy het proces naar de gewenste omgeving en koppel precies één agentgroep. Per bericht moet precies één gedeployed proces overeenkomen. Ontbrekende of ambigue deployments laten het bericht wachten in de inbox.

De procesinvoer bevat `payload.xml`, `attachments` met `contentId`, `contentType` en `dataBase64`, `_ebms` met correlatiegegevens en `_trigger`. De transportlaag controleert CPA, partner, handtekening, encryptie en MIME, slaat het bericht duurzaam op en geeft daarna een acknowledgment. Dubbele berichten krijgen dezelfde opgeslagen receipt en starten geen tweede proces.

Voor expliciete verwerking zijn `message.receive` (claim van vijf minuten) en `message.complete` (met geretourneerd `claimToken`) beschikbaar. Na een onderbroken procesclaim krijgt een bericht status `uncertain`; automatische herhaling zou eerdere zakelijke effecten kunnen verdubbelen. Beoordeel zulke berichten vóór `message.redrive` of de herstelknop in het pluginvenster. Een verlopen uitgaand bericht moet een nieuwe ID krijgen.

## HTTPS en mTLS

Ontvangroutes zijn `/ebms/:env/:credential` voor de hoofdorganisatie en `/o/:org/ebms/:env/:credential` voor andere organisaties. Het pluginvenster toont de volledige URL. Gebruik `AIP_PUBLIC_URL` voor de publieke hostnaam.

Directe TLS-configuratie:

```sh
AIP_TLS_CERT_FILE=/run/secrets/server-chain.pem
AIP_TLS_KEY_FILE=/run/secrets/server-key.pem
AIP_TLS_CA_FILE=/run/secrets/client-ca.pem
AIP_TLS_CRL_FILE=/run/secrets/transport-crl.pem
```

De ontvangroute vereist een door TLS gevalideerd clientcertificaat dat overeenkomt met het ingestelde partnercertificaat. Uitgaand verkeer vereist HTTPS, CA-/hostnaamcontrole en hetzelfde expliciete partnercertificaat; TLS minimaal 1.2. Redirects worden geweigerd. DNS-adressen worden gecontroleerd en tijdens de aanvraag vastgezet. De bestaande netwerkbeperkingen per organisatie blijven gelden.

Een mTLS-reverse proxy is expliciet opt-in: `AIP_EBMS_PROXY_MODE=mtls` en `AIP_EBMS_PROXY_IPS` met exacte socket-IP-adressen. Configureer per koppeling een geheim `ingressToken` van minstens 32 tekens. De proxy moet de partner valideren, aangeleverde forwardingheaders verwijderen en zelf deze headers zetten:

```text
x-ebms-ingress-token: <koppelingsgeheim>
x-ebms-client-verified: SUCCESS
x-forwarded-proto: https
x-ebms-peer-fingerprint: <SHA256-certificaatfingerprint met dubbele punten>
```

De backend accepteert deze headers uitsluitend vanaf de ingestelde proxy-IP's met het juiste geheim en partnerfingerprint. Houd de backendpoort privé.

## Opslag, beheer en implementatiegrenzen

Inbox/outbox is gescheiden per organisatie, omgeving en koppeling. Berichtinhoud, originele wire, bijlagen en receipts zijn versleuteld opgeslagen met `AIP_SECRET_KEY`; gebruik een eigen blijvende sleutel en veilige back-ups. De standaard bestandsopslag commit ontvangst atomair met fsync en ondersteunt één schrijvend platformproces. Gebruik PostgreSQL (`DATABASE_URL`) voor meerdere workers. `AIP_STORAGE=memory` is alleen voor ontwikkeling/tests en wordt voor ebMS in PROD geweigerd. De minimum-bewaartermijn staat op records; automatische verwijdering is niet geïmplementeerd.

Beheer-API: `/api/v1/ebms/:env/connections`, `/messages`, `/messages/:id`, `/messages/:id/redrive` en `/connections/:credential/activate|deactivate`. De bestaande organisatie-/omgevingsrechten gelden. Standaard geven berichtendpoints metadata terug; inhoud vereist expliciet `includePayload=true` op het detailendpoint. `message.list`, `protocol.status`, `message.build`, `message.inspect` en `message.unpack` zijn ook procesoperaties. Inspecteren/uitpakken authenticeert geen bericht.

Dit is een geïmplementeerde MSH voor de genoemde subset, geen gecertificeerde Digikoppeling-aansluiting. CPA-import voert semantische controles uit op CPPA 2.0; volledige XSD-validatie en CPA-handtekeningverificatie zijn niet geïmplementeerd. Gebruik aparte koppelingen voor verschillende channels, profielen of ambigue acties. Gegarandeerde berichtvolgorde en `signalsAndResponse` worden geweigerd.

Ondertekening ondersteunt RSA-SHA256 en SHA256-referenties naar de SOAP-envelope en alle MIME-payloads; encryptie AES256-GCM met RSA-OAEP SHA256/MGF1-SHA256. Legacy SHA1, willekeurige XPath-transforms en andere algoritmen zijn niet ondersteund. Partner-signingvertrouwen gebruikt expliciet ingestelde certificaten, geldigheidscontrole en RSA minimaal 2048 bits. PKIoverheid-beleidscontrole en intrekkingscontrole van signingcertificaten blijven operationele taken; transport ondersteunt opgegeven CA's en CRL's. Stem algoritmen, certificaatrollen en exacte CPA-afspraken af met de dienst.

De tests omvatten binary MIME, signing/encryptie, durable ontvangst, retries/restart, concurrentie, duplicaten, opslagfouten, signed receipts, asynchrone acknowledgments, procesdispatch, CPA-import, tenantisolatie en lokale HTTPS/mTLS. De PostgreSQL-implementatie is niet met een echte database getest. Er is geen live aansluiting of ketentest met Logius uitgevoerd. Zakelijke XML-schema's en dienstspecifieke processen moeten apart worden ingericht en getest.

## Controle en bronnen

`npm run typecheck`, `npm run test:ebms`, `npm run test:plugins`, `npm run test:auth` en `npm run test:apim`.

- [OASIS ebMS 2.0](https://www.oasis-open.org/committees/ebxml-msg/documents/ebMS_v2_0.pdf)
- [Digikoppeling koppelvlakstandaard ebMS2](https://gitdocumentatie.logius.nl/publicatie/dk/ebms/Digikoppeling-Koppelvlakstandaard-ebMS2.pdf)
- [W3C XML Encryption 1.1](https://www.w3.org/TR/xmlenc-core1/)
