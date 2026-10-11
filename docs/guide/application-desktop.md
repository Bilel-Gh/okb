# L’application desktop — préparation 3.0

OKB desktop ouvre la même interface que `okb serve`. Les notes, projets,
apprentissage et propositions suivent les mêmes règles. Le programme embarque
son runtime : la personne qui reçoit un installateur n’a pas à installer Node.

Au premier lancement, choisissez votre activité, le nom de votre espace et un
premier projet. Les exemples changent selon votre activité. Le dossier proposé
est dans Documents/OKB ; vous pouvez choisir un dossier neuf ou vide.
« Continuer sans IA » ouvre votre premier projet. Écrire une action, garder un
document, rechercher et préparer une sauvegarde fonctionnent sans agent.

Pour l’IA, « Vérifier mon agent » contrôle l’installation locale. Un agent
installé ne prouve pas que son compte est connecté ou que son quota suffit.
Le guide officiel d’installation est accessible depuis l’accueil ; après
connexion par l’outil officiel, choisissez l’agent dans Assistant. OKB utilise
sa configuration. En entreprise, utilisez l’installation et l’abonnement
autorisés pour vos données.

Diagnostic et Sauvegardes restent accessibles dans « Plus ». Le menu natif
propose le zoom et le diagnostic. L’export copie un instantané complet de
l’espace dans un dossier vide : [format et restauration](export-et-restauration.md).

Pour construire un prototype depuis les sources :

```sh
npm ci
npm run desktop:dir
```

Le résultat se trouve dans `desktop-build/`. Sur Mac, ouvrez OKB.app. Ce
prototype est non signé et n’est pas un installateur public validé. La commande
`desktop:build` prépare les formats de distribution configurés ;
`desktop:release` exige signature, vérifications et parcours navigateur.
Elle ne publie rien.

La configuration de distribution appartient au mainteneur, en dehors des
réglages de l’utilisateur. `OKB_SIGNED_RELEASE=1` exige
`OKB_UPDATE_STABLE`, `OKB_UPDATE_PREVIEW` (deux URLs HTTPS) et
`OKB_SIGNING_PUBLISHER` (l’identité du certificat). Les certificats et secrets
de signature passent par les variables de l’outil officiel electron-builder,
dans un environnement privé de release ; ils ne vont jamais dans Git ni dans
les réglages web. Le nom de l’éditeur doit correspondre à l’identité signée
sur l’OS cible. Le script restaure ensuite la politique source du prototype.

Une distribution publique demande encore des certificats, la notarisation
Mac, l’essai Windows et un essai réel de mise à jour. Les canaux stable et
préversion sont fixes dans le programme signé. Sur le prototype, l’interface
indique que les mises à jour sont désactivées. Aucun téléchargement ne commence
en arrière-plan ; la personne choisit vérifier, télécharger puis redémarrer.
