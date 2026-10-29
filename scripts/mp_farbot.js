// Parks a bot at a fixed position and publishes its state for ~30s — used to
// verify the far-distance outline rendering (bot sits >500m from the player).
const WebSocket = require("ws");

const X = Number(process.argv[2] || -30.8);
const Y = Number(process.argv[3] || 7.6);
const Z = Number(process.argv[4] || 600);

const ws = new WebSocket("ws://localhost:8787");
ws.on("open", () => {
  ws.send(JSON.stringify({ t: "join", name: "Faraway", car: "sport", room: "lobby" }));
});
let n = 0;
const iv = setInterval(() => {
  if (!ws.readyState || ++n > 480) {
    clearInterval(iv);
    ws.close();
    return;
  }
  ws.send(JSON.stringify({ t: "state", x: X, y: Y, z: Z, h: 0, s: 0, st: 0 }));
}, 66);
setTimeout(() => {
  clearInterval(iv);
  try {
    ws.close();
  } catch {}
  process.exit(0);
}, 32_000);
