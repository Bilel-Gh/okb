# Logos d'OKB — choix et archive

## Le choix (9 octobre 2026)

Le choix n'est pas arrêté : **toutes les propositions restent disponibles** dans
l'app (menu Apparence, ou la palette ⌘K), chacune **en dégradé ou à plat**. Par
défaut : **C1, la note liée** `o—•`, en dégradé.

Le dessin de chaque logo vit dans `web-app/src/ui/Logo.tsx` (la marque dans la page
et l'icône d'onglet) ; ses couleurs suivent le thème (Atelier violet, Classique
vert). Changer le logo par défaut = changer `DEFAULT_LOGO` dans
`web-app/src/app/theme.ts`.

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
