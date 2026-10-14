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

## Hooks : vérification du 13 octobre 2026

Version observée avec `claude --version` : **2.1.289**, sur macOS. Le
[contrat officiel des hooks](https://code.claude.com/docs/en/hooks) donne
`startup`, `resume`, `clear`, `compact` et `fork` comme sources de SessionStart.
OKB couvre les quatre premières ; une session fork n'est pas annoncée comme
couverte. SessionStart, UserPromptSubmit et PostToolUse acceptent
`hookSpecificOutput.additionalContext`. Stop accepte aussi ce contexte et peut
poursuivre le tour ; OKB ignore `stop_hook_active` pour éviter une boucle. Les
hooks de suggestion restent non bloquants. Les protections d'approbation et de
lecture secrète conservent leurs décisions existantes.

Les hooks utilisent le même runtime, livré dans les deux plugins (parité testée).
`OKB_CLI` explicite est prioritaire, puis le CLI du paquet avec le Node exécutant
le hook, le launcher, le checkout/cache et le PATH. Un `OKB_CLI` invalide est
signalé, sans fallback silencieux. `OKB_NODE` transmet ce runtime au wrapper.
Le chargement initial du hook exige encore `node` sur le PATH de Claude : un
Node absent avant ce démarrage ne peut pas être diagnostiqué par ce script Node.
Le runtime du moteur exige Node 22.13+ ; le Node embarqué dans le desktop ne
configure pas automatiquement le PATH d'une installation Claude externe.

Les traces locales sont dans `$OKB_HOME/hooks/diagnostics.jsonl` (par défaut le
home OKB habituel), limitées à 256 ko avec une rotation. `OKB_HOOK_DIAGNOSTICS=0`
les désactive. Elles contiennent l'horodatage, l'événement, le nom du hook, la
raison fixe, la durée, le résultat et les versions. Aucun prompt, transcript,
chemin métier, argument CLI, stderr, variable d'environnement ou secret n'est
journalisé. La fenêtre lue par Stop est bornée à la fin du transcript ; elle
n'annonce aucune couverture intégrale de la session.

| Observation | Interprétation / vérification |
|---|---|
| Aucune trace `started` | Pas de preuve d'exécution : vérifier `/hooks`, plugin activé, matcher et runtime du shell Claude. Un manifeste validé ne prouve pas le chargement. |
| `headless`, `continuation`, `excluded-*`, `irrelevant-command`, `already-sent` | Silence volontaire, indiqué par une raison fixe. |
| `binary-absent`, `runtime-unsupported`, `binary-or-runtime-absent` | Résolution du moteur ou du runtime échouée. |
| `profile-or-repo-unresolved`, `outside-scope`, `profile-resolution-error`, `brief-error` | Configuration/périmètre ou génération locale du contexte à vérifier. `no-context` seul ne prouve pas une erreur. |
| `timeout`, `deadline`, `cli-error`, `invalid-output` | Délai, erreur du processus ou contrat de sortie. Les contenus d'erreur restent hors des traces. |
| `context-sent` | JSON émis par le hook ; vérifier le debug Claude pour sa livraison. Cela ne prouve pas que le modèle a utilisé ou respecté ce contexte. |

Les tests locaux et les copies de cache utilisent des fixtures isolées. Aucun
appel au modèle n'a été lancé pour valider ces hooks ; les sessions agent réelles
et les autres plateformes restent à vérifier avant d'annoncer leur compatibilité.

Validation native supplémentaire du même jour : `claude plugin validate
./plugin --strict` et `claude plugin validate ./plugins/okb-dev --strict` passent
avec Claude Code 2.1.289, un `CLAUDE_CONFIG_DIR` et un `OKB_HOME` temporaires.
Aucun appel au modèle ni modification de la configuration personnelle. Cela
confirme les métadonnées chargées par le validateur, pas une conversation réelle.
