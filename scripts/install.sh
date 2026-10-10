#!/bin/sh
# OKB installer, run from a copy of this repository:
#
#   ./scripts/install.sh          guided: builds OKB, then `okb init` asks the rest
#   ./scripts/install.sh --yes    no questions (recommended answers)
#
# It installs nothing outside this folder by itself. `okb init` then offers, one
# question at a time: your first KB, the Claude Code plugin and an `okb` command
# on your PATH. Your Claude and shell settings are never edited.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
YES=""
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES="--yes" ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option / option inconnue : $arg (--help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  G=$(printf '\033[32m'); R=$(printf '\033[31m'); D=$(printf '\033[2m'); B=$(printf '\033[1m'); N=$(printf '\033[0m')
else
  G=""; R=""; D=""; B=""; N=""
fi
step() { printf '%s◆%s %s\n' "$G" "$N" "$1"; }
# French or English, like OKB itself: OKB_LANG, then the locale, then macOS settings.
LOC=${OKB_LANG:-${LC_ALL:-${LANG:-}}}
case "$LOC" in ''|C|C.*|POSIX) LOC=$(defaults read -g AppleLocale 2>/dev/null || echo en) ;; esac
case "$LOC" in fr*) FR=1 ;; *) FR="" ;; esac
say() { if [ -n "$FR" ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
fail() { printf '%s✖ %s%s\n  %s\n' "$R" "$1" "$N" "$2" >&2; exit 1; }

printf '\n%sOKB%s %s· %s%s\n\n' "$B" "$N" "$D" "$(say 'second brain for Claude Code and Obsidian' 'second cerveau pour Claude Code et Obsidian')" "$N"

# 1. Node 22.13 or newer, and npm.
command -v node >/dev/null 2>&1 || fail "$(say 'Node.js is missing' 'Node.js est absent')" "$(say 'Install Node 22.13 or newer (https://nodejs.org), then run this script again.' 'Installe Node 22.13 ou plus récent (https://nodejs.org), puis relance ce script.')"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || fail "$(say "Node $(node --version) is too old" "Node $(node --version) est trop ancien")" "$(say 'OKB needs Node 22.13 or newer. With nvm: nvm install 22 && nvm use 22.' 'OKB demande Node 22.13 ou plus récent. Avec nvm : nvm install 22 && nvm use 22.')"
command -v npm >/dev/null 2>&1 || fail "$(say 'npm is missing' 'npm est absent')" "$(say 'npm comes with Node.js: reinstall Node 22.13+.' 'npm est fourni avec Node.js : réinstalle Node 22.13+.')"
step "Node $(node --version)"

# 2. Dependencies and build, inside this folder only.
cd "$ROOT"
export NPM_CONFIG_UPDATE_NOTIFIER=false
npm ci --no-audit --no-fund --loglevel=error >/dev/null || fail "$(say 'Installing dependencies failed' 'L’installation des dépendances a échoué')" "$(say 'Check your network access to the npm registry, then run again.' 'Vérifie l’accès réseau au registre npm, puis relance.')"
step "$(say 'Dependencies installed' 'Dépendances installées')"
npm run --silent build >/dev/null || fail "$(say 'The build failed' 'La compilation a échoué')" "$(say 'Run npm run build to see the error.' 'Lance npm run build pour voir l’erreur.')"
step "$(say 'OKB built' 'OKB compilé') ($(node dist/cli/index.js version))"

# 3. First KB and connections, or a check when OKB is already set up.
if node dist/cli/index.js kb list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{process.exit(JSON.parse(s).kbs.length?0:1)}catch{process.exit(1)}})'; then
  step "$(say 'Already set up: checking' 'Déjà configuré : vérification')"
  # Offer the repairs here: the `okb` command may not exist yet.
  if [ -z "$YES" ] && [ -t 0 ]; then node dist/cli/index.js doctor --fix || true
  else node dist/cli/index.js doctor || true; fi
  printf '\n%s%s%s okb update\n' "$D" "$(say 'To update later:' 'Pour mettre à jour plus tard :')" "$N"
else
  printf '\n'
  exec node dist/cli/index.js init $YES
fi
