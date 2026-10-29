# Driftline multiplayer server

Host a shared drive session in under a minute — no accounts, no port
forwarding, no configuration files.

## Quick start

1. **Install Node.js** (one time, if you don't have it): https://nodejs.org
2. **Double-click `start.bat`** (Windows) or **run `./start.sh`** (macOS/Linux)

That's it. The server will:

- install its single dependency (`ws`) on first run,
- download `cloudflared` automatically if you don't have it,
- open a free **Cloudflare quick tunnel** and print a public link like:

```
║   https://random-words-here.trycloudflare.com
```

Share that link with friends. They open Driftline, click
**Join a server**, paste the link, and they're driving in your world.

## What runs where

|                    | Server (`server.js`)                  | Browser (the game)                        |
| ------------------ | ------------------------------------ | ----------------------------------------- |
| World & rendering  | —                                    | ✓ deterministic procedural terrain         |
| Input              | —                                    | ✓ keyboard / mouse / controller           |
| Movement           | **validates** speed & teleports       | predicts locally for instant response     |
| Players            | IDs, names, rooms, join/leave        | renders remote cars + name tags           |
| State              | broadcasts 15 Hz room snapshots      | interpolates remote cars between snapshots |

The world is generated from tile coordinates (no random session seed), so
every player's terrain, roads and rivers are identical — the server only
relays and validates movement, which keeps it fast and cheap.

## Rooms

Everyone who pastes the same link joins the same room (`lobby`). To split a
server into groups, append `?room=name` to the link — e.g.
`https://xxx.trycloudflare.com/?room=friends`.

## Options

- `PORT=8787 npm start` — change the local port
- No internet? The tunnel is skipped and the server prints your LAN address
  (`http://192.168.x.x:8787`) — anyone on your Wi-Fi can join with that.

## Troubleshooting

- **"This server is full"** — rooms cap at 24 players; start a second room
  with `?room=…`.
- **No public link appeared** — the tunnel needs outbound internet; the
  server still works on your LAN.
- **Jittery remote cars** — that's the 15 Hz snapshots being interpolated;
  if your connection is poor, expect a little lag on *other* cars only.
