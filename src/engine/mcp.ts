import { createInterface } from 'node:readline';
import { loadConfig } from '../config/load.js';
import { productVersion } from '../integrations/system.js';
import { OkbError } from '../util/errors.js';
import { findSecrets } from '../security/secrets.js';
import { available, invoke, jsonSchemaOf, operation, type AnyOperation } from './registry.js';

/**
 * `okb mcp`: the engine's operations for the assistants of the terminal
 * (Claude Code, Codex, Copilot, Cursor), over MCP in stdio (F2.0-17). Every
 * call is an agent's: a 🔒 note stays hidden, and nothing approves, applies or
 * decides for the person. Only the operations of the modules in use are listed.
 */
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Reply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

/** MCP tool names: letters, digits, `_` and `-`. */
export const toolName = (id: string) => id.replace(/\./g, '_');
const opOfTool = (name: string) => name.replace(/_/g, '.');
// In-app sessions cannot enact their own suggestions or fetch private operational state.
const ASSISTANT_READS = new Set(['notes.find', 'notes.read', 'documents.list', 'shared.find', 'shared.read', 'shared.glossary', 'kb.status', 'repos.list']);

function tool(op: AnyOperation) {
  return {
    name: toolName(op.id),
    title: op.id,
    description: op.summary,
    inputSchema: jsonSchemaOf(op.input),
    annotations: { readOnlyHint: op.effect === 'read', destructiveHint: false, idempotentHint: op.effect === 'read', openWorldHint: false },
  };
}

export function mcpHandler(options: { env?: NodeJS.ProcessEnv; kb?: string } = {}) {
  const env = options.env ?? process.env;
  const allowed = (op: AnyOperation) => op.agents !== false && (env.OKB_MCP_POLICY !== 'assistant' || (op.effect === 'read' && ASSISTANT_READS.has(op.id)));
  return async function handle(message: Message): Promise<Reply | null> {
    const id = message.id ?? null;
    const ok = (result: unknown): Reply => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, text: string): Reply => ({ jsonrpc: '2.0', id, error: { code, message: text } });
    const secretReply = () => ok({ content: [{ type: 'text', text: 'E_SECRET: this tool result contains a secret; no content was returned.' }], isError: true });
    // A notification (no id) never gets an answer.
    if (message.id === undefined) return null;
    switch (message.method) {
      case 'initialize': {
        const asked = String(message.params?.protocolVersion ?? '');
        return ok({
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'okb', title: 'OKB', version: await productVersion() },
          instructions: 'The person’s knowledge base. Search before exploring (notes_find), read a note by its path (notes_read). To write a note, add a suggestion card (suggestions_add): the person decides in OKB; nothing is written without their yes.',
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: (await available(env)).filter(allowed).map(tool) });
      case 'tools/call': {
        const name = String(message.params?.name ?? '');
        const op = operation(opOfTool(name));
        if (!op || toolName(op.id) !== name || !allowed(op)) return fail(-32602, findSecrets(name).length ? 'Unknown tool.' : `Unknown tool: ${name}`);
        try {
          const { config } = await loadConfig({ env, ...(options.kb ? { profileId: options.kb } : {}) });
          const out = await invoke(op.id, message.params?.arguments ?? {}, { config, env, actor: 'agent' });
          const text = JSON.stringify(out);
          // Tool results are a second egress after the initial prompt. Inspect metadata, snippets
          // and full text together; neither structuredContent nor a diagnostic may leak a token.
          if (findSecrets(text).length) return secretReply();
          return ok({ content: [{ type: 'text', text }], structuredContent: out });
        } catch (error) {
          const e = error instanceof OkbError ? error : null;
          const text = e ? `${e.code}${e.key ? ` (${e.key})` : ''}: ${e.message}${e.hint ? `\n${e.hint}` : ''}` : 'OKB could not answer.';
          if (findSecrets(text).length) return secretReply();
          return ok({ content: [{ type: 'text', text }], isError: true });
        }
      }
      default:
        return fail(-32601, `Method not found: ${message.method ?? ''}`);
    }
  };
}

/** The stdio transport: one JSON-RPC message per line in, one per line out; logs go to stderr. */
export async function serveMcp(options: { env?: NodeJS.ProcessEnv; kb?: string } = {}): Promise<void> {
  const handle = mcpHandler(options);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = (reply: Reply) => process.stdout.write(`${JSON.stringify(reply)}\n`);
  const pending: Promise<void>[] = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    pending.push(handle(message).then((reply) => { if (reply) send(reply); }, () => {
      process.stderr.write('okb mcp: could not handle the message\n');
      send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: 'Internal error' } });
    }));
  }
  await Promise.all(pending);
}
