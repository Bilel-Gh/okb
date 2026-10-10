# Stockage, sauvegardes et confidentialité

## Rien ne se perd

| Tu veux | Commande |
|---|---|
| les versions d'une note | `okb history <note>`, `--show N`, `--restore N` (une proposition) |
| une note supprimée depuis moins de 30 jours | `okb trash` |
| les sauvegardes | `okb backup` (lister), `okb backup run`, `okb backup verify` |
| restaurer une sauvegarde | `okb backup restore <date> --to <nouveau dossier>` (jamais par-dessus ta KB) |
| vérifier la santé du cerveau | `okb brain check`, puis `okb brain repair` (une proposition) |

Les sauvegardes sont quotidiennes (7 jours, 4 semaines, 12 mois), vérifiées par
empreinte, dans `~/.okb/backups` par défaut (`backup.dir`). OKB ne fait pas de Git
dans tes KB : si tu veux Git, c'est toi qui le gères.

## Les notes confidentielles 🔒

Une note marquée **secrète** (`okb secret set <note> secret`, par une proposition
que tu approuves) est à toi seul :

- une recherche lancée par Claude la laisse de côté (il sait seulement qu'une
  note 🔒 correspond) ;
- Claude ne peut pas lire le fichier ;
- pour la lui montrer, **nomme-la dans ton message** (« ouvre mon retour du
  manager ») : elle lui est ouverte 30 minutes.

L'application web l'affiche normalement, avec un badge 🔒.

## Ce qui part vers l'IA

Quand OKB appelle lui-même une IA (traduire, « Demander », l'examen d'un repo),
tout passe par un même contrôle avant de quitter ton ordinateur :

- **le message entier est vérifié** : un secret (clé, jeton, mot de passe) où que ce
  soit (dans la question, un titre, un terme) et rien ne part ;
- **une note 🔒 ne part qu'avec ton accord**, donné pour son contenu actuel : si la
  note change après ton accord, il faut confirmer à nouveau ;
- **les termes de tes fiches 🔒** ne sont jamais donnés à l'IA, même pour traduire
  une autre note ;
- **le budget du jour est vérifié avant l'appel**, et ce qu'un appel a consommé est
  compté même quand sa réponse est inutilisable (coupée par sa limite).

## Les données personnelles

Quand une proposition contient un email, un numéro de téléphone, un IBAN, un
numéro d'identité ou de carte, la relecture l'affiche : « ⚠️ données
personnelles dans … ». Tu décides si elles ont leur place dans la KB.
Les secrets (clés, mots de passe, jetons) restent refusés.
