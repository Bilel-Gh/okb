# Les todos de l’agent, un accueil qui raconte la journée — 23 octobre 2026

Checkout de développement non publié ; le numéro du paquet reste 2.0.0.

- **F2.4-21, D74** : une todo ajoutée par l’agent entre directement dans la
  liste du ticket, avec « ajoutée par l’agent » et sa raison.
- **F2.4-22** : l’agent coche et règle l’importance de toutes les todos (la ligne
  le dit) ; il ne réécrit et ne retire que les siennes.
- **F2.4-23** : une todo de l’agent que la personne retire ne revient jamais sur
  ce ticket, même formulée autrement ; « Annuler » la remet.
- **F2.4-24** : le brief de session et le skill donnent la règle : trois todos
  au plus par session, chacune annoncée en une ligne.
- **F2.4-25, D75** : « Ce qui s’est passé » montre les cinq faits marquants
  depuis hier avec leur contexte ; une journée calme tient en une ligne.
- **F2.4-26** : l’app s’ouvre et passe d’une page à l’autre plus vite : fichiers
  gardés en cache, mémoire lue dès le démarrage, pages préchargées.

Limites : le plafond de trois todos est une conduite de l’agent, pas une limite
du moteur ; le fil ne montre que ce que le journal et les reçus connaissent.
