#!/bin/bash
# Adds the NeoDove MCP server to the Claude desktop app's config.
set -e
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

NPX="$(command -v npx || true)"
if [ -z "$NPX" ]; then
  echo "Node.js not found. Install it from https://nodejs.org and run this again."
  exit 1
fi

read -s -p "Paste NeoDove token: " TOKEN; echo
[ -z "$TOKEN" ] && { echo "No token entered."; exit 1; }

mkdir -p "$(dirname "$CFG")"
[ -f "$CFG" ] && cp "$CFG" "$CFG.bak" && echo "Backed up existing config to $CFG.bak"

CFG="$CFG" TOKEN="$TOKEN" NPX="$NPX" PATHV="$(dirname "$NPX"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin" node -e '
const fs = require("fs");
const p = process.env.CFG;
let c = {};
if (fs.existsSync(p)) {
  const raw = fs.readFileSync(p, "utf8").trim();
  if (raw) {
    try { c = JSON.parse(raw); }
    catch (e) { console.error("Existing config is not valid JSON - not touching it."); process.exit(1); }
  }
}
c.mcpServers = c.mcpServers || {};
c.mcpServers.neodove = {
  command: process.env.NPX,
  args: ["-y", "mcp-remote", "https://app-s2.neodove.com/neodove-mcp/mcp",
         "--header", "Authorization:${NEODOVE_AUTH}"],
  env: { NEODOVE_AUTH: "Bearer " + process.env.TOKEN, PATH: process.env.PATHV }
};
fs.writeFileSync(p, JSON.stringify(c, null, 2));
'
unset TOKEN
echo "NeoDove added. Now quit Claude completely (Cmd+Q) and reopen it."
