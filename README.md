# 🐾 remindy

A tiny draggable desktop pet — a little fish that lives on top of all your
windows. Hit its local API (or wire up your calendar) and it pops a pixelly
chat bubble over its head: a low-key reminder buddy.

It floats above everything, including other apps' native fullscreen, and has no
Dock icon or taskbar entry — just the fish.

## Install

Requires [Node.js](https://nodejs.org) (18+).

```bash
git clone https://github.com/ykim-24/remindy.git
cd remindy
npm install
npm start
```

A fish appears at the bottom-right of your screen.

- **Drag** it anywhere by clicking and holding.
- **Click** (or right-click) it to open the menu.

To update later, just use **⬆️ Update remindy** in the menu — or do it by hand:

```bash
git pull
npm install   # only if dependencies changed
```

## Menu

Click the fish to open the pixel menu:

- 📋 **Paste calendar link** — copy your private iCal URL, then click this to link it
- 📅 **Next event** / 🗓️ **Today's events** — quick calendar peeks
- 💬 **Random quote** — a little pick-me-up
- 🐟 **Next fish** — cycle through fish skins (sturgeon, goldfish, betta,
  angelfish, pufferfish, mandarin, discus, swordfish); your pick is remembered
- 🔊 **Sound** — toggle the bubble "blub"
- ⬆️ **Update remindy** — pull the latest version and restart (git clones only)
- 💤 **Dismiss bubble** / ✕ **Quit**

remindy checks GitHub for a newer version shortly after launch (and every 6h).
If your clone is behind, the fish pops a bubble — hit **⬆️ Update remindy** and
it fast-forwards to the latest, reinstalls deps if needed, and restarts itself.

## Calendar (optional)

remindy can watch a calendar and nudge you before events. Easiest way: copy your
calendar's **private iCal (.ics) URL** to the clipboard and use **📋 Paste
calendar link** in the menu — it saves to a local `config.json` for you.

Or configure it by hand:

```bash
cp config.example.json config.json
# then edit config.json with your private .ics URL
```

```jsonc
{
  "icsUrls": ["https://calendar.google.com/calendar/ical/.../basic.ics"],
  "leadMinutes": 10   // remind this many minutes before each event
}
```

`config.json` is **gitignored** — your private feed URL never leaves your machine.
The poller re-reads it every 60s, so no restart is needed after editing.

> Google Calendar: Settings → your calendar → *Integrate calendar* → **Secret
> address in iCal format**. Treat that URL like a password.

## API

The pet runs a local HTTP server on `http://127.0.0.1:4747` (override with
`REMINDY_PORT`).

```bash
# easiest test — GET
curl "http://127.0.0.1:4747/remind?message=stretch%20your%20legs"

# POST with options
curl -X POST http://127.0.0.1:4747/remind \
  -H "Content-Type: application/json" \
  -d '{"message":"stand up meeting in 5","ttl":12000}'

# health check
curl http://127.0.0.1:4747/health
```

| Field     | Type   | Default | Notes                          |
| --------- | ------ | ------- | ------------------------------ |
| `message` | string | `👋`    | Bubble text (max 280 chars)    |
| `ttl`     | number | `8000`  | How long the bubble stays (ms) |

## Claude Code integration (optional)

Make the fish **narrate your Claude Code sessions** — it pops a bubble with
Claude's last message every time Claude finishes a reply, and exposes a `remind`
tool Claude can call directly.

One command wires both up:

```bash
npm run setup-claude
```

This:

1. Registers the **`remindy` MCP server** (the `remind` tool) at user scope via
   the `claude` CLI.
2. Adds a **Stop hook** to `~/.claude/settings.json` that POSTs Claude's last
   message to the fish (`claude/notify-fish.py`).

It's idempotent (safe to re-run) and backs up your `settings.json` first. Then
keep `npm start` running and restart Claude Code. To undo it all:

```bash
npm run unsetup-claude
```

> Don't use the `claude` CLI? The hook still works — just add this to your
> `~/.claude/settings.json` by hand (use the absolute path to your clone):
>
> ```json
> {
>   "hooks": {
>     "Stop": [
>       { "matcher": "", "hooks": [{ "type": "command",
>         "command": "python3 \"/path/to/remindy/claude/notify-fish.py\" 2>/dev/null || true",
>         "timeout": 5, "async": true }] }
>     ]
>   }
> }
> ```

### MCP only

`mcp-server.js` exposes a `remind` tool over stdio that calls the HTTP API. If
you'd rather register it manually instead of using `npm run setup-claude`:

```json
{
  "mcpServers": {
    "remindy": { "command": "node", "args": ["/path/to/remindy/mcp-server.js"] }
  }
}
```

Keep `npm start` running; the MCP server just forwards to the local API.
