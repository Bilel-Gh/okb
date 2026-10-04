# Contrats Claude vérifiés dans les sources officielles

Documentation consultée le 3 octobre 2026. Séparer ces contrats actuels de ce qui
est observé dans le Claude Code 2.1.27 installé sur ce poste.

| Mécanisme | Contrat actuel et conséquence pour OKB | Source officielle |
|---|---|---|
| Skills | Description en contexte, contenu chargé à l’invocation puis conservé dans la session sous les limites de compaction ; `disable-model-invocation` retire la description du contexte permanent. Le brief OKB se charge pendant le workflow. | [Skills](https://code.claude.com/docs/en/skills) |
| Sous-agents | Fenêtre de contexte propre ; leurs requêtes consomment les mêmes quotas. Déléguer une revue ne crée pas une réserve de tokens indépendante. | [Subagents](https://code.claude.com/docs/en/sub-agents) |
| Instructions projet | `CLAUDE.md` est du contexte, pas une configuration appliquée mécaniquement. Les imports ne réduisent pas leur coût au lancement. | [Memory](https://code.claude.com/docs/en/memory) |
| Style Claude | Le style de sortie concerne les réponses de la session ; OKB conserve un paramètre de rédaction propre aux articles. | [Output styles](https://code.claude.com/docs/en/output-styles) |
| Exécutables plugin | `bin/` est ajouté au PATH de Bash quand le plugin est actif. claude.ai et Cowork n’installent pas les plugins contenant `bin/` : le mode de distribution doit être vérifié. | [Plugin manifest](https://code.claude.com/docs/en/plugins-reference) |
| Auto | Depuis 2.1.283, mode de départ intégré en terminal/VS Code, sous réserve du modèle, des réglages et de l’organisation. Un classificateur évalue les actions ; les règles explicites et contrôles supplémentaires continuent à s’appliquer. | [Permission modes](https://code.claude.com/docs/en/permission-modes) |
| Évaluations | `claude plugin eval` exige au moins 2.1.269, appelle réellement le modèle et ses juges, et consomme le compte habituel. Conserver les rapports avec `--no-publish`. | [Plugin evals](https://code.claude.com/docs/en/plugin-evals) |

Le mode auto de Claude ne signe pas les propositions OKB. L’utilisateur reste
celui qui exécute `okb review --approve` ; le noyau applique la sélection signée.
Ne pas modifier les réglages globaux ni contourner le hook pour rendre une
proposition applicable.

Observé ici : manifest validé par `claude plugin validate ./plugin`, `--strict`
et sous-commande `plugin eval` absents du CLI 2.1.27. Ni une mise à jour globale
ni un score d’évaluation n’ont été fabriqués. Sur le poste cible, relever la
version et tester `bin/okb`, le hook et le routage dans la session réellement utilisée.
