# Retrouver une note en trois secondes

## La recherche

`okb find "export csv"` dans un terminal, **⌘K** dans l'application web : la même
recherche.

- Elle supporte les fautes de frappe (`exprot`), les accents, les pluriels, les
  débuts de mots (`Idempot`).
- Elle cherche dans les deux langues : `facture` trouve aussi `invoice`.
- Une référence (`ABC-123`) ou un titre exact passe en premier.
- Filtres : `--product`, `--repo`, `--type known-error,recipe`.

## Les notes viennent à toi

| Moment | Ce qu'OKB apporte |
|---|---|
| tu ouvres un fichier d'un repo | les notes qui parlent de ce fichier (`okb find --file src/x.ts`) |
| une commande échoue | l'erreur connue qui correspond (`okb find --error "…"`) |
| une recherche ne donne rien deux fois | une suggestion de note (`okb find --gaps`) |

## Le graphe par niveaux

Dans l'application web, **Graphe** : d'abord les tiroirs et les produits ; un
clic ouvre un produit (ses côtés et ses repos), un autre ouvre un repo (ses notes).
Les liens entre notes sont regroupés à chaque niveau : le dessin reste lisible
même à 3 000 notes.
