# F2.4 — Reprendre le travail réel et diagnostiquer Claude Code

Périmètre autorisé le 13 octobre 2026 : évolution du suivi et du skill ticket,
propositions existantes, SQLite, notes Markdown ; aucun nouveau système de mémoire.

| Retour | Reproduction / indice | Cause | Correction | Acceptation |
|---|---|---|---|---|
| Ticket commencé hors OKB | test absent/note seule/suivi seul | `startTicket` cherchait seulement SQLite | `tickets.resume`, identité exacte dans le repo/profil et les notes autorisées | suivi reconstruit, note humaine inchangée |
| Correction humaine perdue | test rouge : deuxième `start` remplaçait le texte | écriture inconditionnelle du fichier d'état | texte initial conservé, conflit visible, ajout de contexte dédupliqué | texte/objectif conservés, retry identique |
| Reprise ambiguë | profils/références/notes multiples | premier résultat choisi silencieusement | erreur avec candidats et paramètre de sélection | aucun suivi créé tant que le choix manque |
| Session reprise sans brief | matcher statique | `resume` absent des deux manifestes | matcher `startup|resume|clear|compact` | fixtures et contrat officiel |
| Hooks muets | hooks multiples, résolution différente | erreurs et exclusions silencieuses | runtime partagé, raisons fixes et traces bornées | absence de contenu privé, erreurs distinctes |
| Note de fichier non reçue après erreur | test rouge de retry | fichier marqué « vu » malgré erreur CLI | marquage après résultat utile seulement, identité repo/session | retry, même chemin relatif dans autre repo |

L'opération commune crée l'état et prépare une proposition sans l'appliquer.
Les champs déclarés sont ajoutés sans fabriquer des informations. Objectif,
der­nière action et prochaine étape ne remplacent pas une correction humaine.
Les dimensions travail, PR, CI, attente et livraison restent indépendantes.
Le `start` historique utilise la réconciliation ; `brief` garde sa correction
explicite. L'autodétection d'une branche recherche aussi la note avant création,
mais ne prépare aucune proposition au passage d'un hook.

Les notes secrètes restent hors de la réconciliation par un agent. La recherche
honore les exclusions du profil. Une note illisible portant la référence bloque
la création automatique d'un doublon. Deux notes de ticket possibles exigent un
choix explicite. Une proposition déjà préparée ou écartée est conservée et
renvoyée, sans répétition. Des faits ajoutés après sa préparation enrichissent le
suivi ; une nouvelle rédaction de la note reste un geste explicite à relire.

Les fixtures des hooks exécutent de vrais processus locaux avec un CLI fictif :
checkout, copie de cache, PATH réduit, chemins avec espaces, délais dépassés,
sortie invalide, exclusions et reprise. Elles ne prouvent ni le chargement des
plugins dans une session réelle ni l'utilisation du contexte par le modèle.
Aucun appel facturé, corpus privé, serveur personnel ou approbation n'est requis.

Quand une note existe et que la personne apporte de nouveaux faits, une
proposition ajoute une section de reprise, conserve le corps humain et les
champs inconnus. La note redevient brouillon ; une ancienne vérification passe
dans `x_okb.prior_verified`, car elle ne couvrait pas les nouveaux faits. Un hash de ces faits déduplique les retries, y compris
après refus. La baseline empêche l'application si une correction humaine est
arrivée entre-temps. Les tests passent par `guardApply`, le matérialiseur et
`validatePlannedFiles`. Un essai d'application sans accord reste refusé ; aucun
accord n'est fabriqué pour ces vérifications.

Dans un cerveau, un agent doit aussi nommer une suggestion déjà acceptée pour
la note (`--suggestion`). Sans cet accord, le suivi local est repris et
`proposalDeferred` expose ce qu'il manque. Ce circuit existant n'est ni supprimé
ni remplacé par l'invocation du ticket. Les propositions initiales déjà en
attente restent intactes ; des faits ajoutés avant leur validation restent dans
le suivi jusqu'à une rédaction explicite ou une proposition de complément à une
note effectivement présente.

Les réutilisations de notes secrètes enregistrées par la personne restent hors
du résultat d’une reprise par un agent, comme dans `tickets.get`. Le titre, le
chemin, le hash et le commentaire de cette source ne sont pas exposés.
