// Quick server-validation probe: joins like a game client, walks normally
// for a moment, then tries a 500m teleport cheat. The server should send a
// "fix" correction snapping us back.
const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:8787");
let gotFix = false;
let steps = 0;

ws.on("open", () => {
  ws.send(JSON.stringify({ t: "join", name: "ProbeBot", car: "sport", room: "lobby" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    console.log("welcome id=", msg.id);
    // walk normally for ~1.5s
    const timer = setInterval(() => {
      steps++;
      ws.send(JSON.stringify({ t: "state", x: steps * 0.5, y: 5, z: 0, h: 0, s: 7, st: 0 }));
      if (steps === 22) {
        clearInterval(timer);
        // the cheat: jump 800m sideways instantly
        console.log("sending teleport cheat…");
        ws.send(JSON.stringify({ t: "state", x: 900, y: 5, z: 0, h: 0, s: 60, st: 0 }));
      }
    }, 66);
  }
  if (msg.t === "fix") {
    gotFix = true;
    console.log(`CORRECTION RECEIVED: snap back to x=${msg.x} y=${msg.y} z=${msg.z} h=${msg.h}`);
    ws.close();
  }
});

ws.on("close", () => {
  console.log(gotFix ? "PASS: server validated & corrected the cheat" : "FAIL: no correction was sent");
  process.exit(gotFix ? 0 : 1);
});
