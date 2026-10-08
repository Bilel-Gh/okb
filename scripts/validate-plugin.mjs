import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import YAML from 'yaml';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const marketplace = JSON.parse(await readFile(resolve(root, '.claude-plugin/marketplace.json'), 'utf8'));

// The core plugin and its modules, as the marketplace lists them.
const plugins = marketplace.plugins.map((p) => ({ name: p.name, dir: resolve(root, p.source), entry: p }));
assert.deepEqual(plugins.map((p) => p.name).sort(), ['okb', 'okb-dev']);
let count = 0;
const skills = new Set();
for (const p of plugins) {
  const manifest = JSON.parse(await readFile(resolve(p.dir, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version, `${p.name}: plugin version follows the package`);
  assert.equal(manifest.name, p.name);
  assert.equal(manifest.agents, undefined, 'default agents/ discovery avoids invalid directory-valued agents manifests');
  assert.equal(manifest.hooks, undefined, 'hooks/hooks.json is auto-discovered exactly once');
  if (p.name !== 'okb') assert.deepEqual(manifest.dependencies, ['okb'], `${p.name}: a module depends on the core`);
  for (const kind of ['skills', 'agents', 'commands']) {
    const entries = await readdir(resolve(p.dir, kind)).catch(() => []);
    for (const entry of entries) {
      const path = resolve(p.dir, kind, entry, ...(kind === 'skills' ? ['SKILL.md'] : []));
      const raw = await readFile(path, 'utf8');
      const fm = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? '');
      assert.ok(fm?.description, `${path}: description required`);
      if (kind === 'skills') {
        assert.equal(fm.name, entry);
        assert.ok(!skills.has(entry), `${entry}: one skill name across plugins`);
        skills.add(entry);
        if (p.name !== 'okb') assert.ok(entry.startsWith(`${p.name}-`), `${entry}: a module's skills carry its name`);
      }
      if (kind === 'commands') assert.equal(fm['disable-model-invocation'], true);
      if (kind === 'agents') assert.ok(!/Bash|Write|Edit/.test(fm.tools));
      assert.equal(fm['allowed-tools'], undefined, 'do not silently pre-authorise arbitrary Bash');
      count++;
    }
  }
}
const core = plugins.find((p) => p.name === 'okb').dir;
const hooks = JSON.parse(await readFile(resolve(core, 'hooks/hooks.json'), 'utf8'));
assert.equal(hooks.hooks.PreToolUse.length >= 1, true);
await stat(resolve(core, 'hooks/guard-approval.mjs'));
assert.equal(hooks.hooks.SessionStart.length, 1, 'one SessionStart hook gives the focus and the brain');
await stat(resolve(core, 'hooks/session-focus.mjs'));
const bin = await stat(resolve(core, 'bin/okb'));
assert.ok(bin.mode & 0o111, 'plugin/bin/okb must be executable: Claude Code puts plugin bin/ on the Bash PATH');
const engine = await stat(resolve(core, 'scripts/engine.sh'));
assert.ok(engine.mode & 0o111, 'the engine installer must be executable');
console.log(JSON.stringify({ ok: true, plugins: plugins.length, components: count, validator: 'local static checks; native Claude validation is separate' }));
