#!/bin/sh
# Install or update OKB's engine (the `okb` command) for this machine, from the
# OKB sources that came with the plugin: the marketplace checkout Claude Code
# keeps (~/.claude/plugins/marketplaces/<name>), or the OKB_SOURCE given. The
# engine lives in ~/.okb/app and its launcher in ~/.okb/bin/okb, which the
# plugin's bin/okb finds. Needs Node 22.13+ and npm. Prints one JSON line.
set -eu
home="${OKB_HOME:-$HOME/.okb}"
app="$home/app"
say() { printf '%s\n' "$1"; }
fail() { say "{\"ok\":false,\"error\":\"$1\"}"; exit 1; }

command -v node >/dev/null 2>&1 || fail "node-missing: install Node.js 22.13 or later (https://nodejs.org)"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || fail "node-too-old: Node $(node -v) found, 22.13 or later is needed"
command -v npm >/dev/null 2>&1 || fail "npm-missing"

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
src="${OKB_SOURCE:-}"
if [ -z "$src" ]; then
  # A checkout of the repository (plugin/scripts → repository root).
  root=$(CDPATH= cd -- "$here/../.." && pwd)
  if [ -f "$root/package.json" ] && [ -d "$root/src" ]; then src="$root"; fi
fi
if [ -z "$src" ]; then
  for m in "$HOME"/.claude/plugins/marketplaces/*; do
    if [ -f "$m/package.json" ] && [ -d "$m/src" ] && grep -q '"name": "okb"' "$m/package.json" 2>/dev/null; then src="$m"; break; fi
  done
fi
[ -n "$src" ] || fail "no-source: set OKB_SOURCE to a folder holding OKB's sources"

mkdir -p "$home/bin"
if [ "$src" != "$app" ]; then
  rm -rf "$app.next"
  mkdir -p "$app.next"
  # Copy the sources, without dependencies or build output.
  (cd "$src" && tar --exclude=./node_modules --exclude=./dist --exclude=./.git -cf - .) | (cd "$app.next" && tar -xf -)
  (cd "$app.next" && npm ci --no-audit --no-fund --loglevel=error >/dev/null && npm run build --silent >/dev/null) || fail "build-failed: see npm output in $app.next"
  rm -rf "$app.previous"
  [ -d "$app" ] && mv "$app" "$app.previous"
  mv "$app.next" "$app"
  rm -rf "$app.previous"
fi
cat > "$home/bin/okb" <<LAUNCHER
#!/bin/sh
exec node "$app/dist/cli/index.js" "\$@"
LAUNCHER
chmod +x "$home/bin/okb"
version=$(node -p "require('$app/package.json').version")
say "{\"ok\":true,\"version\":\"$version\",\"engine\":\"$app\",\"launcher\":\"$home/bin/okb\"}"
