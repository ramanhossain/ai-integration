import { EventEmitter } from "node:events";
import { scoped } from "../tenancy/context";

// Centrale event-bus. Elke statuswijziging in het platform wordt hier gepubliceerd,
// zodat agents, de GUI en externe systemen erop kunnen reageren (via SSE of, later,
// een echte message broker). Machine-first: elk event heeft een stabiel type + payload.

export interface PlatformEvent {
  id: number;
  type: string; // bv. "approval.created", "approval.approved", "action.executed"
  at: string;
  data: Record<string, unknown>;
}

class Bus extends EventEmitter {
  private seq = 0;

  publish(type: string, data: Record<string, unknown>): PlatformEvent {
    const event: PlatformEvent = { id: this.seq++, type, at: new Date().toISOString(), data };
    this.emit("event", event);
    return event;
  }

  onEvent(listener: (e: PlatformEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}

export const bus = scoped("bus", () => new Bus());
