# Logos d'OKB — choix et archive

## Le choix (9 octobre 2026)

Le logo d'OKB 1.5 est **la note liée**, en dégradé, sous deux formes au choix dans
l'app (menu Apparence, ou la palette ⌘K) :

| Forme | Idée | Par défaut |
|---|---|---|
| **C1** `o—•` | une note qui en appelle une autre, sur le dégradé du thème | oui |
| **C3** `o—•` sur fond sombre | la même, sur fond profond ; la note au bout dans la couleur du thème | non |

Le dessin vit dans `web-app/src/ui/Logo.tsx` (la marque dans la page et l'icône
d'onglet) ; ses couleurs suivent le thème (Atelier violet, Classique vert, clair
ou sombre). Changer de logo par défaut = changer `DEFAULT_LOGO` dans `theme.ts`.

## L'archive

Toutes les propositions sont gardées pour pouvoir changer plus tard :

- `serie-1.html` — la première série (le graphe, les crochets, l'invite, la note
  liée, les fiches), à plat.
- `serie-2.html` — la deuxième série, retravaillée : A le graphe (A1 constellation,
  A2 losange vivant, A3 le O de notes), B l'invite (B1 `o_`, B2 `o|`, B3 `o_` sur
  la couleur), C la note liée (C1, C2 la note et ses liens, C3) ; chacune en
  dégradé ou à plat. Un bouton bascule entre les couleurs d'Atelier et de Classique.
- `svg/` — chaque variante en fichier : `<id>-<thème>-<degrade|plat>.svg` pour la
  deuxième série, `serie1-<n>-<thème>.svg` pour la première.

Ouvrir une page `.html` dans un navigateur suffit pour les revoir.
