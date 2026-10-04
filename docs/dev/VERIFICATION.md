# Vérification de la livraison

## Reprise locale 0.3.0 — 3 octobre 2026

Contrôles exécutés sur le Mac personnel, avec Node 24.4.0 explicitement sélectionné
pour les scripts (un npm système utilisait sinon Node 20.11.1).

| Contrôle réellement exécuté | Résultat |
|---|---|
| `release:check` : types, compilation, tests | 248 tests réussis, 18 fichiers |
| Validateur local du plugin | 16 composants |
| Validateur Claude Code 2.1.27 | Manifest validé ; strict/eval absents |
| Installation propre du paquet 0.3.0 | Parcours fictif complet, lecteur HTTP et assets installés compris |
| Tests serveur local | Lecture sans mutation, recherche citée, diff identique au CLI, snapshot concurrent refusé, accès externe/écriture/traversée/symlink refusés |
| Tests modèles/style | Ordre personnalisé, sources secondaires, rôles et chemins, aides désactivées, citations et code préservés jusque dans les encadrés |
| Tests application/maintenance | Édition concurrente, reprise avec cible supprimée, proposition écartée, fraîcheur inconnue/modifiée/absente, alias et liens invalides |

Aucune ingestion métier, aucun commit/push, aucune modification de réglages globaux
Claude ou MCP. Les signatures dans les tests portent uniquement sur leurs profils
fictifs temporaires. La KB pédagogique réelle demeure soumise à une approbation
humaine ; le contrôle des propositions ne vaut pas intégration.

Le routage et la qualité des réponses de Claude ne sont pas mesurés par ces tests.
Le CLI installé ne permet pas les évaluations natives ; voir
[CLAUDE-COMPATIBILITY.md](CLAUDE-COMPATIBILITY.md).

## Livraison historique 0.2.0

Travail réalisé sur l’archive du projet fournie, sans accès au Mac, à la KB réelle,
aux services internes ou au compte Claude de l’utilisateur.

| Contrôle réellement exécuté | Résultat |
|---|---|
| TypeScript, compilation | Réussite |
| Suite logicielle avec Node 24.19.0 | 173 tests réussis, 13 fichiers |
| Même suite avec Node 22.12.0 | 173 tests réussis, 13 fichiers |
| Validateur statique du plugin | 14 composants contrôlés |
| `claude plugin validate ./plugin --strict`, Claude Code 2.1.288 | Validation passée |
| Installation du paquet npm dans un dossier neuf | Réussite |
| Parcours fictif extraction paginée → analyse → aperçu → approbation → apply → liens → rollback | Réussite |
| Audit du verrouillage npm, incluant le développement | 0 vulnérabilité signalée lors du contrôle du 2 octobre 2026 |
| Métadonnées potentiellement exposées par le plugin | 2 433 octets sur disque ; environ 643 tokens estimés, pas mesurés dans Claude |

Le test de paquet utilise une copie du corpus fictif Acme Robotics et un nouveau
profil temporaire. Il ne se sert pas de la configuration personnelle. Les tests
simulent notamment l’arrêt après écriture et avant journal, la reprise, une
annulation confrontée à une modification humaine, les politiques qui tentent de
s’assouplir, le contrôle des redirections et les sources longues avec corrections.

Les 143 tests initiaux ont été conservés ou adaptés aux contrats corrigés. Trente
contrôles supplémentaires couvrent des régressions concrètes. Le dossier de sortie
générique exclut les scripts `.dev` contenant des chemins personnels et les caches.
La configuration fournie a été rendue séparément, sans être appliquée.

## Non exécuté ici

- Les évaluations natives avec des appels au modèle Claude : pas de compte ni de
  fournisseur configuré dans cet environnement. Les dix cas sont livrés, sans
  score inventé, sous `plugin/evals/`.
- Le chargement du plugin dans la session Claude particulière de l’utilisateur,
  avec ses réglages administrés et MCP.
- Une migration ou une ingestion sur la KB réelle ; aucune publication Git.
- Un test visuel exhaustif de toutes les versions de GitHub et Obsidian.

Ces distinctions sont nécessaires : l’installation et les règles déterministes
sont vérifiées ; la qualité sémantique et le comportement du modèle dans le contexte
métier restent à mesurer avec le protocole d’EVALUATION.md. Le format ouvert,
les profils et le moteur d’écriture restent utilisables indépendamment de cette mesure.
