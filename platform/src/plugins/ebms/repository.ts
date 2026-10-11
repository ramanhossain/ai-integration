import { createHash } from "node:crypto";
import { persistence } from "../../store";
import { encrypt, decrypt } from "../../connectors/credentials";
import type { EnvName } from "../../domain/environments";
import type { PackedMessage } from "./mime";
import type { InspectedMessage } from "./protocol";

export type State = "queued" | "awaiting-ack" | "delivered" | "received" | "processing" | "processed" | "uncertain" | "failed";
export interface MessageRecord {
  id: string; box: "inbox" | "outbox"; env: EnvName; credential: string; plugin: string;
  messageId: string; conversationId: string; cpaId: string; action: string; service: string;
  createdAt: string; updatedAt: string; expiresAt: string; retainUntil: string;
  state: State; attempts: number; retries: number; intervalSeconds: number; nextAttemptAt: string;
  reliable: boolean; fingerprint: string; encrypted: string;
  leaseOwner?: string; leaseUntil?: string; lastError?: string; httpStatus?: number; confirmedAt?: string;
  integration?: string; runId?: string; version?: string; responseMessageId?: string;
}
export interface MessageContent {
  message: PackedMessage;
  snapshot: Record<string, string>;
  reply?: PackedMessage;
  incoming?: InspectedMessage;
  parts?: Array<{ contentId: string; contentType: string; dataBase64: string }>;
}
const COLLECTION = "ebms-messages";
export const recordId = (box: string, env: string, credential: string, messageId: string) => createHash("sha256").update(JSON.stringify([box, env, credential, messageId])).digest("hex");
export const seal = (content: MessageContent) => encrypt(JSON.stringify(content));
export const unseal = (record: MessageRecord): MessageContent => JSON.parse(decrypt(record.encrypted));

export class MessageRepository {
  async all(): Promise<MessageRecord[]> { return (await persistence.loadAll(COLLECTION)).map(r => r.doc as MessageRecord); }
  async get(box: "inbox" | "outbox", env: EnvName, credential: string, messageId: string): Promise<MessageRecord | undefined> {
    const id = recordId(box, env, credential, messageId);
    return (await this.all()).find(r => r.id === id);
  }
  async create(record: MessageRecord): Promise<boolean> { return persistence.create(COLLECTION, record.id, record); }
  async change(record: MessageRecord, patch: Partial<MessageRecord>): Promise<MessageRecord | undefined> {
    const next = { ...record, ...patch, updatedAt: new Date().toISOString() };
    return await persistence.replace(COLLECTION, record.id, record, next) ? next : undefined;
  }
  async updateLatest(id: string, fn: (record: MessageRecord) => Partial<MessageRecord>): Promise<MessageRecord> {
    for (let i = 0; i < 12; i++) {
      const r = (await this.all()).find(r => r.id === id);
      if (!r) throw new Error("ebMS-record ontbreekt");
      const next = await this.change(r, fn(r));
      if (next) return next;
    }
    throw new Error("ebMS-record gewijzigd door andere worker; probeer opnieuw");
  }
  summary(r: MessageRecord) {
    const { encrypted, fingerprint, leaseOwner, ...metadata } = r;
    return { ...metadata, deliveryConfirmed: r.box === "outbox" && r.reliable && r.state === "delivered", transportAccepted: (r.httpStatus || 0) >= 200 && (r.httpStatus || 0) < 300 };
  }
}
