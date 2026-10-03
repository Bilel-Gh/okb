# Gestion du contexte

`okb context --json` mesure les octets des métadonnées et corps du plugin sur disque.
La conversion octets / 3,8 est une estimation, pas un tokenizer Claude. La rubrique
alwaysOn est un indicateur de métadonnées potentiellement exposées, pas une mesure
de la session réelle, des messages système, des autres plugins ou des MCP.

Cinq descriptions de skills et les descriptions des deux agents rendent les
workflows découvrables. Les procédures détaillées se chargent sur sélection.
Les sept commandes explicites désactivent l’invocation automatique par le modèle.
Les références du dossier d’analyse ne sont lues que pendant l’import. Aucun
énorme fichier de connaissance n’est importé au démarrage.

L’extraction limite la taille des blocs et celle de la page sérialisée avec un
budget de tokens estimé. Les sorties signalent le prochain curseur. Une page
n’est pas une synthèse : le parent conserve les fragments de travail hors KB et
reconstitue les corrections entre pages. `--run` réutilise le snapshot ; pour
relire une nouvelle version de la source, démarrer une extraction sans ce run.

`okb ask` renvoie des extraits et des lignes du fichier complet, pas tout le vault.
`okb review` fournit un résumé ; `--diff` demande explicitement les diffs complets
par fichier. Les preuves/affirmations sont paginées et leur pagination est indiquée.
Un diff individuel peut être volumineux : le lire depuis l’état avec un outil de
lecture bornée lorsque nécessaire. Il n’existe pas de promesse de budget global
sur toutes les sorties du CLI.

Pour mesurer dans Claude : relever la version, le fournisseur, les plugins et les
MCP actifs ; ouvrir une session neuve et utiliser `/context`, puis comparer le
même parcours avec et sans plugin. Noter les octets CLI, les tokens réellement
rapportés et le nombre de tours séparément. Ne pas présenter un devis local en
caractères comme une mesure Anthropic. Les mécanismes de découverte différée des
outils MCP dépendent de la version et du fournisseur ; ce produit ne modifie pas
ces réglages ni les serveurs gérés par l’entreprise.
