import nodemailer from "nodemailer";
import { randomBytes } from "node:crypto";
import { persistence } from "../store";

// Systeemmail (wachtwoord vergeten, uitnodigingen). Met AIP_SMTP_URL
// (bv. smtps://gebruiker:wachtwoord@smtp.voorbeeld.nl:465) wordt echt verstuurd; afzender via
// AIP_MAIL_FROM. Zonder SMTP (ontwikkeling) komt de mail alleen in de outbox, die het
// hoofdaccount kan inzien, en in het serverlog.

export interface OutMail { id: string; to: string; subject: string; text: string; at: string; delivered: boolean; error?: string; kind?: string }

const FROM = process.env.AIP_MAIL_FROM || "AIP Integratieplatform <no-reply@aip.local>";
let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
if (process.env.AIP_SMTP_URL) transport = nodemailer.createTransport(process.env.AIP_SMTP_URL);

class Mailer {
  private outbox: OutMail[] = [];
  get smtp(): boolean { return Boolean(transport); }
  async hydrate(): Promise<void> {
    this.outbox = (await persistence.loadAll("_outbox")).map((r) => r.doc as OutMail).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
  }
  list(): OutMail[] { return this.outbox; }
  async send(to: string, subject: string, text: string, kind?: string): Promise<OutMail> {
    const m: OutMail = { id: randomBytes(6).toString("hex"), to, subject, text, at: new Date().toISOString(), delivered: false, kind };
    if (transport) {
      try { await transport.sendMail({ from: FROM, to, subject, text }); m.delivered = true; }
      catch (err) { m.error = (err as Error).message; }
    } else {
      // eslint-disable-next-line no-console
      console.info(`[mail] (geen SMTP ingesteld) aan ${to}: ${subject}\n${text}`);
    }
    this.outbox.unshift(m);
    const drop = this.outbox.splice(200);
    for (const d of drop) persistence.delete("_outbox", d.id);
    persistence.put("_outbox", m.id, m);
    return m;
  }
}
export const mailer = new Mailer();
