// ─────────────────────────────────────────────────────────────────────────────
// Multiplayer client — a thin WebSocket wrapper that speaks the Driftline
// server protocol. The browser stays fully in charge of graphics, terrain,
// water, lighting, animation, UI and input, and predicts its own movement
// locally; this class only ships our state out and streams everyone else's
// state back for interpolation.
// ─────────────────────────────────────────────────────────────────────────────

/** Compact per-frame movement state we publish (≈15 Hz). */
export interface LocalState {
  x: number;
  y: number;
  z: number;
  h: number; // heading, radians
  s: number; // signed speed, m/s
  st: number; // steering angle, radians
}

/** A remote player's static identity (from the roster). */
export interface RemoteInfo {
  id: string;
  name: string;
  car: string; // car spec id: sedan | suv | truck | sport
}

/** Batched snapshot row from the server: [x, y, z, heading, speed, steer]. */
export type SnapRow = [number, number, number, number, number, number];

export interface NetEvents {
  /** First message from the server — our identity is confirmed. */
  onWelcome?: (id: string, room: string) => void;
  /** Full list of players in the room (names + car choices). */
  onRoster?: (players: RemoteInfo[]) => void;
  /** One 15 Hz batch of everyone's movement states. */
  onSnap?: (states: Map<string, SnapRow>) => void;
  /** Server rejected our movement — snap to its last accepted state. */
  onFix?: (x: number, y: number, z: number, h: number) => void;
  /** Clean or dirty disconnect; safe to call twice. */
  onDown?: (reason: string) => void;
}

const STATE_HZ = 15; // publish rate; the server broadcasts at the same rate

/**
 * Turns anything a human might paste into a join link into a WebSocket URL:
 *   https://words.trycloudflare.com  →  wss://words.trycloudflare.com
 *   http://192.168.1.4:8787          →  ws://192.168.1.4:8787
 *   ws://host:1234                   →  unchanged
 * Also carries a ?room= through if present.
 */
export function parseJoinLink(raw: string): { wsUrl: string; room: string } | null {
  let text = raw.trim().replace(/^["'<]|[">']$/g, ""); // strip stray wrapping
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`; // bare host

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "ws:" && url.protocol !== "wss:") {
    return null;
  }
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  const wsUrl = `${secure ? "wss" : "ws"}://${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  return { wsUrl: wsUrl || text, room: url.searchParams.get("room")?.slice(0, 24) || "lobby" };
}

/** Random default name, e.g. "Drifter-K7". */
export function randomName(): string {
  return `Drifter-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}

export class NetClient {
  readonly name: string;
  readonly carId: string;
  /** Handlers — the game engine rebinds roster/snap/fix once it exists. */
  events: NetEvents;
  private ws: WebSocket | null = null;
  private sendTimer = 0;
  private pendState: LocalState | null = null;
  private closed = false;
  id = "";
  room = "";
  latency = 0;
  /** Latest room roster & snapshot, cached so the engine can replay them
   *  when it binds its handlers (they usually arrive before the engine
   *  finishes constructing the world). */
  lastRoster: RemoteInfo[] | null = null;
  lastSnap: Map<string, SnapRow> | null = null;

  constructor(name: string, carId: string, ev: NetEvents) {
    this.name = name || randomName();
    this.carId = carId;
    this.events = ev;
  }

  /** Connect to a parsed join link. Resolves on welcome, rejects with a
   *  human-readable message on failure. */
  connect(wsUrl: string, room: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        reject(new Error("That link doesn't look like a server address."));
        return;
      }
      this.ws = ws;

      const failTimer = window.setTimeout(() => {
        if (this.id) return;
        try {
          ws.close();
        } catch {
          /* already gone */
        }
        reject(new Error("No answer from that server — is it still running?"));
      }, 8000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ t: "join", name: this.name, car: this.carId, room }));
      };

      ws.onmessage = (e) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return;
        }
        switch (msg.t) {
          case "welcome":
            this.id = String(msg.id);
            this.room = String(msg.room);
            window.clearTimeout(failTimer);
            resolve();
            break;
          case "roster": {
            const players: RemoteInfo[] = [];
            const p = msg.p as Record<string, { n?: string; c?: string }>;
            for (const [id, v] of Object.entries(p || {})) {
              if (id !== this.id) players.push({ id, name: v?.n ?? "Driver", car: v?.c ?? "sedan" });
            }
            this.lastRoster = players;
            this.events.onRoster?.(players);
            break;
          }
          case "snap": {
            const states = new Map<string, SnapRow>();
            const p = msg.p as Record<string, SnapRow>;
            for (const [id, row] of Object.entries(p || {})) {
              if (id !== this.id && Array.isArray(row)) states.set(id, row);
            }
            this.lastSnap = states;
            this.events.onSnap?.(states);
            break;
          }
          case "fix":
            this.events.onFix?.(Number(msg.x), Number(msg.y), Number(msg.z), Number(msg.h));
            break;
          case "err":
            window.clearTimeout(failTimer);
            reject(new Error(String(msg.m) || "Server refused the connection."));
            this.close();
            break;
        }
      };

      ws.onerror = () => {
        if (!this.id) {
          window.clearTimeout(failTimer);
          reject(new Error("Couldn't reach that server. Check the link and your connection."));
        }
      };

      ws.onclose = () => {
        if (!this.id && !this.closed) {
          window.clearTimeout(failTimer);
          reject(new Error("Connection closed before joining — the server may be full or offline."));
          return;
        }
        if (!this.closed) {
          this.closed = true;
          this.events.onDown?.("Connection to the server was lost.");
        }
      };
    });
  }

  /** Queue our latest state; actually flushed at STATE_HZ by tick(). */
  publish(s: LocalState) {
    this.pendState = s;
  }

  /** Call once per animation frame. */
  tick(dt: number) {
    if (!this.ws || this.ws.readyState !== 1 || !this.pendState) return;
    this.sendTimer += dt;
    if (this.sendTimer < 1 / STATE_HZ) return;
    this.sendTimer = 0;
    const s = this.pendState;
    this.ws.send(
      JSON.stringify({ t: "state", x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), h: +s.h.toFixed(3), s: +s.s.toFixed(2), st: +s.st.toFixed(3) }),
    );
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === 1 && !!this.id;
  }

  close() {
    this.closed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}
