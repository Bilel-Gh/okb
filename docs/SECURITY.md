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
Il n’existe aucune synchronisation réseau, création de dépôt, commit, push ou ajout
de collaborateur automatique. `git.requireCleanTree` active uniquement un contrôle `git status` avant une
nouvelle application ; les reprises/annulations restent possibles avec un arbre
modifié. `git.autoCommit: true` est refusé. Les autres options de destination ne
constituent pas une implémentation de publication. Une copie Git locale n’est pas, à elle seule,
une sauvegarde sur un autre support.

## Ce que les preuves prouvent

Un hash détecte un changement d’octets, pas une vérité. La couverture déclare ce
que l’auteur dit avoir lu. Le contrôle des citations vérifie l’identité de l’extrait,
pas son adéquation logique. Le réviseur doit contrôler corrections, négations,
attribution et portée. Les nouveaux documents sont draft et ne portent pas de
vérification créée par le produit. Lorsqu’une nouvelle section enrichit un document
vérifié, les événements antérieurs sont conservés dans `x_okb.prior_verified` et
la vérification courante est vidée pour ne pas couvrir artificiellement l’ajout.
