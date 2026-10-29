#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
 * Driftline multiplayer server
 *
 * One file, one dependency (`ws`). It is the authority for the room:
 *   · manages connections, player IDs, names and room membership
 *   · validates movement (speed caps, teleport checks) and corrects cheaters
 *   · broadcasts room state to every connected player at 15 Hz
 *
 * It also opens an automatic Cloudflare quick tunnel so the host gets a
 * public join link without port forwarding or accounts. If `cloudflared`
 * isn't installed, this script downloads it for you.
 *
 * Run:   npm install && npm start      (or ./start.sh)
 * ──────────────────────────────────────────────────────────────────────────── */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8787);
const TICK_HZ = 15; // state broadcast rate
const MAX_PLAYERS_PER_ROOM = 24;
const MAX_SPEED = 70; // m/s — universal cap (~252 km/h), above any car's top speed
const SNAP_HISTORY = 240; // states kept for interpolation (≈16 s)

// ── rooms & players ──────────────────────────────────────────────────────────
/** @type {Map<string, Map<string, Player>>} roomId -> (playerId -> Player) */
const rooms = new Map();

let nextId = 0;
function makeId() {
  nextId = (nextId + 1) % 0xffff;
  return `p${Date.now().toString(36).slice(-4)}${nextId.toString(36)}`;
}

class Player {
  constructor(ws) {
    this.ws = ws;
    this.id = makeId();
    this.name = `Driver-${this.id.slice(-3).toUpperCase()}`;
    this.carId = "sedan";
    this.room = null;
    /** last movement state the server accepted */
    this.ok = null; // {x,y,z,h}
    /** latest (possibly clamped) state, broadcast as-is */
    this.state = null; // {x,y,z,h,s,st}
    this.joinedAt = Date.now();
    this.stateCount = 0; // rate-limit window counter
    this.windowStart = Date.now();
    this.corrections = 0;
  }
}

function roomOf(roomId) {
  let r = rooms.get(roomId);
  if (!r) {
    r = new Map();
    rooms.set(roomId, r);
  }
  return r;
}

function rosterMsg(room) {
  const p = {};
  for (const pl of room.values()) p[pl.id] = { n: pl.name, c: pl.carId };
  return JSON.stringify({ t: "roster", p });
}

function broadcast(room, data, exceptId) {
  const msg = typeof data === "string" ? data : JSON.stringify(data);
  for (const pl of room.values()) {
    if (exceptId && pl.id === exceptId) continue;
    if (pl.ws.readyState === 1) pl.ws.send(msg);
  }
}

// ── movement validation ──────────────────────────────────────────────────────
/**
 * The world is deterministic (identical on every client), so the server only
 * needs sanity bounds, not a full physics replay:
 *   · speed above MAX_SPEED            → clamp & warn once
 *   · impossible position jump         → correct back to last accepted spot
 *   · NaN / out-of-world coordinates   → correct
 * Returns true when the state was accepted (possibly clamped).
 */
function validateMove(pl, s) {
  const ok = pl.ok || { x: s.x, y: s.y, z: s.z, h: s.h };

  // hard sanity
  if (
    ![s.x, s.y, s.z, s.h, s.s, s.st].every((v) => Number.isFinite(v)) ||
    Math.abs(s.x) > 1e6 ||
    Math.abs(s.z) > 1e6 ||
    Math.abs(s.y) > 500
  ) {
    correct(pl, ok);
    return false;
  }

  // speed cap
  if (Math.abs(s.s) > MAX_SPEED) s.s = Math.sign(s.s) * MAX_SPEED;

  // teleport check — allowed distance grows with elapsed time
  const now = Date.now();
  const elapsed = Math.max((now - (pl.lastMoveAt || now)) / 1000, 1 / TICK_HZ);
  pl.lastMoveAt = now;
  const allowed = MAX_SPEED * elapsed * 2 + 4; // generous slack for lag spikes
  const dist = Math.hypot(s.x - ok.x, s.z - ok.z);
  if (dist > allowed) {
    if (dist > allowed * 4 || pl.corrections >= 3) {
      // gross violation — snap them back
      correct(pl, ok);
      return false;
    }
    pl.corrections++;
    correct(pl, ok);
    return false;
  }

  // accepted
  pl.corrections = 0;
  pl.ok = { x: s.x, y: s.y, z: s.z, h: s.h };
  return true;
}

function correct(pl, ok) {
  pl.corrections++;
  if (pl.corrections > 6) return; // don't spam a flailing client forever
  if (pl.ws.readyState === 1) {
    pl.ws.send(JSON.stringify({ t: "fix", x: ok.x, y: ok.y, z: ok.z, h: ok.h }));
  }
}

// ── HTTP: friendly landing page for people who open the link directly ───────
const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, players: countPlayers() }));
    return;
  }
  const room = new URL(req.url || "/", `http://${req.headers.host}`).searchParams.get("room") || "lobby";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(landingPage(room));
});

function countPlayers() {
  let n = 0;
  for (const r of rooms.values()) n += r.size;
  return n;
}

function landingPage(room) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Driftline server</title>
<style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:ui-sans-serif,system-ui,sans-serif;background:linear-gradient(#f8f3e9,#e9e2cf);color:#44403c}
  .card{max-width:480px;padding:40px 44px;background:#fff9;border-radius:24px;
    box-shadow:0 24px 60px -30px rgba(68,64,60,.35);text-align:center}
  h1{margin:0 0 6px;font-size:26px;color:#292524}p{line-height:1.6;color:#78716c;font-size:14px}
  .link{margin:18px 0;padding:12px 16px;background:#292524;color:#f6efe2;border-radius:14px;
    font-family:ui-monospace,monospace;font-size:13px;word-break:break-all;user-select:all}
  .ok{color:#3f6212;font-weight:600}
</style></head><body><div class="card">
<h1>🛞 Driftline multiplayer server</h1>
<p class="ok">This server is running${countPlayers() ? ` — ${countPlayers()} player${countPlayers() > 1 ? "s" : ""} online` : ""}.</p>
<p>This link isn't a website — it's the address other players use to <b>join your drive</b>.</p>
<div class="link">${room === "lobby" ? "this link, pasted into Driftline" : `?room=${room}`}</div>
<p><b>To join from the game:</b> open Driftline, press <b>“Join a server”</b>, paste this page's link, and connect. Room: <b>${room}</b>.</p>
</div></body></html>`;
}

// ── WebSocket layer ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws) => {
  const pl = new Player(ws);
  let joined = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.t) {
      case "join": {
        if (joined) return;
        const room = typeof msg.room === "string" && msg.room.trim() ? msg.room.trim().slice(0, 24) : "lobby";
        const rm = roomOf(room);
        if (rm.size >= MAX_PLAYERS_PER_ROOM) {
          ws.send(JSON.stringify({ t: "err", m: "This server is full." }));
          ws.close();
          return;
        }
        pl.room = room;
        pl.name = sanitizeName(msg.name) || pl.name;
        pl.carId = ["sedan", "suv", "truck", "sport"].includes(msg.car) ? msg.car : "sedan";
        rm.set(pl.id, pl);
        joined = true;
        ws.send(JSON.stringify({ t: "welcome", id: pl.id, room, tick: TICK_HZ }));
        // tell everyone (including the newcomer) who is in the room
        broadcast(rm, rosterMsg(rm));
        console.log(`[+] ${pl.name} (${pl.id}) joined "${room}" — ${rm.size} online`);
        break;
      }

      case "state": {
        if (!joined || pl.room === null) return;
        // rate limit: 40 states/sec is already 2.5x the expected rate
        const now = Date.now();
        if (now - pl.windowStart > 1000) {
          pl.windowStart = now;
          pl.stateCount = 0;
        }
        if (++pl.stateCount > 40) return;

        const s = { x: +msg.x, y: +msg.y, z: +msg.z, h: +msg.h, s: +msg.s, st: +msg.st };
        if (validateMove(pl, s)) {
          pl.state = s;
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    if (joined && pl.room !== null) {
      const rm = rooms.get(pl.room);
      if (rm) {
        rm.delete(pl.id);
        if (rm.size === 0) rooms.delete(pl.room);
        else broadcast(rm, rosterMsg(rm));
      }
      console.log(`[-] ${pl.name} (${pl.id}) left "${pl.room}"`);
    }
  });

  ws.on("error", () => {});
});

// dead-connection watchdog
setInterval(() => {
  for (const rm of rooms.values()) {
    for (const pl of rm.values()) {
      if (pl.ws.readyState === 1) pl.ws.ping();
    }
  }
}, 30_000);

// ── broadcast loop: batched 15 Hz snapshot per room ─────────────────────────
setInterval(() => {
  for (const rm of rooms.values()) {
    const p = {};
    let n = 0;
    for (const pl of rm.values()) {
      if (!pl.state) continue;
      p[pl.id] = [pl.state.x, pl.state.y, pl.state.z, pl.state.h, pl.state.s, pl.state.st];
      n++;
    }
    if (n > 0) {
      const payload = JSON.stringify({ t: "snap", p });
      for (const pl of rm.values()) {
        if (pl.ws.readyState === 1) pl.ws.send(payload);
        else if (pl.ws.readyState > 1) rm.delete(pl.id);
      }
    }
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => {
  printBanner();
  startTunnel();
});

// ── console niceties ────────────────────────────────────────────────────────
function printBanner() {
  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║        Driftline multiplayer server is running       ║");
  console.log("  ╠══════════════════════════════════════════════════════╣");
  for (const line of localAddresses()) {
    console.log("  ║  " + line.padEnd(52) + "║");
  }
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log("");
}

function localAddresses() {
  const lines = [`Local:   http://localhost:${PORT}`];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) {
        lines.push(`LAN:     http://${net.address}:${PORT}`);
        break;
      }
    }
  }
  return lines;
}

function sanitizeName(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

// ── automatic Cloudflare quick tunnel ────────────────────────────────────────
/**
 * Quick tunnels are free, account-less and need no port forwarding:
 *   cloudflared tunnel --url http://localhost:8787
 * prints a random https://<something>.trycloudflare.com URL. We find (or
 * download) the binary, spawn it, scrape the URL from its output and print
 * it as the join link. If the tunnel can't start we keep serving locally.
 */
async function startTunnel() {
  let bin;
  try {
    bin = await findCloudflared();
  } catch (err) {
    console.log("  ⚠  No public link (cloudflared unavailable: " + err.message + ")");
    console.log("     Players on your network can still join via the LAN address above.\n");
    return;
  }
  if (!bin) {
    console.log("  ⚠  No public link (couldn't fetch cloudflared).");
    console.log("     Players on your network can still join via the LAN address above.\n");
    return;
  }

  console.log("  ⇢  Opening a public tunnel (this takes ~10 seconds)…");
  const child = spawn(
    bin,
    ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate", "--protocol", "http2"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let found = false;
  const pick = (chunk) => {
    if (found) return;
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk));
    if (m) {
      found = true;
      const link = m[0];
      console.log("");
      console.log("  ╔══════════════════════════════════════════════════════╗");
      console.log("  ║          Share this link to invite players           ║");
      console.log("  ╠══════════════════════════════════════════════════════╣");
      console.log("  ║                                                      ║");
      console.log(("  ║   " + link).padEnd(55) + "   ║");
      console.log("  ║                                                      ║");
      console.log("  ║   Paste it under “Join a server” in Driftline.       ║");
      console.log("  ╚══════════════════════════════════════════════════════╝");
      console.log("");
    }
  };
  child.stdout.on("data", pick);
  child.stderr.on("data", pick);
  child.on("error", () => {});
  child.on("exit", () => {
    if (!found) {
      console.log("  ⚠  Tunnel exited before producing a link — serving LAN only.\n");
    }
  });
}

async function findCloudflared() {
  const local = path.join(__dirname, "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  // 1. already downloaded
  if (fs.existsSync(local)) return local;
  // 2. on PATH
  try {
    execFileSync(
      process.platform === "win32" ? "cloudflared.exe" : "cloudflared",
      ["--version"],
      { stdio: "ignore", timeout: 5000 },
    );
    return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  } catch {
    /* not installed */
  }
  // 3. download it (needs internet; failure is non-fatal)
  return downloadCloudflared(local);
}

async function downloadCloudflared(dest) {
  const base = "https://github.com/cloudflare/cloudflared/releases/latest/download/";
  let url;
  let needsExtract = false;
  if (process.platform === "win32") {
    url = base + "cloudflared-windows-amd64.exe";
  } else if (process.platform === "darwin") {
    url = base + (process.arch === "arm64" ? "cloudflared-darwin-arm64.tgz" : "cloudflared-darwin-amd64.tgz");
    needsExtract = true;
  } else {
    url = base + (process.arch === "arm64" ? "cloudflared-linux-arm64" : "cloudflared-linux-amd64");
  }

  console.log("  ⇢  Downloading cloudflared (one-time, ~30 MB)…");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (needsExtract) {
    const tgz = dest + ".tgz";
    fs.writeFileSync(tgz, buf);
    execFileSync("tar", ["-xzf", tgz, "-C", path.dirname(dest)]);
    fs.unlinkSync(tgz);
  } else {
    fs.writeFileSync(dest, buf);
    fs.chmodSync(dest, 0o755);
  }
  if (!fs.existsSync(dest)) throw new Error("extract produced no binary");
  console.log("  ✓  cloudflared ready");
  return dest;
}
