import { randomUUID } from "node:crypto";
import { ENVIRONMENTS, type EnvName } from "../domain/environments";
import { persistence } from "../store";
import { bus } from "../events/bus";

// Ingebouwde message broker. Een queue bestaat altijd op álle omgevingen (DEV, TEST, ACC,
// PROD) met dezelfde naam; de berichten zijn per omgeving gescheiden ("dev:orders").
// Gedrag zoals bij een echte broker: at-least-once aflevering, retry met backoff en
// na MAX_ATTEMPTS naar de dead-letter queue ("<naam>.dlq"). Berichten worden
// persistent opgeslagen, dus met Postgres overleven ze een herstart.

export interface QueueMessage {
  id: string;
  env: EnvName;
  queue: string;
  body: unknown;
  headers: Record<string, string>;
  attempts: number;
  enqueuedAt: string;
  availableAt: number;
  lastError?: string;
}

type Handler = (msg: QueueMessage) => Promise<void>;

interface Stats {
  published: number;
  processed: number;
  failed: number;
}

const MAX_ATTEMPTS = Number(process.env.AIP_QUEUE_MAX_ATTEMPTS ?? 3);
const key = (env: EnvName, q: string) => `${env}:${q}`;

interface QueueDef { env: EnvName; queue: string; description?: string; createdAt: string }

class Broker {
  private defs = new Map<string, QueueDef>();
  private queues = new Map<string, QueueMessage[]>();
  private inFlight = new Map<string, Set<string>>();
  private consumers = new Map<string, { handler: Handler; concurrency: number; busy: number }>();
  private stats = new Map<string, Stats>();
  private timer: NodeJS.Timeout | null = null;

  async hydrate(): Promise<void> {
    for (const { doc } of await persistence.loadAll("queue-defs")) {
      const d = doc as QueueDef;
      this.defs.set(key(d.env, d.queue), d);
      this.q(d.env, d.queue);
    }
    for (const { doc } of await persistence.loadAll("queue-messages")) {
      const m = doc as QueueMessage;
      this.q(m.env, m.queue).push(m);
    }
    for (const list of this.queues.values()) list.sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
    // Oudere data: queues die maar op één omgeving stonden ook op de andere aanmaken.
    const names = new Set([...this.defs.values()].map((d) => d.queue).concat([...this.queues.keys()].map((k) => k.split(":").slice(1).join(":"))));
    for (const q of names) if (!q.endsWith(".dlq")) this.ensureAllEnvs(q, [...this.defs.values()].find((d) => d.queue === q)?.description);
  }

  // Zorgt dat de queue op elke omgeving bestaat (dead-letter queues ontstaan vanzelf).
  private ensureAllEnvs(queue: string, description?: string): void {
    for (const env of ENVIRONMENTS) {
      if (this.defs.has(key(env, queue))) continue;
      const d: QueueDef = { env, queue, description, createdAt: new Date().toISOString() };
      this.defs.set(key(env, queue), d);
      this.q(env, queue);
      persistence.put("queue-defs", key(env, queue), d);
    }
  }

  start(): void {
    if (!this.timer) this.timer = setInterval(() => this.pump(), 250);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private q(env: EnvName, queue: string): QueueMessage[] {
    const k = key(env, queue);
    let l = this.queues.get(k);
    if (!l) { l = []; this.queues.set(k, l); }
    return l;
  }
  private st(k: string): Stats {
    let s = this.stats.get(k);
    if (!s) { s = { published: 0, processed: 0, failed: 0 }; this.stats.set(k, s); }
    return s;
  }

  publish(env: EnvName, queue: string, body: unknown, headers: Record<string, string> = {}): QueueMessage {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(queue)) throw new Error(`Ongeldige queuenaam: ${queue}`);
    if (!queue.endsWith(".dlq") && !this.defs.has(key(env, queue))) { this.ensureAllEnvs(queue); bus.publish("queue.declared", { env, queue, envs: [...ENVIRONMENTS] }); }
    const m: QueueMessage = { id: randomUUID(), env, queue, body, headers, attempts: 0, enqueuedAt: new Date().toISOString(), availableAt: Date.now() };
    this.q(env, queue).push(m);
    persistence.put("queue-messages", m.id, m);
    this.st(key(env, queue)).published++;
    bus.publish("queue.published", { env, queue, messageId: m.id });
    setImmediate(() => this.pump());
    return m;
  }

  // Queue expliciet aanmaken (zoals in de GUI): altijd op alle omgevingen, met dezelfde naam.
  // Publiceren of een queue-trigger maakt een queue ook impliciet aan (ook op alle omgevingen).
  declare(env: EnvName, queue: string, description?: string): QueueDef & { envs: EnvName[] } {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(queue)) throw new Error(`Ongeldige queuenaam: ${queue} (letters, cijfers, . _ -)`);
    for (const e of ENVIRONMENTS) {
      const d: QueueDef = { env: e, queue, description: description ?? this.defs.get(key(e, queue))?.description, createdAt: this.defs.get(key(e, queue))?.createdAt ?? new Date().toISOString() };
      this.defs.set(key(e, queue), d);
      this.q(e, queue);
      persistence.put("queue-defs", key(e, queue), d);
    }
    bus.publish("queue.declared", { env, queue, envs: [...ENVIRONMENTS] });
    return { ...this.defs.get(key(env, queue))!, envs: [...ENVIRONMENTS] };
  }

  // Verwijderen haalt de queue (met berichten) van alle omgevingen. Geeft per omgeving het aantal verwijderde berichten.
  deleteQueue(env: EnvName, queue: string): Record<string, number> {
    const purged: Record<string, number> = {};
    for (const e of ENVIRONMENTS) {
      purged[e] = this.purge(e, queue);
      this.defs.delete(key(e, queue));
      this.queues.delete(key(e, queue));
      this.stats.delete(key(e, queue));
      persistence.delete("queue-defs", key(e, queue));
    }
    bus.publish("queue.deleted", { env, queue, envs: [...ENVIRONMENTS] });
    return purged;
  }

  // Berichten ophalen en direct bevestigen (pull). Handig om een queue als tijdelijke
  // buffer te gebruiken: het ene proces zet erop, een ander haalt ze later op.
  take(env: EnvName, queue: string, max = 1): QueueMessage[] {
    const k = key(env, queue);
    const list = this.queues.get(k) ?? [];
    const flight = this.inFlight.get(k) ?? new Set<string>();
    const now = Date.now();
    const picked = list.filter((m) => m.availableAt <= now && !flight.has(m.id)).slice(0, Math.max(1, Math.min(max, 1000)));
    for (const m of picked) { this.ack(k, m); this.st(k).processed++; }
    return picked;
  }

  subscribe(env: EnvName, queue: string, handler: Handler, concurrency = 1): () => void {
    if (!queue.endsWith(".dlq") && /^[A-Za-z0-9_.-]{1,80}$/.test(queue)) this.ensureAllEnvs(queue);
    const k = key(env, queue);
    this.consumers.set(k, { handler, concurrency: Math.max(1, concurrency), busy: 0 });
    setImmediate(() => this.pump());
    return () => { if (this.consumers.get(k)?.handler === handler) this.consumers.delete(k); };
  }

  private pump(): void {
    const now = Date.now();
    for (const [k, c] of this.consumers) {
      const list = this.queues.get(k);
      if (!list) continue;
      const flight = this.inFlight.get(k) ?? new Set<string>();
      this.inFlight.set(k, flight);
      while (c.busy < c.concurrency) {
        const m = list.find((x) => x.availableAt <= now && !flight.has(x.id));
        if (!m) break;
        flight.add(m.id);
        c.busy++;
        m.attempts++;
        c.handler(m)
          .then(() => {
            this.ack(k, m);
            this.st(k).processed++;
          })
          .catch((err: Error) => this.nack(k, m, err.message))
          .finally(() => { flight.delete(m.id); c.busy--; setImmediate(() => this.pump()); });
      }
    }
  }

  private ack(k: string, m: QueueMessage): void {
    const list = this.queues.get(k) ?? [];
    const i = list.indexOf(m);
    if (i >= 0) list.splice(i, 1);
    persistence.delete("queue-messages", m.id);
  }

  private nack(k: string, m: QueueMessage, error: string): void {
    m.lastError = error;
    this.st(k).failed++;
    if (m.attempts >= MAX_ATTEMPTS) {
      this.ack(k, m);
      const dead = this.publish(m.env, `${m.queue}.dlq`, m.body, { ...m.headers, "x-original-queue": m.queue, "x-error": error.slice(0, 300), "x-attempts": String(m.attempts) });
      bus.publish("queue.deadlettered", { env: m.env, queue: m.queue, messageId: m.id, dlqMessageId: dead.id, error });
    } else {
      m.availableAt = Date.now() + Math.min(200 * 2 ** (m.attempts - 1), 30000);
      persistence.put("queue-messages", m.id, m);
    }
  }

  list(env?: EnvName) {
    const names = new Set([...this.defs.keys(), ...this.queues.keys(), ...this.consumers.keys(), ...this.stats.keys()]);
    return [...names]
      .map((k) => {
        const [e, ...rest] = k.split(":");
        const queue = rest.join(":");
        const list = this.queues.get(k) ?? [];
        return {
          env: e as EnvName,
          queue,
          depth: list.length,
          inFlight: this.inFlight.get(k)?.size ?? 0,
          consumers: this.consumers.has(k) ? 1 : 0,
          declared: this.defs.has(k),
          description: this.defs.get(k)?.description,
          isDeadLetter: queue.endsWith(".dlq"),
          ...this.st(k)
        };
      })
      .filter((x) => !env || x.env === env)
      .sort((a, b) => (a.env + a.queue).localeCompare(b.env + b.queue));
  }

  peek(env: EnvName, queue: string, limit = 50): QueueMessage[] {
    return (this.queues.get(key(env, queue)) ?? []).slice(0, limit);
  }

  // Dead-letter berichten terugzetten naar de oorspronkelijke queue.
  redrive(env: EnvName, dlq: string): number {
    const list = [...(this.queues.get(key(env, dlq)) ?? [])];
    for (const m of list) {
      this.ack(key(env, dlq), m);
      this.publish(env, m.headers["x-original-queue"] || dlq.replace(/\.dlq$/, ""), m.body, {});
    }
    return list.length;
  }

  purge(env: EnvName, queue: string): number {
    const list = this.queues.get(key(env, queue)) ?? [];
    const n = list.length;
    for (const m of [...list]) this.ack(key(env, queue), m);
    return n;
  }
}

export const broker = new Broker();
