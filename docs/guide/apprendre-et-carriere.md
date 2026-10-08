# Apprendre et suivre sa carrière

## La révision espacée

Tes fiches concepts et les lignes « Q : … — R : … » de tes notes deviennent des
cartes. OKB te les présente au bon moment (algorithme FSRS) : juste avant que tu
les oublies.

| Tu veux | Commande |
|---|---|
| réviser les cartes du jour | `/okb:learn` ou la page **Réviser** de l'application web |
| voir ce que tu maîtrises, par sujet | `okb learn map` |
| un quiz sur un repo ou un produit | « interroge-moi sur atlas-api » (`okb learn quiz --repo atlas-api`) |
| te fixer un objectif | `okb learn goal add "Comprendre OData" --by 2026-12-01` |

Après chaque carte, tu dis comment ça s'est passé : **Encore**, **Difficile**,
**Bien**, **Facile**. L'état des révisions est gardé par OKB, jamais dans tes notes.

## La carrière

Dans le cerveau Travail, `4 Activité/Carrière/` garde :

- tes **réalisations**, racontées en STAR (Situation, Tâche, Action, Résultat),
  avec leurs preuves (ticket, PR, note) ;
- les **retours** reçus, tes **objectifs** de l'année ;
- tes **entretiens** (individuels, annuels) et ton **plan de développement**.

| Tu dis | Ce qui se passe |
|---|---|
| « garde ça pour mon entretien » | Claude pose seulement les questions STAR qui manquent, puis propose la note |
| « prépare mon entretien individuel » | `okb career prep one-on-one` : réussites, tickets finis, retours, suivi des actions |
| « mes notes de carrière, je les emporte » | `okb career check` liste ce qui partirait de l'entreprise ; une fois propre, `okb career export <nouveau dossier>` |

La page **Carrière** de l'application web montre tes histoires, les compétences
qu'elles prouvent et ce qu'il manque.
