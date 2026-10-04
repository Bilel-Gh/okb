import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * Approving from the web app needs the person, not just a request: the local
 * server asks for a confirmation that an agent driving HTTP cannot give.
 *
 * - macOS: a native dialog on the person's screen (Approve / Cancel).
 * - elsewhere: a yes/no question in the terminal that runs `okb serve`, when it
 *   is a real terminal.
 * - otherwise: no approval from the web; the page shows the terminal command.
 *
 * Honest limit, as for the CLI hook: this protects against an agent calling the
 * API, not against software that controls the person's mouse and keyboard.
 */
export type Presence = 'confirmed' | 'refused' | 'unavailable';

export function presenceMethod(): 'dialog' | 'terminal' | 'none' {
  if (process.env.OKB_WEB_APPROVAL === 'off') return 'none';
  if (process.platform === 'darwin' && !process.env.OKB_NO_DIALOG) return 'dialog';
  if (process.stdin.isTTY && process.stdout.isTTY) return 'terminal';
  return 'none';
}

function osa(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 400);
}

export async function confirmPresence(message: string, labels: { approve: string; cancel: string; title: string }): Promise<Presence> {
  const method = presenceMethod();
  if (method === 'dialog') {
    const script = `display dialog "${osa(message)}" with title "${osa(labels.title)}" buttons {"${osa(labels.cancel)}", "${osa(labels.approve)}"} default button "${osa(labels.approve)}" cancel button "${osa(labels.cancel)}" with icon caution giving up after 120`;
    return new Promise((done) => {
      execFile('osascript', ['-e', script], { timeout: 130_000 }, (error, stdout) => {
        if (error) return done(/User canceled|-128/.test(String(error.message) + String((error as { stderr?: string }).stderr ?? '')) ? 'refused' : 'unavailable');
        const out = String(stdout);
        if (/gave up:true/.test(out)) return done('refused');
        done(out.includes(`button returned:${labels.approve}`) ? 'confirmed' : 'refused');
      });
    });
  }
  if (method === 'terminal') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((done) => {
      const timer = setTimeout(() => { rl.close(); done(''); }, 120_000);
      rl.question(`\n${message}\n${labels.approve} ? [y/N] `, (a) => { clearTimeout(timer); rl.close(); done(a); });
    });
    return /^(y|yes|o|oui)$/i.test(answer.trim()) ? 'confirmed' : 'refused';
  }
  return 'unavailable';
}
