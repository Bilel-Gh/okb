# Phase B — refonte visuelle et React : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Une nouvelle application web en React + TypeScript, dans le monde « plan de métro », qui couvre les parcours quotidiens et les fonctions de la phase A, l'ancienne application restant joignable pour les pages pas encore migrées.

**Architecture:** `web-app/` (Vite + React 18 + TS) se construit dans `web/app/` (ignoré par Git, inclus dans le paquet npm). Le serveur actuel sert `web/app/index.html` sur `/` quand il existe, l'ancienne application sur `/classic`. Routage par `#/…` (mêmes adresses qu'avant). Données par l'API existante (TanStack Query), textes par `/api/i18n`. Aucune ressource externe : polices Fira auto-hébergées.

**Tech Stack:** React 18, Vite, TypeScript, @tanstack/react-query, @tanstack/react-virtual, Radix (hover card, popover, dialog), cmdk, lucide-react, @fontsource Fira Sans / Fira Code, vitest + happy-dom + Testing Library.

**Spec:** `PRODUCT.md`, `.impeccable/surfaces/web-app-index-html.md` (contrat de direction), `docs/design/audit-2026-10-09.md`, roadmap §2.C, §2.D, §3.1–3.3, §5.1, §7, §9.

**Exécution :** Native (moi), tests d'abord sur les composants à logique, vérification dans le navigateur à chaque page, relecture finale Impeccable (finish reviewer) puis DESIGN.md (documenter).

## Global Constraints

- Hors ligne : aucune police, image ou script d'Internet ; CSP actuelle (`script-src 'self'`) respectée : pas de script en ligne.
- Tout changement passe par l'API avec le jeton de session ; aucune approbation automatique.
- Clavier partout, focus visible, noms accessibles ; contraste AA clair et sombre ; mouvement réduit respecté.
- Emoji de catégories gardés dans le contenu ; icônes d'interface en SVG (lucide).
- Aucun bord coloré latéral > 1 px, pas de tuiles de chiffres comme structure, pas d'étiquette au-dessus d'un titre.
- `npm run release:check` vert ; l'ancienne application reste accessible sur `/classic`.

## Review Focus

1. Une note très longue ou sans titre : le lecteur et le sommaire ne cassent pas.
2. 5 000 notes : la liste de l'explorateur reste fluide (virtualisée).
3. Un appel d'API qui échoue (serveur arrêté, 403 jeton) : message clair et bouton « réessayer », pas d'écran blanc.
4. Mobile 375 px : lire une note sans faire défiler la liste ; aucun débordement horizontal.
5. Langue anglaise : aucun texte en dur en français dans l'interface.

---

### Task 1: Échafaudage et intégration au build

- Create: `web-app/{index.html,vite.config.ts,tsconfig.json,src/main.tsx}`; Modify: `package.json` (scripts `build`, `typecheck`, devDeps), `.gitignore` (`web/app/`), `src/web/server.ts` (`/` → `web/app/index.html` si présent, `/classic` → ancienne page, types `.woff`), `tests/web.test.ts`.
- [ ] test : le serveur sert la nouvelle page sur `/` quand `web/app/index.html` existe, l'ancienne sur `/classic`, et l'ancienne sur `/` sinon.
- [ ] `npm run build` produit `web/app/index.html` + `web/app/assets/*` sans script en ligne ; `smoke:package` vert.
- [ ] commit.

### Task 2: Design system (jetons, polices, composants de base)

- Create: `web-app/src/styles/{tokens.css,base.css,components.css}`, `web-app/src/ui/*` (Button, Badge, LineDot, LineStrip, Card sans imbrication, EmptyState, ErrorState, Skeleton, Kbd), `tests/web-app/ui.test.tsx`.
- [ ] tests : `LineStrip` rend une station par étape et marque la courante (`aria-current="location"`) ; `KnowledgeLine` place le repère au bon palier.

### Task 3: Coquille, navigation, palette ⌘K, i18n, erreurs

- Create: `web-app/src/app/{App.tsx,router.ts,api.ts,i18n.ts,Shell.tsx,Palette.tsx}`.
- Six destinations : Aujourd'hui · Cerveau · Repos · Apprendre · Graphe (classique) · Réglages ; plus Modules et « Claude Code » en bas du rail ; sélecteur de cerveau.
- [ ] tests : `router` lit `#/note/<chemin>` et `#/notes?q=` ; une route inconnue va à l'ancienne application.

### Task 4: Aujourd'hui

- Ce qui attend un oui (suggestions + propositions), reprendre (dernières notes), cartes à réviser, objectif ; carte du cerveau en petit (tiroirs en lignes).

### Task 5: Cerveau (explorateur) et lecteur

- Arbre des tiroirs (repliable, nombres) · liste virtualisée avec recherche et filtres (catégorie, type, statut, 🔒) · aperçu/lecture.
- Lecteur : ligne de la note (fil d'Ariane en stations), en-tête sobre, sommaire, liens, bulle des concepts (phrase courte seulement), bouton Traduire (estimation, « En bref », toute la note, enregistrer en proposition), historique.
- Mobile : liste → lecture plein écran avec retour.

### Task 6: Repos, Modules, « Claude Code »

- Repos : chaque repo (relié ou non) avec sa ligne de connaissance, palier, 3 prochains pas ; relier un dossier.
- Modules : cœur et modules, activer, installer dans Claude Code.
- « Utiliser OKB dans Claude Code » : ce que ça apporte, tutoriel, bouton Installer.

### Task 7: Apprendre, Suggestions/À relire, Réglages

- Apprendre (cartes FSRS, carte des compétences) ; Suggestions et propositions (diff, approbation) ; Réglages (formulaire généré depuis `/api/settings`).

### Task 8: Finition

- Contrôles en un lot (bureau + mobile, clair + sombre), détecteur Impeccable, finish reviewer, documenter (DESIGN.md), docs utilisateur, release:check, commit.
