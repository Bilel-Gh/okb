# Sécurité et limites de confiance

## Contrôles exécutés

Le chargement des propositions vérifie le hash recalculé et leur rattachement au
profil et à la KB. Les identifiants de profils, runs, propositions et reçus ne sont
pas des chemins. Les chemins d’écriture sont relatifs, canoniques et contrôlés
contre les exclusions et tous les plafonds de politique. Les liens symboliques
sous la racine sont refusés comme cibles d’écriture ; une racine de KB elle-même
symbolique peut être résolue. L’état opérationnel et la KB ne peuvent être imbriqués,
y compris après résolution des liens symboliques.

Une signature HMAC protège l’intégrité de la proposition et de la sélection.
Le noyau refuse une proposition altérée, un fichier devenu obsolète, une création
sur un chemin existant ou une nouvelle erreur structurelle. Les changements
mécaniques utilisent exactement la même application et les mêmes sauvegardes.
`keepBackups: false` est refusé à l’application : il ne peut pas transformer une
annulation en suppression d’un fichier antérieur.

Le verrou protège les écrivains OKB locaux qui visent la même racine physique,
même avec des profils différents. Un propriétaire encore vivant bloque l’opération.
Un verrou de processus mort est récupérable ; des métadonnées de verrou absentes
échouent prudemment et nécessitent une inspection. Les éditeurs externes ne
respectent pas ce verrou : les hashes sont revérifiés avant chaque écriture, mais
aucun verrou local ne promet d’arrêter un programme hostile ou une course externe
à l’instant exact de la substitution du fichier.

## Approbation ≠ isolation système

La clé HMAC est un fichier privé du même compte système. Un agent disposant d’un
shell arbitraire peut potentiellement la lire, modifier le programme ou écrire
la KB autrement. Le hook PreToolUse bloque les formes usuelles de `--approve`,
la désactivation explicite de la revue et des lectures évidentes de la clé. Il
ne parse pas toutes les constructions shell et n’est pas une frontière de sécurité
contre un agent adversarial. Les skills ne préautorisent pas Bash. Les deux
sous-agents disposent uniquement de Read, Grep et Glob dans leur configuration.

Une frontière plus forte pour un déploiement d’entreprise exige une identité et
un processus d’approbation distincts, des permissions système et une configuration
administrée. Ce n’est pas fourni par cette application locale.

## Sources et données privées

Les documents, transcriptions et notes retrouvées sont des données non fiables,
jamais des instructions à exécuter. Aucun calcul embarqué dans une note OKF n’est
exécuté. Le connecteur web est désactivé par défaut. Une liste explicite de domaines
est exigée ; chaque redirection est revérifiée et le téléchargement est limité en
flux, sans faire confiance à Content-Length. Les domaines autorisés demeurent la
responsabilité de la configuration ; ce n’est pas un proxy réseau d’entreprise.

Les snapshots normalisés, dossiers, preuves et sauvegardes peuvent contenir des
données sensibles. Ils restent dans l’état privé et doivent être protégés comme
la KB. `sources.retention.mode` gouverne la copie facultative des **octets acquis** :
`none`/`reference` ne créent pas cette copie ; `copy` l’archive sous l’état privé.
Les snapshots de travail et preuves existent indépendamment pour permettre la
reprise et la revue. `redactPatterns` ne filtre que cette copie textuelle facultative,
pas les preuves de travail. La copie binaire avec redaction demandée est refusée.

La désinstallation conserve les données privées. La suppression de l’état efface
les reçus et possibilités de reprise/rollback : elle doit être un choix explicite.
Le partage 2.1 utilise une copie Git commune configurée séparément. Préparer
écrit les seuls fichiers de l’aperçu dans le tiroir de la personne ; envoyer et
recevoir exigent un geste explicite. Un envoi vérifie l’empreinte de l’aperçu,
refuse les commits locaux déjà en attente et n’indexe que les chemins revus.
Les autres tiroirs, le bagage, la carrière et les notes verrouillées sont exclus
de la publication. L’historique Git, les droits du service distant et les
copies déjà reçues ne sont pas contrôlés par ces exclusions : retirer un
partage n’efface pas son ancien contenu chez les destinataires.

`git.requireCleanTree` active uniquement un contrôle `git status` avant une
nouvelle application ; les reprises/annulations restent possibles avec un arbre
modifié. `git.autoCommit: true` est refusé. Les autres options de destination ne
constituent pas une implémentation de publication. Une copie Git locale n’est pas, à elle seule,
une sauvegarde sur un autre support.

## Assistant local et desktop (préparation 2.3/3.0)

La porte IA contrôle le message final, budget et consentements avant d’appeler
la CLI installée. Les outils MCP contrôlent aussi les résultats de recherche
et de lecture avant de les transmettre : un secret détecté dans une note,
un document ou un manifeste partagé refuse le résultat sans exposer l’extrait.
Les réponses réservées à la personne et les écritures sont exclues du MCP
de l’assistant intégré. La configuration personnelle, ses hooks et le compte
système restent des frontières de confiance ; ces contrôles ne promettent pas
d’isoler une CLI hostile ou administrée par un tiers.

Les passages sont revérifiés avant l’envoi et avant la conservation de la
réponse. Le ledger privé conserve l’usage rapporté, y compris pour un appel
échoué ; une mesure inconnue demeure inconnue. L’annulation et l’arrêt du
desktop terminent les processus contrôlés avant de fermer l’état SQLite.
Le serveur cesse d'accepter des requêtes, annule les corps incomplets et
attend les écritures et sauvegardes déjà engagées. Le snapshot est protégé par
un verrou commun pendant création, vérification, export et restauration ;
l'ancien dossier reste récupérable lors d'une publication interrompue.

Electron désactive Node dans le renderer et isole le preload. Les permissions,
webviews et fenêtres supplémentaires sont refusées ; la navigation reste sur
l’origine loopback exacte. Le pont natif ne propose que choix de dossier et
mises à jour, depuis le frame principal de l’application. Une release signée
fixe deux canaux HTTPS et l’identité de l’éditeur ; le programme vérifie
l’identité installée avant d’activer l’updater. Un prototype non signé garde
les mises à jour désactivées. Signature, notarisation et exécution sur chaque
OS restent des validations de distribution.

## Audit de dépendances du 11 octobre 2026

`npm audit --omit=dev` signale cinq entrées (deux faibles, trois modérées),
regroupées autour de deux dépendances transitives :

- Mermaid embarque une version de KaTeX concernée par
  [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7).
  L’exploitation décrite suppose une pollution de prototype préalable ;
  ce prérequis n’est pas établi dans OKB. Le renderer Mermaid utilise le mode
  strict. Cela ne vaut pas preuve d’absence d’exploitation : une mise à jour
  compatible et un essai de rendu restent à réaliser avant distribution.
- Mammoth embarque argparse/sprintf-js concernés par
  [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
  Le chemin DOCX d’OKB utilise `convertToHtml`, pas le parseur CLI argparse.
  Aucune version corrigée de sprintf-js n’est proposée par le registre lors
  du contrôle. La rétrogradation automatique proposée de Mammoth est refusée
  car elle casserait le support actuel ; l’exposition et la correction sont
  à suivre explicitement.

Les tests fonctionnels et l’absence d’alerte élevée dans cet audit ne sont pas
une certification de sécurité. Les outils de build ont aussi leurs dépendances
de développement ; vérifier l’audit complet lors d’une release.

## Ce que les preuves prouvent

Un hash détecte un changement d’octets, pas une vérité. La couverture déclare ce
que l’auteur dit avoir lu. Le contrôle des citations vérifie l’identité de l’extrait,
pas son adéquation logique. Le réviseur doit contrôler corrections, négations,
attribution et portée. Les nouveaux documents sont draft et ne portent pas de
vérification créée par le produit. Lorsqu’une nouvelle section enrichit un document
vérifié, les événements antérieurs sont conservés dans `x_okb.prior_verified` et
la vérification courante est vidée pour ne pas couvrir artificiellement l’ajout.
