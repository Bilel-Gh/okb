# Coût et qualité : mesurer, puis optimiser

OKB ne paie aucun modèle lui-même : tout le travail d'IA passe par Claude Code.
Ce qui coûte, ce sont les tokens que les skills OKB font lire et écrire à Claude.
On mesure deux choses ensemble, car une économie qui abîme la rédaction n'en est
pas une.

## Comment le coût se forme

À chaque réponse, Claude relit tout le contexte de la conversation. Grâce au
cache, ce qui a déjà été lu coûte beaucoup moins cher.

| Poste | Prix (Opus 5.5) | Ce qui le fait grossir |
|---|---|---|
| lecture depuis le cache | 0,20 $ / M | taille du contexte × nombre de réponses |
| mise en cache (1 h) | 8 $ / M | tout texte nouveau : sources, sorties `okb`, skills |
| lecture sans cache | 4 $ / M | le cache a expiré (pause de plus d'une heure) |
| écriture | 20 $ / M | dossier d'analyse, notes, messages |

Sonnet 5.5 coûte la moitié d'Opus 5.5, sauf la lecture depuis le cache, au même
prix (0,20 $ / M). Haiku 4.5 coûte le quart. Prix publics du 4 octobre 2026
(`src/usage/prices.ts`).

Les leviers sont donc :
- moins de texte nouveau, à chaque sortie et chaque instruction ;
- moins d'allers-retours ;
- un modèle moins cher là où il ne rédige pas.

## Mesurer l'usage réel, sans token

`okb usage` et la page Utilisation lisent les journaux de Claude Code
(`~/.claude/projects/<projet>/<session>.jsonl` et `…/subagents/`).

- **Une réponse est comptée une fois.** Claude Code écrit une ligne par bloc de
  réponse, toutes avec le même `usage`. Une session reprise recopie aussi des
  lignes déjà écrites, avec le même `uuid`.
- **Le découpage se fait par tâche.** Une tâche va d'un message de la personne au
  suivant. Elle est « OKB » si elle lance un skill ou une commande `okb:`, ou un
  sous-agent `okb:`. Un appel au CLI seul compte aussi, dans une session qui
  utilise OKB ou sur une KB.
- **Le développement d'OKB n'est pas compté** : une tâche qui modifie le code
  d'OKB lui-même, ni les appels au CLI d'une session de développement.
- **Les sous-agents sont rattachés à la tâche qui les a lancés**, par
  `toolUseId`.
- **Un cache par fichier** (taille et date) : un journal déjà lu n'est pas relu.

La qualité se lit dans les propositions et leurs reçus (`src/usage/quality.ts`) :
- les changements écartés à la relecture, par type ;
- les annulations ;
- le délai de relecture ;
- les fichiers appliqués dont le contenu a changé depuis, sans nouvelle
  proposition, c'est-à-dire retouchés à la main.

## Mesurer un changement : le banc d'essai

`scripts/bench.mjs` lance un vrai workflow avec `claude -p`, dans un bac à sable :
- un `OKB_HOME` à lui ;
- une KB neuve ;
- le plugin de ce dépôt ;
- `--setting-sources project,local`, sans les réglages ni les plugins de
  l'utilisateur.

**Rien n'y est approuvé** : le hook bloque toute approbation, et les seuls
outils permis sont `Read`, `Glob`, `Grep`, `Write`, `Edit`, `Skill`, `Agent` et
`Bash(okb …)`.

Deux cas fictifs, dans `tests/bench/` :
- **`atelier-lyon-gerland`** : une réunion de 18 minutes. Elle contient :
  - 22 faits attendus ;
  - une correction tardive (6 h et non 8 h d'autonomie) ;
  - un sigle que personne ne connaît (RLQ) ;
  - une ancienne règle remplacée ;
  - une confusion corrigée (DRX n'est pas un pipeline).
- **`onboard-orders-service`** : le repo SAP CAP fictif des tests, avec 19 faits
  attendus.

Chaque essai produit :
- le coût, total et par modèle, donné par Claude Code ;
- le même découpage que `okb usage`, tâche par tâche ;
- les **faits retrouvés** et les **erreurs interdites**, vérifiés par des
  expressions régulières sur le texte proposé (les citations `>` exclues) ;
- le nombre de notes, de concepts et de mots.

La rédaction est comparée **à l'aveugle** : un modèle sans outils juge deux
propositions sur l'exactitude, la complétude, la clarté et la structure. Il juge
dans les deux ordres ; un verdict qui change d'ordre compte comme « partagé ».

```bash
node scripts/bench.mjs run --out /tmp/bench/A --model opus
```

```bash
node scripts/bench.mjs run --out /tmp/bench/B --model opus --agents-model sonnet
```

```bash
node scripts/bench.mjs judge --a /tmp/bench/A --b /tmp/bench/B
```

```bash
node scripts/bench.mjs table /tmp/bench/A /tmp/bench/B
```

Le banc dépense de vrais tokens (le compte Claude de la personne) : il ne fait
jamais partie de `release:check`. Un essai d'import coûte de l'ordre d'un à
quelques dollars en équivalent API. Il faut que `claude auth status` indique
une connexion.

## Mesures

### Sorties des commandes (sans modèle, 4 octobre 2026)

Ce que les commandes lues pendant un import renvoient à Claude, sur la KB fictive :

| Commande | Avant (JSON indenté) | Après (JSON compact) |
|---|---:|---:|
| `okb template list --json` | 15 092 octets | 8 901 (−41 %) |
| `okb ingest … --extract-only --json` (réunion de 18 min) | 15 093 | 11 664 (−23 %) |
| `okb style --json` | 2 294 | 2 156 (−6 %) |
| `okb profile --json` | 545 | 473 (−13 %) |

Le JSON reste indenté dans un terminal ; il est compact quand Claude ou un
programme le lit (`src/cli/output.ts`). Les données sont identiques : aucune
perte possible.

Instructions chargées par un import :
- `okb-ingest/SKILL.md` : ~1 800 tokens ;
- le contrat du dossier : ~1 500 tokens ;
- l'agent relecteur : ~530 tokens.

`okb template list` en texte fait 1 345 octets, contre 8 901 en JSON compact :
le skill d'import n'a pas besoin du JSON.

### Essais réels

À compléter avec `scripts/bench.mjs`. Chaque ligne : modèle principal, modèle des
sous-agents, coût, faits retrouvés, erreurs interdites, verdict à l'aveugle
contre la référence (tout sur Opus).

## Décisions

- **La rédaction reste sur le modèle principal.** Les notes, le dossier
  d'analyse et les choix de modèle de note sont écrits par la conversation
  principale, sur le modèle choisi par la personne.
- **Les sous-agents qui cherchent des preuves** (`okb-extractor`,
  `okb-repo-explorer`) peuvent tourner sur un modèle moins cher : chaque citation
  qu'ils rapportent est revérifiée mot pour mot par le CLI. Ce changement ne se
  fait qu'après un essai sur le banc qui montre autant de faits retrouvés et
  aucune erreur de plus.
- **Le relecteur des preuves** (`okb-evidence-reviewer`) reste sur un modèle
  fort : c'est le garde-fou.
- **Aucune mesure ne dépense de token** : pas de hook qui injecte des chiffres,
  pas de skill de statistiques. `okb usage`, `okb report` et la page Utilisation
  lisent des fichiers locaux.
