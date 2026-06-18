#!/usr/bin/env python3
"""Claude Code Stop hook: POST Claude's last message to the remindy desktop pet.

Reads the Stop-hook JSON from stdin, pulls the last assistant text turn out of
the transcript, trims it to a bubble-sized snippet, and fires it at the local
remindy API. Fails silently (and fast) so it never blocks Claude from finishing.

Port can be overridden with the REMINDY_PORT environment variable.
"""
import json
import os
import sys
import urllib.request

PORT = int(os.environ.get("REMINDY_PORT", "4747"))


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return

    text = ""
    tp = data.get("transcript_path")
    if tp:
        try:
            with open(tp) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    if obj.get("type") != "assistant":
                        continue
                    parts = obj.get("message", {}).get("content", [])
                    if isinstance(parts, list):
                        t = "".join(
                            p.get("text", "")
                            for p in parts
                            if isinstance(p, dict) and p.get("type") == "text"
                        ).strip()
                        if t:
                            text = t  # keep the last non-empty assistant turn
        except Exception:
            pass

    text = " ".join(text.split())  # collapse whitespace/newlines
    if not text:
        text = "done ✅"
    if len(text) > 140:
        text = text[:137] + "…"

    payload = json.dumps({"message": text, "ttl": 9000}).encode()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{PORT}/remind",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=1.5)
    except Exception:
        pass  # pet not running — no problem


if __name__ == "__main__":
    main()
