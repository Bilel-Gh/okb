---
type: regex
pattern: '##[^\n]*En bref[\s\S]*##[^\n]*probl[eè]me[\s\S]*##[^\n]*r[ée]solution[\s\S]*##[^\n]*m[ée]thode'
flags: i
target: { source: file, path: brouillon-ticket.md }
---
