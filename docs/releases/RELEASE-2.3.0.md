# OKB 2.3.0 — Assistant local

Préparation locale non publiée ; intégration réelle et porte d'usage en attente.

Livraison technique du 11 octobre 2026. L’écran Assistant pilote le CLI
installé par la personne, avec ses réglages, des sources bornées et des
citations contrôlées. Il n’extrait pas de connexion et ne propose pas
d’approbation automatique.

- F2.3-01 et 02 : conversations privées, choix de l’agent et états distincts
  d’installation et de compatibilité. Claude Code 2.1.259 minimum ; compte
  et intégration réelle à vérifier séparément. Second adaptateur expérimental.
- F2.3-03 et 10 : notes, documents et partage ; réponse distinguant passages
  sources, connaissance générale et incertitude ; citations inexistantes refusées.
- F2.3-04 à 08 : suites proposées après clic, modes contextuels, dictée de
  l’OS via les champs standards, outils MCP de lecture sélectionnés et fin de
  session limitée. L’accord et l’application restent les gestes de la personne.
- F2.3-09 : consommation par conversation incluant les appels échoués et
  annulés. Usage absent affiché inconnu ; estimation de budget identifiée.

Une conversation vide reçoit son identifiant avant la première question,
pour rendre celle-ci annulable. Le résultat n’est pas enregistré après
annulation, changement ou protection d’une source. Les appels locaux sont
arrêtés à la fermeture, avec terminaison du groupe de processus contrôlé.
La consommation conserve les 200 derniers détails et des totaux cumulés.

Le choix explicite de l’agent local sert les fonctionnalités IA existantes
sans repli API. Le mode fictif et les anciens profils conservent leur
comportement antérieur. Les réglages et hooks personnels restent une
frontière de confiance ; les citations ne sont pas des contrôles de vérité.

Les tests automatisés couvrent les contrats et des processus fictifs. Ils
ne certifient pas un compte connecté, le parcours réel d’un second agent,
une qualité de modèle ni les conditions d’une distribution commerciale.

Un essai réel Codex CLI `0.159.0-alpha.12.1` a effectué les deux lectures MCP
et retrouvé une citation exacte sur la fixture. L’adaptateur reste expérimental,
sur opt-in et cette seule version. Son contexte CLI a consommé beaucoup plus
que la question seule ; les mesures et limites figurent dans la spec.
L’essai réel Claude a échoué, sans cause établie ; la génération réelle reste à vérifier.

[Guide de l’assistant local](../guide/assistant-local.md) ·
[Contrat et limites](../dev/specs/2026-10-11-2.3-assistant.md)
