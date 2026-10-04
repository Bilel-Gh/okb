// #/usage — what OKB costs and how its work holds up, read on this computer: no token spent.
import { state, h, t, tn, get, post, icon, loading, clear, toast, errorToast, copy, cmdBox } from '../core.js';
import { setTitle } from '../main.js';

const PERIODS = [7, 30, 90];
const KEY = 'okb-usage-days';

const nf = (d = 0) => new Intl.NumberFormat(state.lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const usd = (n) => `${nf(n < 10 ? 2 : 0).format(n)} $`;
const tok = (n) => (n >= 1e6 ? `${nf(1).format(n / 1e6)} M` : n >= 1e3 ? `${nf(0).format(n / 1e3)} k` : nf(0).format(n));
const pct = (x) => `${nf(0).format(x * 100)} %`;

/** Leads from the quality signals, same rules as the report. */
function qualityLeads(quality) {
  const out = [];
  for (const q of quality) {
    if (q.changesProposed >= 10 && q.changesDropped / q.changesProposed >= 0.2) {
      const kind = Object.entries(q.droppedByKind).sort((a, b) => b[1] - a[1])[0];
      out.push(t('report.lead.dropped', { kb: q.kb, share: String(Math.round((q.changesDropped / q.changesProposed) * 100)), kind: kind ? kind[0] : '' }));
    }
    if (q.appliedFiles >= 5 && q.editedAfter / q.appliedFiles >= 0.25) out.push(t('report.lead.edited', { kb: q.kb, share: String(Math.round((q.editedAfter / q.appliedFiles) * 100)) }));
    if (q.pending >= 3 || (q.pendingOldestDays ?? 0) >= 7) out.push(t('report.lead.pending', { kb: q.kb, count: String(q.pending), days: String(q.pendingOldestDays ?? 0) }));
    if (q.rolledBack) out.push(t('report.lead.rolledBack', { kb: q.kb, count: String(q.rolledBack) }));
  }
  return out;
}

function tile(label, value, sub) {
  return h('div', { class: 'card usage-tile' }, h('div', { class: 'nav-label', style: { padding: 0 } }, label), h('div', { class: 'usage-big' }, value), sub ? h('div', { class: 'small muted' }, sub) : null);
}

/** Cost per day, OKB above the rest of Claude Code, as plain SVG bars. */
function dailyChart(daily, days) {
  const end = new Date();
  const list = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const row = daily.find((x) => x.day === d) ?? { okbCostUsd: 0, otherCostUsd: 0 };
    list.push({ day: d, okb: row.okbCostUsd, other: row.otherCostUsd });
  }
  const max = Math.max(0.01, ...list.map((x) => x.okb + x.other));
  const W = 1000, H = 130, gap = 2, bw = Math.max(2, (W - gap * list.length) / list.length);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 18}`);
  svg.setAttribute('class', 'usage-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('web.usage.daily'));
  list.forEach((x, i) => {
    const xPos = i * (bw + gap);
    const hOkb = (x.okb / max) * H;
    const hOther = (x.other / max) * H;
    const add = (y, hgt, cls, title) => {
      if (hgt <= 0) return;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', String(xPos)); r.setAttribute('y', String(y)); r.setAttribute('width', String(bw)); r.setAttribute('height', String(Math.max(1, hgt))); r.setAttribute('rx', '2');
      r.setAttribute('class', cls);
      const tt = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      tt.textContent = title;
      r.append(tt);
      svg.append(r);
    };
    add(H - hOkb, hOkb, 'bar-okb', `${x.day} · OKB ${usd(x.okb)}`);
    add(H - hOkb - hOther, hOther, 'bar-other', `${x.day} · ${t('web.usage.other')} ${usd(x.other)}`);
    const step = days <= 7 ? 1 : days <= 31 ? 7 : 30;
    if (i === 0 || i === list.length - 1 || (i % step === 0 && i < list.length - Math.max(2, step / 2))) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(xPos + bw / 2)); label.setAttribute('y', String(H + 14)); label.setAttribute('text-anchor', i === 0 ? 'start' : i === list.length - 1 ? 'end' : 'middle');
      label.setAttribute('class', 'axis');
      label.textContent = x.day.slice(5).replace('-', '/');
      svg.append(label);
    }
  });
  return h('div', null, svg, h('div', { class: 'row small muted', style: { gap: '14px', marginTop: '6px' } },
    h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'usage-swatch okb' }), 'OKB'),
    h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'usage-swatch other' }), t('web.usage.other'))));
}

function bar(value, max) {
  return h('span', { class: 'usage-bar' }, h('span', { style: { width: `${Math.max(2, (value / Math.max(max, 1e-9)) * 100)}%` } }));
}

function table(head, rows) {
  return h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, head.map((c) => h('th', { style: c.num ? { textAlign: 'right' } : null }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((cell, i) => h('td', { style: head[i]?.num ? { textAlign: 'right', whiteSpace: 'nowrap' } : null }, cell)))))));
}

export async function render({ mount }) {
  setTitle(t('web.nav.usage'));
  let days = 30;
  try { days = Number(localStorage.getItem(KEY)) || 30; } catch { /* private mode */ }
  const body = h('div');
  const periods = h('div', { class: 'seg' });
  const drawPeriods = () => clear(periods).append(...PERIODS.map((d) => h('button', { class: `btn sm${d === days ? ' primary' : ''}`, onclick: () => { days = d; try { localStorage.setItem(KEY, String(d)); } catch { /* ignore */ } drawPeriods(); load(); } }, tn('web.usage.days', d))));
  drawPeriods();
  mount.append(h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' } },
    h('p', { class: 'lead muted', style: { margin: 0, maxWidth: '640px' } }, t('web.usage.lead')), periods), body);

  async function load() {
    clear(body).append(loading(5));
    let data;
    try { data = await get('/api/usage', { days }); } catch (e) { clear(body); errorToast(e); return; }
    clear(body);
    draw(data);
  }

  function draw(data) {
    const { stats, quality, commands, feedback } = data;
    const okb = stats.okb;
    const total = okb.costUsd + stats.other.costUsd;
    const q = quality.reduce((a, x) => ({ applied: a.applied + x.applied, proposals: a.proposals + x.proposals - x.superseded, dropped: a.dropped + x.changesDropped, changes: a.changes + x.changesProposed, edited: a.edited + x.editedAfter, files: a.files + x.appliedFiles }), { applied: 0, proposals: 0, dropped: 0, changes: 0, edited: 0, files: 0 });

    body.append(h('div', { class: 'grid cols-4', style: { marginBottom: '14px' } },
      tile(t('web.usage.cost'), usd(okb.costUsd), total > 0 ? t('web.usage.costSub', { share: pct(okb.costUsd / total), other: usd(stats.other.costUsd) }) : t('web.usage.costNone')),
      tile(t('web.usage.tasks'), nf(0).format(okb.runs), okb.runs ? t('web.usage.tasksSub', { tokens: tok(okb.tokens), avg: usd(okb.costUsd / okb.runs) }) : t('web.usage.tasksNone')),
      tile(t('web.usage.cache'), okb.cacheHitRatio === null ? '—' : pct(okb.cacheHitRatio), t('web.usage.cacheSub')),
      tile(t('web.usage.quality'), q.proposals ? `${q.applied}/${q.proposals}` : '—', q.proposals ? t('web.usage.qualitySub', { dropped: String(q.dropped), changes: String(q.changes), edited: String(q.edited), files: String(q.files) }) : t('web.usage.qualityNone'))));

    const leads = [...stats.advice.map((a) => t(a.key, a.params)), ...qualityLeads(quality)];
    if (leads.length) {
      body.append(h('div', { class: 'card', style: { marginBottom: '14px', borderLeft: '3px solid var(--warn, #d97706)' } },
        h('div', { class: 'card-head' }, icon('sparkles', 17), h('h2', null, t('report.leads'))),
        h('ul', { class: 'usage-leads' }, leads.map((l) => h('li', null, l)))));
    }

    if (!okb.runs) {
      body.append(h('div', { class: 'card', style: { marginBottom: '14px' } },
        h('div', { class: 'card-head' }, icon('info', 17), h('h2', null, t('web.usage.emptyTitle'))),
        h('p', { class: 'muted', style: { marginTop: 0 } }, t('web.usage.emptyText', { logs: String(stats.logs) }))));
    }

    body.append(h('div', { class: 'card', style: { marginBottom: '14px' } },
      h('div', { class: 'card-head' }, icon('usage', 17), h('h2', null, t('web.usage.daily')), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, t('usage.subtitle', { prices: stats.pricesAsOf }))),
      dailyChart(stats.daily, data.days)));

    if (okb.runs) {
      const maxW = Math.max(...okb.byWorkflow.map((w) => w.costUsd));
      body.append(h('div', { class: 'card', style: { marginBottom: '14px' } },
        h('div', { class: 'card-head' }, icon('bolt', 17), h('h2', null, t('report.cost'))),
        h('p', { class: 'small muted', style: { marginTop: 0 } }, t('web.usage.workflowHelp')),
        table([{ label: t('report.col.workflow') }, { label: '' }, { label: t('report.col.runs'), num: true }, { label: t('report.col.total'), num: true }, { label: t('report.col.avg'), num: true }, { label: t('report.col.avgTokens'), num: true }, { label: t('report.col.agents'), num: true }, { label: t('report.col.minutes'), num: true }],
          okb.byWorkflow.map((w) => [h('code', null, w.workflow), bar(w.costUsd, maxW), String(w.runs), usd(w.costUsd), usd(w.avgCostUsd), tok(w.avgTokens), usd(w.agentsCostUsd), nf(1).format(w.medianMinutes)]))));

      const maxM = Math.max(...okb.byModel.map((m) => m.costUsd));
      body.append(h('div', { class: 'grid cols-2', style: { marginBottom: '14px' } },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('sparkles', 17), h('h2', null, t('usage.byModel'))),
          table([{ label: t('report.col.model') }, { label: '' }, { label: t('report.col.total'), num: true }, { label: t('report.col.tokens'), num: true }], okb.byModel.map((m) => [m.label, bar(m.costUsd, maxM), usd(m.costUsd), tok(m.tokens)])),
          okb.agents.length ? h('div', { style: { marginTop: '12px' } }, h('div', { class: 'nav-label', style: { padding: 0 } }, t('usage.agents')),
            table([{ label: t('web.usage.agent') }, { label: t('report.col.runs'), num: true }, { label: t('report.col.total'), num: true }, { label: t('report.col.model') }], okb.agents.map((a) => [h('code', null, a.type.replace(/^okb:/, '')), String(a.runs), usd(a.costUsd), a.models.join(', ')]))) : null),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('file', 17), h('h2', null, t('report.context'))),
          h('p', { class: 'small muted', style: { marginTop: 0 } }, t('web.usage.contextHelp')),
          h('div', { class: 'stack', style: { gap: '4px', marginBottom: '10px' } },
            h('div', { class: 'small' }, t('report.context.skills', { tokens: tok(okb.skillTokensEstimated) })),
            okb.hook.runs ? h('div', { class: 'small' }, t('report.context.hook', { runs: String(okb.hook.runs), tokens: tok(Math.round(okb.hook.tokensEstimated / okb.hook.runs)) })) : null),
          okb.outputs.length ? table([{ label: t('report.col.command') }, { label: t('report.col.calls'), num: true }, { label: t('report.col.perCall'), num: true }], okb.outputs.slice(0, 8).map((o) => [h('code', null, `okb ${o.command}`), String(o.calls), tok(Math.round(o.tokensEstimated / Math.max(1, o.calls)))])) : null)));
    }

    body.append(h('div', { class: 'grid cols-2', style: { marginBottom: '14px' } },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('review', 17), h('h2', null, t('report.quality'))),
        h('p', { class: 'small muted', style: { marginTop: 0 } }, t('web.usage.qualityHelp')),
        quality.length ? table([{ label: t('report.col.kb') }, { label: t('report.col.applied'), num: true }, { label: t('report.col.dropped'), num: true }, { label: t('report.col.pending'), num: true }, { label: t('report.col.review'), num: true }, { label: t('report.col.edited'), num: true }],
          quality.map((x) => [x.kb, `${x.applied}/${x.proposals - x.superseded}`, `${x.changesDropped}/${x.changesProposed}`, x.pending ? `${x.pending} (${x.pendingOldestDays} j)` : '0', x.reviewHoursMedian === null ? '—' : `${nf(1).format(x.reviewHoursMedian)} h`, `${x.editedAfter}/${x.appliedFiles}`]))
          : h('p', { class: 'muted' }, t('report.noQuality'))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('terminal', 17), h('h2', null, t('report.commands'))),
        commands.length ? table([{ label: t('report.col.command') }, { label: t('report.col.calls'), num: true }, { label: t('report.col.failures'), num: true }, { label: t('report.col.medianMs'), num: true }],
          commands.slice(0, 10).map((c) => [h('code', null, `okb ${c.command}`), String(c.calls), c.failures ? h('span', { title: Object.entries(c.codes).map(([k, n]) => `${k} × ${n}`).join(', ') }, String(c.failures)) : '0', nf(0).format(c.medianMs)]))
          : h('p', { class: 'muted' }, t('report.noCommands')))));

    // Remarks and the report: the loop to improve OKB.
    const text = h('textarea', { class: 'input', rows: 3, placeholder: t('web.usage.feedbackPlaceholder'), 'aria-label': t('web.usage.feedbackTitle') });
    const list = h('div', { class: 'stack', style: { gap: '6px', marginTop: '10px' } }, feedback.slice(-8).reverse().map((f) => h('div', { class: 'small' }, h('span', { class: 'muted' }, `${f.at.slice(0, 10)} · `), f.text)));
    const reportBox = h('div');
    body.append(h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('alert', 17), h('h2', null, t('web.usage.feedbackTitle'))),
        h('p', { class: 'small muted', style: { marginTop: 0 } }, t('web.usage.feedbackHelp')), text,
        h('div', { class: 'row', style: { marginTop: '8px', gap: '8px' } }, h('button', { class: 'btn primary sm', onclick: async () => {
          const value = text.value.trim();
          if (!value) return;
          try { await post('/api/feedback', { text: value, kb: state.kb ?? undefined }); toast(t('feedback.saved')); text.value = ''; list.prepend(h('div', { class: 'small' }, h('span', { class: 'muted' }, `${new Date().toISOString().slice(0, 10)} · `), value)); } catch (e) { errorToast(e); }
        } }, icon('check', 14), t('web.usage.feedbackSave'))), list),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('file', 17), h('h2', null, t('web.usage.reportTitle'))),
        h('p', { class: 'small muted', style: { marginTop: 0 } }, t('web.usage.reportHelp')),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
          h('button', { class: 'btn sm', onclick: async () => {
            try {
              const r = await get('/api/usage/report', { days });
              clear(reportBox).append(h('pre', { class: 'usage-report' }, r.markdown));
              await copy(r.markdown);
              toast(t('web.usage.reportCopied'));
            } catch (e) { errorToast(e); }
          } }, icon('copy', 14), t('web.usage.reportCopy'))),
        h('div', { style: { marginTop: '8px' } }, cmdBox(`okb report --days ${days}`)), reportBox)));
  }

  await load();
}
