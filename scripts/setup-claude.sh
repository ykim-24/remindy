#!/usr/bin/env bash
#
# Wire remindy into Claude Code so the fish narrates your sessions:
#   1. Registers the `remindy` MCP server (the `remind` tool).
#   2. Adds a Stop hook that POSTs Claude's last message to the fish.
#
# Idempotent — safe to re-run. Backs up ~/.claude/settings.json before editing.
# Undo with:  bash scripts/setup-claude.sh --uninstall
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$REPO_DIR/claude/notify-fish.py"
SETTINGS="$HOME/.claude/settings.json"
MODE="${1:-install}"

PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "❌ python3 not found — it's required for the Stop hook." >&2
  exit 1
fi

# ---- 1. MCP server -------------------------------------------------------
if command -v claude >/dev/null 2>&1; then
  if [ "$MODE" = "--uninstall" ]; then
    claude mcp remove remindy -s user >/dev/null 2>&1 && echo "✓ removed remindy MCP server" || echo "· remindy MCP server not registered"
  else
    NODE="$(command -v node || echo node)"
    claude mcp remove remindy -s user >/dev/null 2>&1 || true
    claude mcp add remindy -s user -- "$NODE" "$REPO_DIR/mcp-server.js" >/dev/null 2>&1 \
      && echo "✓ registered remindy MCP server (user scope)" \
      || echo "⚠ could not register MCP server automatically — add it manually (see README)"
  fi
else
  echo "· 'claude' CLI not found — skipping MCP registration (see README for manual setup)"
fi

# ---- 2. Stop hook in settings.json ---------------------------------------
HOOK="$HOOK" SETTINGS="$SETTINGS" MODE="$MODE" "$PY" - <<'PYEOF'
import json, os, sys, shutil

settings = os.environ["SETTINGS"]
hook = os.environ["HOOK"]
mode = os.environ["MODE"]
os.makedirs(os.path.dirname(settings), exist_ok=True)

data = {}
if os.path.exists(settings):
    try:
        with open(settings) as f:
            data = json.load(f)
    except Exception:
        print("⚠ ~/.claude/settings.json is not valid JSON — not touching it.", file=sys.stderr)
        sys.exit(1)
    shutil.copy(settings, settings + ".remindy.bak")

cmd = f'python3 "{hook}" 2>/dev/null || true'
hooks = data.setdefault("hooks", {})
stop = hooks.setdefault("Stop", [])

# Drop any prior remindy entries (match on the hook filename) so we never dupe.
def is_remindy(group):
    for h in group.get("hooks", []):
        if "notify-fish.py" in h.get("command", ""):
            return True
    return False

stop[:] = [g for g in stop if not is_remindy(g)]

if mode != "--uninstall":
    stop.append({
        "matcher": "",
        "hooks": [{"type": "command", "command": cmd, "timeout": 5, "async": True}],
    })

# Clean up empty containers we may have created.
if not stop:
    hooks.pop("Stop", None)
if not hooks:
    data.pop("hooks", None)

with open(settings, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

if mode == "--uninstall":
    print("✓ removed remindy Stop hook from ~/.claude/settings.json")
else:
    print("✓ added remindy Stop hook to ~/.claude/settings.json")
PYEOF

echo
if [ "$MODE" = "--uninstall" ]; then
  echo "🐟 remindy unhooked from Claude. Restart Claude Code for it to take effect."
else
  echo "🐟 Done! Start the pet (npm start), then restart Claude Code."
  echo "   Now whenever Claude finishes a reply, the fish will say it out loud."
fi
