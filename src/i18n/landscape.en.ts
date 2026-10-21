/** Lot D (F2.4-15..20, D72, D73): what an address is, how sure a link is, the person's corrections, the team responsible. */
export const EN_LANDSCAPE = {
  'arch.cert.proved': 'proved', 'arch.cert.declared': 'declared', 'arch.cert.supposed': 'supposed', 'arch.cert.confirmed': 'confirmed',
  'arch.role.call': 'outside resource (called)', 'arch.role.endpoint': 'outside resource (address in configuration)', 'arch.role.registry': 'package registry', 'arch.role.source-host': 'code hosting', 'arch.role.doc': 'documentation link', 'arch.role.asset': 'page asset', 'arch.role.platform': 'platform', 'arch.role.unknown': 'to classify',
  'arch.offMap': 'Not on the map: {list}', 'arch.excludedCount': 'Excluded by you: {n} — okb arch link list', 'arch.staleCount': 'Corrections with no effect since the last scans: {n}', 'arch.conflictCount': 'The agent said something else on {n} link(s): okb arch conflict <key> mine|agent',
  'arch.link.kept': 'Correction kept; the next scans respect it.', 'arch.link.conflict': 'You already decided this link: the agent’s answer is kept as a conflict for you to settle.', 'arch.link.same': 'Already so: nothing changed.', 'arch.link.reset': 'Correction removed: the link is again what the scans say.',
  'arch.url.kept': '{host} is now « {role} » for every repository.', 'arch.url.forgot': 'Rule removed for {host}.', 'arch.conflict.settled': 'Conflict settled.',
  'arch.links.title': 'Links of {name}, with their keys', 'arch.links.excluded': 'Excluded', 'arch.links.stale': 'No longer match anything',
  'err.archTargetUnknown.title': 'This target is not on the map', 'err.archTargetUnknown.why': 'A link goes to a mapped repository of this knowledge base (repo:<name>) or to an outside resource (ext:<host>).', 'err.archTargetUnknown.fix': 'List the links and their ends with okb arch link list, then try again.',
  'err.archConflictUnknown.title': 'No conflict on this link', 'err.archConflictUnknown.why': 'The agent has not said anything different about it, or the conflict was already settled.', 'err.archConflictUnknown.fix': 'List the links with okb arch link list.',
} as const;
