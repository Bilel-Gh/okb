# Diagnostic indépendant — 3 octobre 2026

Périmètre observé : version locale 0.3.0, reprise des modifications sur l’archive
0.2.0. Ce dossier ne possède pas de dépôt Git : aucun commit de référence ne peut
être donné. L’archive d’origine et les documents produit permettent la comparaison.
Le document initial nommé « Second_cerveau_IA_Architecture_et_feuille_de_route »
dans la conversation n’est pas présent dans les fichiers accessibles : sa
comparaison détaillée reste limitée aux intentions recopiées par l’utilisateur.

## Ce qui existe réellement

| État | Fonctionnement observé | Exemple et limite |
|---|---|---|
| Implémenté | CLI déterministe, extraction VTT/Markdown/HTML/PDF texte/DOCX/code, pagination et snapshots | Un VTT est extrait avec timecodes ; un PDF scanné exige un autre outil |
| Implémenté | Dossier v2, sources multiples, citations exactes, aides reliées aux affirmations | Expliquer un mécanisme à partir d’un README et du fichier TypeScript ; les preuves restent à relire |
| Implémenté | Style, niveau du lecteur par domaine, assistance concepts, modèles de notes | Même mécanisme expliqué simplement ou avec détails ; le ton dépend du modèle |
| Implémenté | Propositions, sélection, approbation, application, reçus, reprise et rollback | Refuser une fiche enlève ses liens ; une modification humaine bloque un rollback |
| Implémenté | Recherche lexicale, alias, extraits citables, entretien, navigation, déplacement | Retrouver une décision avec ses mots ou ses alias ; pas de recherche sémantique universelle |
| Implémenté | Lecture locale dans le navigateur et contrôle optionnel des empreintes sources | Lire une proposition entière ; détecter qu’un fichier local a changé sans modifier la KB |
| Partiellement validé | Plugin Claude : six skills, huit raccourcis, deux agents, hook, wrapper CLI | Le manifest est validé ici ; le routage naturel et la synthèse exigent des appels réels à Claude |
| Envisagé | Mesures métier, recherche sémantique éventuelle, OCR/audio, connecteurs supplémentaires | Les décrire comme besoins ou pistes, pas comme fonctionnalités disponibles |
| Poste professionnel | Authentification, fournisseur Claude, règles administrées, MCP internes, KB existante | Aucun service professionnel ni corpus métier n’a été utilisé ici |

## Avis sur les fondations

La séparation entre intelligence éditoriale et moteur d’écriture est solide.
Claude peut proposer une interprétation ; le CLI peut refuser une citation
inventée ou une note modifiée depuis la revue. Cela est utile pour un compte rendu
où une correction arrive en fin de réunion : lire tous les blocs et confronter
les preuves vaut davantage qu’un résumé plausible des premières minutes.

Markdown comme stockage canonique convient au besoin : lecture dans Obsidian,
diffs compréhensibles et sortie possible sans dépendre du logiciel. L’état privé
hors KB évite de polluer les notes avec snapshots et journaux techniques. Les
profils limitent les forks personnels et ne remplacent pas les réglages Claude.

La recherche lexicale est un choix raisonnable pour commencer. Avant d’ajouter
une base vectorielle, mesurer les échecs réels : synonymes, questions FR/EN,
documents difficiles à retrouver. Des alias et deux recherches reformulées
peuvent suffire. Un index sémantique futur doit être un cache reconstructible.

Les commandes courtes et les skills ont un chevauchement connu. Leur coût est
petit tant que les raccourcis ne se déclenchent pas automatiquement. Les fusionner
maintenant casserait des noms et des évaluations pour peu de gain. `okb route`
reste un sélecteur lexical de démonstration ; il ne mesure pas Claude.

Le nombre de sections imposées par les modèles demande une vigilance éditoriale :
un guide court n’a pas besoin de remplir artificiellement chaque rubrique
optionnelle. Les fiches concepts doivent aider à résoudre une incompréhension,
pas multiplier les fichiers. Les analogies clarifient un fait et doivent expliciter
leur limite ; elles n’apportent pas une nouvelle preuve.

## Améliorations de cette reprise

1. Terminer et durcir les modèles : ordre personnalisé, rôles uniques, erreurs de
   configuration explicites, fiches concepts françaises/anglaises, preuves
   secondaires attachées aux changements et exemples désactivables.
2. Protéger les éditions concurrentes pendant la préparation des écritures et
   vérifier à nouveau les liens à la reprise d’une application interrompue.
3. Signaler la fraîcheur des sources locales sur demande, avec un état « inconnu »
   quand les métadonnées manquent, sont ambiguës ou que le fichier ne peut être lu
   dans les limites prévues. Une empreinte différente ne dit pas quel fait est faux.
4. Fournir un lecteur local pour réduire l’effort de revue : aperçu, diff, sources,
   recherche et préférences, puis approbation explicite dans le terminal.
5. Reconstruire la KB d’apprentissage via les propositions du produit et conserver
   un rapport de reprise privé, au lieu d’intégrer directement des fichiers.

## Prochaines améliorations, après usage réel

Priorité : cinq à dix cas de travail représentatifs, avec réponse attendue,
source, durée de lecture et erreurs acceptables. Mesurer les omissions,
attributions erronées et temps de revue. Puis améliorer le routage et les
préférences uniquement à partir de ces résultats.

Ensuite : traductions complètes lors de `revise` (les titres de sections restent
actuellement protégés), fraîcheur des sources distantes avec accès explicitement
autorisé, et rebasage de propositions qui modifient le même fichier. Préserver la
simplicité : ni orchestration supplémentaire ni nouveau serveur MCP tant qu’un
cas d’usage concret ne les justifie.

Les tests du noyau ne prouvent pas l’exactitude des articles ni la capacité du
modèle à suivre le style. Le hook d’approbation est une aide contre une
autoapprobation accidentelle sous le même compte, pas une isolation de sécurité.
L’application est récupérable fichier par fichier ; elle n’est pas une transaction
unique visible atomiquement par Obsidian.
