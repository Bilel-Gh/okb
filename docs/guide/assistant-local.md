# Poser une question à son agent local

L’écran **Assistant** utilise l’agent CLI installé et configuré par la personne.
OKB ne récupère pas son jeton de connexion et ne lui fournit pas de clé.
Claude Code est l’intégration initiale ; le second adaptateur reste
expérimental tant que son parcours réel n’a pas été validé.

Choisis ton agent dans cet écran. Ce choix explicite sert aussi les lectures,
traductions et vérifications des notes, sans repli silencieux vers une API.
Les réglages personnels de l’agent restent actifs. Claude Code doit être en
version 2.1.259 ou ultérieure pour les permissions sans dialogue utilisées
par cette intégration ([référence CLI officielle](https://code.claude.com/docs/en/cli-reference)). **Installé** et **compatible** décrivent le programme ;
ils ne prouvent pas que son compte est connecté ou qu’un appel réussira.

Commence une conversation et pose ta question. OKB fournit des passages
bornés de notes, de documents et, s’il est configuré, du partage. Les notes et
documents verrouillés sont exclus. Chaque réponse distingue les éléments
issus des notes, les connaissances générales et les points inconnus. Une
référence doit citer des mots présents dans le passage fourni ; elle permet
de revenir au texte, sans garantir sa vérité.

Depuis un projet ou la fiche d’un ticket, les liens **Où j’en étais**,
**Pourquoi cette décision ?** et **A-t-on déjà rencontré cette erreur ?**
préparent une question dans l’Assistant. Relis-la, précise la décision ou le
message d’erreur, puis envoie-la. Ouvrir ce parcours ne lance aucun agent.
Le travail sélectionné apparaît avec un lien de retour ; son état opérationnel
est relu dans cet espace à chaque question. Il reste distinct des preuves dans
les notes : travail terminé ne veut pas dire livré.

La recherche locale indexe le texte complet des notes. L’Assistant choisit au
plus deux fenêtres pertinentes par longue note, avec des voisins et des
ellipses pour ce qui est sauté, au lieu d’envoyer systématiquement son début.
Une reformulation reprend les questions récentes et relit les notes trouvées,
sans renvoyer leurs anciennes copies. Cette sélection bornée peut omettre une
preuve : elle ne constitue pas une revue exhaustive ni un contrôle de vérité.

Tu peux annuler une réponse, y compris la première de la conversation.
Une réponse reçue après annulation n’est pas conservée. Si une source change
ou devient protégée pendant la génération, le résultat est refusé : pose
à nouveau la question avec la matière actuelle.

Les boutons d’une réponse proposent au plus trois suites. Créer une action
demande ton clic ; garder une note passe par une carte et le parcours normal
de rédaction et d’accord. L’agent n’approuve ni n’applique ses idées. Les modes
expliquer, retrouver, réunion et reprise peuvent aider à préciser la demande.
La fin de session peut proposer quelques éléments à garder ; **pas maintenant**
est mémorisé.

Les conversations et leurs passages restent dans l’état privé du profil,
hors du dossier de notes et du partage. Les anciennes réponses ne sont pas
réinjectées dans le modèle avec leurs anciennes sources. Les réglages et
hooks personnels de l’agent sont une frontière de confiance ; la restriction
des outils OKB ne transforme pas tout le programme CLI en sandbox système.

Sans agent compatible, avec une session expirée ou une limite d’utilisation,
la question reste disponible et **Chercher dans mes notes sans IA** ou
**Continuer sans IA** ouvre la recherche locale avec le texte préparé. Aucun
autre fournisseur n’est appelé pour contourner cet échec.

La consommation comprend les appels échoués ou annulés, même lorsqu’aucun
message n’a été gardé. Si le CLI ne donne pas ses tokens, la conversation
affiche **inconnu** ; le budget peut compter une estimation explicitement
identifiée. Une somme de tokens connus ne représente pas le total réel si
d’autres appels n’ont pas de mesure.

L’installation, la connexion et les conditions du compte restent celles du
fournisseur de l’agent. La documentation technique ne vaut pas validation
contractuelle de toute distribution commerciale tierce.
