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
const WEB_APPROVE = /\b(curl|wget|http|fetch|nc)\b[\s\S]*(127\.0\.0\.1|localhost)[\s\S]*\/api\/(approve|presence)/;
const ENV_ESCAPE = /OKB_APPLY_MODE\s*=\s*allow-direct/;
const KEY_READ = /(cat|less|more|head|tail|xxd|od|strings|cp|mv)\b[^;&|]*approval\.key/;

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
  if (ENV_ESCAPE.test(command)) {
    return deny('OKB_APPLY_MODE=allow-direct bypasses the review step. Ask the user to change it in their profile if they want it.');
  }
  if (KEY_READ.test(command)) {
    return deny('The approval key is not readable from a tool call; reading it would defeat the approval signature.');
  }

  process.exit(0);
});
