#!/usr/bin/env node
/**
 * Keeps the approval step human.
 *
 * `okb apply` verifies a signed approval before writing, but that signature is
 * produced by `okb review --approve`, which runs on the same machine with the
 * same key. Nothing in the CLI can tell "the user typed it" from "the agent typed
 * it". This hook is what draws that line: it denies the approval command when it
 * comes from a tool call.
 *
 * Honest limits, stated rather than implied:
 *  - It only sees Bash tool calls from this Claude Code session. A differently
 *    configured agent, another MCP server with shell access, or a user who
 *    disables plugin hooks bypasses it entirely.
 *  - It is a string matcher. It covers the obvious spellings, not every possible
 *    obfuscation.
 * This is a best-effort guard against accidental self-approval. It does not
 * isolate an adversarial model from the key or exhaustively parse shell code.
 */

// Only OKB's own approval: `gh pr review --approve` and other tools pass untouched.
const OKB = /(^|[\s;&|(`'"\/])(okb|okb-local|index\.js)(\s|$)/;
const APPROVE = /\breview\b[\s\S]*?--approve(?:\s|=|$)/;
// A pseudo-terminal would turn OKB's interactive approval into something an agent can type.
const PTY_WRAP = /(^|[;&|(]\s*|\$\(\s*)(script|expect|unbuffer|socat)\s[^;&|]*\bokb\s+(review|undo|kb|init|new|settings|update)\b/;
// The local web app approves only with a person's confirmation on screen; never drive it from a tool call.
// Any HTTP client aimed at the local web app's approval endpoints (/api/proposal/approve, …).
const WEB_APPROVE = /\b(curl|wget|http|https|xh|fetch|nc|node|python3?|osascript)\b[\s\S]*(127\.0\.0\.1|localhost|\[::1\])[\s\S]*\/api\/[\w/-]*(approve|presence|review|settings)/;
// Clicking OKB's native approval dialog from a script is approving for the person.
const DIALOG_CLICK = /\bosascript\b[\s\S]*\b(System Events|click button)\b[\s\S]*\b(OKB|Approuver|Approve)\b/i;
const ENV_ESCAPE = /OKB_APPLY_MODE\s*=\s*allow-direct/;
// D71: whether the agent files notes directly is the person's setting, never a tool's.
const AGENT_WRITES = /\b(agentWrites|review\.(auto|offer))\b/;
const PROFILE_TOUCH = /(profile\.ya?ml|\bsettings\s+set\b)/;
const KEY_READ = /(cat|less|more|head|tail|xxd|od|strings|cp|mv)\b[^;&|]*approval\.key/;
// The person's yes to a suggestion is recorded by OKB's hooks from what they did, never by a tool call.
const CONSENT = /\bsuggest\s+consent\b|consent\.jsonl|\bsecret\s+allow\b|unlocked\.json/;

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const command = String(payload?.tool_input?.command ?? '');
  // D71: an Edit or Write of a profile that sets how notes are filed is the person's own change (C1).
  const file = String(payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path ?? '');
  const written = ['content', 'new_string', 'edits'].map((k) => JSON.stringify(payload?.tool_input?.[k] ?? '')).join(' ');
  const deny = (reason) => {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }),
      () => process.exit(0),
    );
  };

  if (/profile\.ya?ml$/.test(file) && (AGENT_WRITES.test(written) || /\boffer\s*:|\bauto\s*:/.test(written))) {
    return deny('Whether the agent files notes directly is the user\'s own setting. Ask them to change it in OKB\'s settings.');
  }
  if (OKB.test(command) && APPROVE.test(command)) {
    return deny(
      'Approving an okb proposal is the user\'s decision. Show them the diff and the exact ' +
        '`okb review <id> --approve [--only …]` line, and let them run it themselves.',
    );
  }
  if (PTY_WRAP.test(command)) {
    return deny('OKB\'s interactive questions are for the person at the keyboard. Run okb without a pseudo-terminal wrapper, and leave approvals to the user.');
  }
  if (WEB_APPROVE.test(command)) {
    return deny('Approving through the OKB web app is the user\'s decision, confirmed on their screen. Do not call its approval endpoint.');
  }
  if (DIALOG_CLICK.test(command)) {
    return deny('The OKB approval dialog is answered by the person, not by a script.');
  }
  if (AGENT_WRITES.test(command) && PROFILE_TOUCH.test(command)) {
    return deny('Whether the agent files notes directly is the user\'s own setting. Ask them to change it in OKB\'s settings.');
  }
  if (ENV_ESCAPE.test(command)) {
    return deny('OKB_APPLY_MODE=allow-direct bypasses the review step. Ask the user to change it in their profile if they want it.');
  }
  if (CONSENT.test(command)) {
    return deny('A yes to a suggestion, or opening a 🔒 note to Claude, comes from the person (their click or their own message), recorded by OKB itself. Show the card or ask them.');
  }
  if (KEY_READ.test(command)) {
    return deny('The approval key is not readable from a tool call; reading it would defeat the approval signature.');
  }

  process.exit(0);
});
