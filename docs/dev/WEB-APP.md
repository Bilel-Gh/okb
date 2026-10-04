# Application web locale — architecture et sécurité

`okb serve` lance un serveur Node sur `127.0.0.1` (port 4317 par défaut, `--port`
pour un autre, `--no-open` pour ne pas ouvrir le navigateur). La page est une
alternative complète au terminal : même moteur, mêmes garde-fous, mêmes messages.
Guide utilisateur : [application-web.md](../guide/application-web.md).

## Organisation

| Partie | Rôle |
|---|---|
| `src/web/server.ts` | HTTP, contrôles d’origine, jeton, fichiers statiques, erreurs JSON |
| `src/web/api.ts` | Routes `GET` (lecture) et `POST` (actions), une fonction par route |
| `src/web/render.ts` | Markdown → HTML assaini (unified, remark-gfm, rehype-sanitize) |
| `src/web/presence.ts` | Confirmation de présence pour approuver depuis la page |
| `web/` | Application sans framework : `index.html`, `app.css`, modules ES dans `js/` |
| `tests/web.test.ts` | Garanties de sécurité et parcours de bout en bout |

Le front est un routeur à hash (`#/review`, `#/note/<chemin>`…), un helper `h()`
pour construire le DOM, une palette ⌘K, un thème clair/sombre. Les textes viennent
de `/api/i18n` (les mêmes catalogues que le CLI). Mermaid est servi localement
depuis `/vendor/mermaid.js` ; aucune ressource externe.

Chaque requête relit la configuration du profil : un réglage changé dans la page
ou dans le terminal s’applique sans redémarrer le serveur.

## Garanties

- **Écoute locale seulement.** `127.0.0.1`, Host exact (anti-rebinding DNS),
  `Origin` et `Sec-Fetch-Site` contrôlés : une page d’un autre site ne peut ni lire
  ni écrire.
- **Jeton par session.** Toute écriture (`POST`) exige l’en-tête `X-OKB-Token`
  obtenu par `/api/session` ; corps JSON uniquement, taille bornée.
- **CSP stricte.** `script-src 'self'`, pas de script inline, `frame-ancestors 'none'`.
- **Notes rendues comme des données.** HTML brut supprimé, liens `javascript:`
  retirés, liens internes réécrits vers l’application, images distantes non chargées.
- **Pas de chemin arbitraire.** Seules les notes de la KB enregistrée sont lisibles ;
  `..`, liens symboliques et dossier `.okb/` refusés. Les erreurs ne divulguent ni
  pile ni chemin absolu.
- **Aperçu exact.** Une proposition est affichée avec le `materializeFile` du CLI ;
  si la KB a changé depuis sa préparation, l’aperçu est refusé (`E_STALE`).

## Approuver depuis la page

L’approbation reste un acte humain. Le bouton « Approuver » déclenche une
confirmation que l’agent qui pilote HTTP ne peut pas donner :

1. **macOS** : un dialogue natif (`osascript display dialog`) sur l’écran de la
   personne, avec le titre, le nombre de fichiers et la KB.
2. **Ailleurs**, si `okb serve` tourne dans un vrai terminal : une question oui/non
   dans ce terminal.
3. **Sinon** (`OKB_WEB_APPROVAL=off`, pas de terminal) : la page affiche la commande
   `okb review <n>` à lancer soi-même.

Le hook du plugin refuse en plus, côté Claude : un appel scripté à
`/api/…/approve`, un clic scripté sur le dialogue, un pseudo-terminal autour de
`okb review`. Limite honnête : cela protège contre un agent qui appelle l’API, pas
contre un logiciel qui contrôle la souris et le clavier de la personne.

## Tester

```bash
npx vitest run tests/web.test.ts
OKB_HOME=/tmp/okb-demo okb serve --port 4399 --no-open   # avec une KB fictive
```

Les tests n’ouvrent jamais de dialogue (`OKB_WEB_APPROVAL=off` dans la
configuration de vitest ; la confirmation est simulée).
