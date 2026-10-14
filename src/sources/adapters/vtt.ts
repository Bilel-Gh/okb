import { OkbError } from '../../util/errors.js';
import {
  buildOutline,
  makeBlock,
  type Acquired,
  type Adapter,
  type Block,
  type NormalizedDoc,
  type SourceRecord,
} from '../types.js';
import { sha256 } from '../../util/hash.js';

const TIME_RE =
  /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})/;

function parseClock(h: string | undefined, m: string, s: string, ms: string): number {
  return (
    Number.parseInt(h ?? '0', 10) * 3_600_000 +
    Number.parseInt(m, 10) * 60_000 +
    Number.parseInt(s, 10) * 1000 +
    Number.parseInt(ms, 10)
  );
}

/** `<v Alice>text</v>` and `Alice: text` are the two speaker forms in the wild. */
function splitSpeaker(line: string): { speaker?: string; text: string } {
  const voice = /^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/.exec(line.trim());
  if (voice) return { speaker: voice[1]!.trim(), text: voice[2]!.trim() };
  const colon = /^([A-Z][\w .'-]{1,40}):\s+(.*)$/.exec(line);
  // Common caption labels are content, not a person named "Correction".
  if (colon && !/^(correction|erratum|actually|en fait|decision|décision|action|question|note|suggestion)$/i.test(colon[1]!.trim())) return { speaker: colon[1]!.trim(), text: colon[2]!.trim() };
  return { text: line.trim() };
}

function stripTags(text: string): string {
  return text.replace(/<\/?[cviblu](?:\.[^>\s]+)?(?:\s[^>]*)?>/g, '').replace(/<\d\d:[^>]*>/g, '');
}

export const vttAdapter: Adapter = {
  name: 'vtt',
  version: '3',
  kind: 'vtt',

  matches(input: Acquired): boolean {
    const head = Buffer.from(input.bytes.slice(0, 32)).toString('utf8');
    return /^\uFEFF?WEBVTT/.test(head) || (input.filename ?? '').toLowerCase().endsWith('.vtt');
  },

  async extract(input: Acquired, sourceId: string): Promise<NormalizedDoc> {
    const text = Buffer.from(input.bytes).toString('utf8').replace(/\r\n/g, '\n');
    if (!/^\uFEFF?WEBVTT/.test(text)) {
      throw new OkbError('E_EXTRACTION', 'file does not start with the WEBVTT signature', {
        detail: { uri: input.uri },
        hint: 'A .vtt file must begin with `WEBVTT`. Check the file is not a .srt renamed.',
      });
    }

    const blocks: Block[] = [];
    const limitations: string[] = [];
    let title: string | undefined;
    let index = 0;
    let malformedCues = 0;

    const chunks = text.split(/\n{2,}/);
    for (const chunk of chunks) {
      const lines = chunk.split('\n').filter((l) => l.trim() !== '');
      if (lines.length === 0) continue;
      const first = lines[0]!;

      if (/^\uFEFF?WEBVTT/.test(first)) {
        const rest = first.replace(/^\uFEFF?WEBVTT\s*-?\s*/, '').trim();
        if (rest) title = rest;
        continue;
      }
      if (/^NOTE\b/.test(first) || /^STYLE\b/.test(first) || /^REGION\b/.test(first)) continue;

      let timingLine = first;
      if (!TIME_RE.test(timingLine) && lines.length > 1) timingLine = lines[1]!;
      const m = TIME_RE.exec(timingLine);
      if (!m) {
        malformedCues += 1;
        continue;
      }
      const startMs = parseClock(m[1], m[2]!, m[3]!, m[4]!);
      const endMs = parseClock(m[5], m[6]!, m[7]!, m[8]!);
      if ([m[2],m[3],m[6],m[7]].some(v => Number(v) > 59) || endMs <= startMs) { malformedCues += 1; continue; }
      const payloadLines = lines.slice(lines.indexOf(timingLine) + 1);
      if (payloadLines.length === 0) continue;

      const segments: { speaker?: string; text: string[] }[] = [];
      for (const line of payloadLines) {
        const voices = [...line.matchAll(/<v\s+([^>]+)>([\s\S]*?)(?=<v\s+|$)/g)];
        const pieces = voices.length ? voices.map(m => ({ speaker: m[1]!.trim(), text: m[2]! })) : [splitSpeaker(line)];
        for (const parsed of pieces) {
          const text = decodeCaption(stripTags(parsed.text)).trim(); if (!text) continue;
          const speaker = parsed.speaker ?? segments.at(-1)?.speaker;
          const last = segments.at(-1);
          if (last && last.speaker === speaker) last.text.push(text);
          else segments.push({ speaker, text: [text] });
        }
      }
      for (const segment of segments) blocks.push(makeBlock(sourceId, index++, 'cue', segment.text.join(' '), { kind: 'timecode', startMs, endMs }, { speaker: segment.speaker }));
    }

    if (malformedCues > 0) {
      limitations.push(`${malformedCues} cue block(s) had no parseable timing line and were skipped`);
    }
    if (blocks.length === 0) {
      limitations.push('no readable cue was found');
    }
    limitations.push('spoken punctuation and speaker attribution come from the caption file, not from audio');

    const source: SourceRecord = {
      id: sourceId,
      uri: input.uri,
      kind: 'vtt',
      adapter: vttAdapter.name,
      adapterVersion: vttAdapter.version,
      sha256: sha256(input.bytes),
      bytes: input.bytes.byteLength,
      acquiredAt: new Date().toISOString(),
      support: blocks.length === 0 ? 'unsupported' : malformedCues > 0 ? 'partial' : 'full',
      limitations,
      ...(title ? { title } : {}),
      ...(input.contentType ? { contentType: input.contentType } : {}),
    };

    return { source, blocks, outline: buildOutline(blocks) };
  },
};

function decodeCaption(s: string): string {
  return s.replace(/&(amp|lt|gt|nbsp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, key: string) => {
    const fixed: Record<string,string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'" };
    if (fixed[key.toLowerCase()]) return fixed[key.toLowerCase()]!;
    const n = key.toLowerCase().startsWith('#x') ? parseInt(key.slice(2),16) : parseInt(key.slice(1),10);
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}
