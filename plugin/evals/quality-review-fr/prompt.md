---
max_turns: 5
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill, Agent]
tags: [quality, v1]
---
Fais relire la qualité de cette note de ticket par le relecteur de qualité d'OKB et donne-moi sa note sur 20 et les corrections prioritaires. Ne réécris pas la note.

---
type: Experience
title: ATL-412 — Export CSV
x_okb:
  template: ticket
---

# ATL-412 — Export CSV

L'export plantait. J'ai changé le code dans le service d'export et maintenant ça marche. Il faudra faire attention la prochaine fois.
