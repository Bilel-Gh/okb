# Comprendre — moteur 2.2

F2.2-01 à F2.2-10 réutilisent le moteur existant. Ce module ne crée aucun
fournisseur, framework d’agents ou index de savoir. Les lectures passent par
`sendToAi` et sa politique ; la comparaison reprend les grades de l’examen
(`right`, `partial`, `wrong`, `ungraded`) sans importer le module développeur.

## Contrats

- `understanding.read` : note, mode et projet facultatif. Les six modes sont
  simple, technique, court, détaillé, exemple de projet et analogie ; `auto`
  choisit simple jusqu’à une explication ou une réutilisation enregistrée.
  Une fiche porte explication, exemple, conditions, points flous et citations.
- `understanding.keep` : prépare une révision normale depuis une lecture
  actuelle. Le garde de révision conserve les rubriques, citations, code,
  notes de bas de page et champs inconnus. Aucune approbation ni note écrite.
- `understanding.record` : geste de la personne, avec identifiant stable et
  description requise pour pratiquer, expliquer, réutiliser ou signaler un
  point flou. Rejouer le même identifiant est sans effet ; changer son contenu
  est un conflit.
- `understanding.overview` : cinq niveaux observés, carte des liens existants,
  dettes, un sujet de cinq minutes et progression privée facultative.
  `level: null` indique une absence de geste observé, pas un sixième niveau.
- `understanding.meeting` : projet ou recherche, notes sources, actions ouvertes
  et questions effectivement enregistrées. Fonctionne sans IA.
- `understanding.readiness` : réponse de la personne comparée à une note,
  avec citations exactes et limites. Ne change jamais un niveau automatiquement.
- `understanding.learning`, `understanding.objective.add/done` et
  `understanding.review` : objectifs et cartes du module d’apprentissage
  existant. Le plan FSRS et son historique sont conservés.
- `understanding.progress` : activation ou désactivation par la personne.
  XP et badges suivent les dettes résolues, explications et réutilisations
  déclarées ; aucun classement, partage ni récompense pour ouvrir des notes.

Les actes, niveaux privés, objectifs, réglage de progression et réponses au
quiz sont réservés à la personne, y compris en cas d’appel direct d’une
opération. Les assistants peuvent préparer une lecture, une réunion ou une
révision ; ils ne déclarent pas avoir compris à la place de la personne.

## État et cache

La migration SQLite 6 ajoute `understanding_events` et `understanding_views`
dans la base opérationnelle existante, hors des notes. Le choix de progression
est dans `meta`. Les objectifs continuent d’utiliser l’état du module `learn`.

Le cache couvre le contenu exact de la note, les notes de contexte fournies,
le mode, la langue, le niveau et les instructions. Des demandes identiques
partagent un verrou d’état entre processus. Après l’appel, les empreintes sont
revérifiées ; une source changée n’est pas cachée. Garder une lecture relit les
sources et le contexte du projet et refuse un résultat périmé. Un résultat
incomplet ou une citation inexistante sont refusés, même si le coût de l’appel
est enregistré par la porte IA.

Une note protégée est exclue avant lecture, cache ou révision. Les notes de
contexte protégées ou contenant un secret ne sont pas fournies au modèle.
La porte IA contrôle encore le message final, y compris les titres et la
réponse de la personne.

## Limites explicites

- Les niveaux et actes sont observés ou déclarés. Ils ne certifient pas une
  expertise. Une consultation ne vaut pas pratique, explication ou réutilisation.
- Une citation exacte prouve que les mots existent dans la note fournie ;
  elle ne prouve ni la vérité de cette note ni le soutien sémantique de toutes
  les phrases générées. La révision reste à relire par la personne.
- Le contexte de projet est borné à quatre notes de son dossier ; une analogie
  emploie au plus quatre notes déjà expliquées ou réutilisées. Aucune preuve
  disponible ne justifie d’inventer un exemple observé.
- Les notes de plus de 60 000 caractères demandent une sélection plus courte.
  Les caches ne suivent pas un changement externe de document auquel une note
  fait seulement référence : les empreintes contrôlées sont celles des notes
  effectivement fournies. La validité des sources originales reste la zone
  Sources et validité du lecteur.
- Les dettes automatiques sont une heuristique : au moins trois rencontres ou
  consultations enregistrées, sans explication, réutilisation ou résolution.
  Les signaux de recherche et d’ouverture sont dédupliqués par jour.
- Les essais emploient des cerveaux fictifs et un transport simulé. Ils ne
  valident ni la qualité pédagogique d’un modèle réel, ni les trois réunions
  réelles et l’usage hebdomadaire exigés par la porte 2.2.
