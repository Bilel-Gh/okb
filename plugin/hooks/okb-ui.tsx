import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OkbSnapshot } from '../types'

/**
 * OKB inside Claude Code: a status entry (KB, scope, focus age, inbox, proposals), a
 * `/okb` command that opens a dashboard pane, and a toast when a proposal starts
 * waiting. Buttons only fill the prompt box: the person still presses Enter.
 * Nothing here writes to a KB or approves anything.
 */
const PANE = 'okb'
const snapshot = atom({ plugin: 'okb', key: 'snapshot' } as const, null)
const pendingSeen = atom({ plugin: 'okb', key: 'pendingSeen' } as const, 0)

const L = {
  fr: { title: 'OKB', focus: 'Focus', none: 'pas encore', days: 'j', stale: 'à revoir', next: 'Prochaine fois', inbox: 'Inbox', pending: 'À relire', nothing: 'rien en attente', notes: 'notes', review: 'Relire', done: 'Fin de session', weekly: 'Revue', capture: 'Capturer', focusBtn: 'Focus', refresh: 'Actualiser', suggestions: 'Suggestions', suggestBtn: 'Décider', due: 'À réviser', learn: 'Réviser', suggestPrompt: 'Montre-moi les suggestions de notes en attente', scope: 'Périmètre', ticket: 'Ticket', toast: 'OKB : une proposition attend ta relecture — /okb:review', opened: 'Panneau OKB ouvert.', missing: 'OKB n’est pas configuré ici : lance « okb init » dans un terminal.' },
  en: { title: 'OKB', focus: 'Focus', none: 'none yet', days: 'd', stale: 'outdated', next: 'Next time', inbox: 'Inbox', pending: 'To review', nothing: 'nothing waiting', notes: 'notes', review: 'Review', done: 'End session', weekly: 'Weekly', capture: 'Capture', focusBtn: 'Focus', refresh: 'Refresh', suggestions: 'Suggestions', suggestBtn: 'Decide', due: 'To review', learn: 'Review', suggestPrompt: 'Show me the note suggestions waiting', scope: 'Scope', ticket: 'Ticket', toast: 'OKB: a proposal waits for your review — /okb:review', opened: 'OKB pane opened.', missing: 'OKB is not set up here: run “okb init” in a terminal.' },
}

async function refresh($: EngineInterface): Promise<OkbSnapshot | null> {
  try {
    const r = await $.process.run([`${$.plugin.root}/bin/okb`, 'status', '--brief', '--json'], { timeoutMs: 15_000, env: { OKB_NO_INTERACTIVE: '1' } })
    if (r.exitCode !== 0) return null
    const s = JSON.parse(r.stdout)
    const snap: OkbSnapshot = {
      ui: s.ui === 'en' ? 'en' : 'fr',
      line: String(s.line ?? ''),
      profile: String(s.profile ?? ''),
      name: String(s.name ?? s.profile ?? ''),
      focus: { exists: Boolean(s.focus?.exists), ageDays: s.focus?.ageDays ?? null, stale: Boolean(s.focus?.stale) },
      next: s.lastSession?.next ?? null,
      inbox: Number(s.inbox?.open ?? 0),
      pending: (s.pending ?? []).slice(0, 5).map((p: { number: number | null; title: string; files: number }) => ({ number: p.number, title: String(p.title), files: Number(p.files) })),
      notes: Number(s.notes ?? 0),
      suggestions: Number(s.suggestions ?? 0),
      due: Number(s.due ?? 0),
      scope: s.scope ? { repo: s.scope.repo ?? null, ticket: s.scope.ticket ?? null } : null,
    }
    await update($, snapshot, () => snap)
    $.ui.status(snap.line || undefined)
    return snap
  } catch {
    return null
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'okb', description: 'OKB — where your second brain stands, with shortcuts' })
    const snap = await refresh($)
    if (snap) await update($, pendingSeen, () => snap.pending.length)
    return next(e)
  })

  on('command.run', { command: 'okb' }, async $ => {
    const snap = await refresh($)
    if (!snap) return { text: L.fr.missing }
    await $.ui.open({ id: PANE, title: `📚 ${snap.name}` })
    return { text: `${snap.line} — ${L[snap.ui].opened}` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const before = await read($, pendingSeen)
    const snap = await refresh($)
    if (snap) {
      if (snap.pending.length > before) $.ui.toast(`📚 ${L[snap.ui].toast}`)
      await update($, pendingSeen, () => snap.pending.length)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    if (!snap) return <Box><Text dimColor>{L.fr.missing}</Text></Box>
    const l = L[snap.ui]
    const fill = (text: string) => () => $.prompt.fill({ text })
    return (
      <Box flexDirection="column">
        <Text bold>📚 {snap.name} · {snap.notes} {l.notes}</Text>
        <Text> </Text>
        {snap.scope?.repo && <Text>📦 {l.scope} : {snap.scope.repo}{snap.scope.ticket ? ` · 🎫 ${snap.scope.ticket}` : ''}</Text>}
        <Text>🎯 {l.focus} : {snap.focus.exists ? `${snap.focus.ageDays ?? 0} ${l.days}${snap.focus.stale ? ` · ${l.stale}` : ''}` : l.none}</Text>
        {snap.next && <Text>↪ {l.next} : {snap.next}</Text>}
        <Text>📥 {l.inbox} : {String(snap.inbox)}</Text>
        <Text>💡 {l.suggestions} : {String(snap.suggestions)} · 🃏 {l.due} : {String(snap.due)}</Text>
        <Text>⏳ {l.pending} : {snap.pending.length ? '' : l.nothing}</Text>
        {snap.pending.map(p => <Text dimColor>   #{String(p.number ?? '')} {p.title} · {String(p.files)}</Text>)}
        <Text> </Text>
        <Box flexDirection="row">
          {snap.pending.length > 0 && <Button key="review" label={l.review} variant="primary" hotkey="r" onPress={fill('/okb:review')} />}
          {snap.suggestions > 0 && <Button key="suggest" label={l.suggestBtn} hotkey="s" onPress={fill(l.suggestPrompt)} />}
          {snap.due > 0 && <Button key="learn" label={l.learn} hotkey="l" onPress={fill('/okb:learn')} />}
          {snap.scope?.ticket && <Button key="ticket" label={l.ticket} hotkey="t" onPress={fill('/okb-dev:ticket')} />}
          <Button key="done" label={l.done} hotkey="d" onPress={fill('/okb:done')} />
          <Button key="weekly" label={l.weekly} hotkey="w" onPress={fill('/okb:weekly')} />
          <Button key="capture" label={l.capture} hotkey="c" onPress={fill('/okb:capture ')} />
          <Button key="focus" label={l.focusBtn} hotkey="f" onPress={fill('/okb:focus')} />
          <Button key="refresh" label={l.refresh} hotkey="u" onPress={() => refresh($)} />
        </Box>
      </Box>
    )
  })
}
