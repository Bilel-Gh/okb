import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { metaForDir, metaHeadline, parseGitmodules, readMetaRepo, readMetaWorkspace } from '../src/work/meta-repos.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

/** A fictitious workspace with the structure of a team's meta-repositories. */
async function workspace() {
  const root = await mkdtemp(resolve(tmpdir(), 'okb-meta-')); roots.push(root);
  const put = async (p: string, text: string) => { await mkdir(dirname(resolve(root, p)), { recursive: true }); await writeFile(resolve(root, p), text); };
  await put('knowledge/onboarding.md', '# Arriver dans l’équipe\n');
  await put('livraison-demo/.gitmodules', [
    '[submodule "panier-web"]', '\tpath = panier-web', '\turl = https://git.example/demo/panier-web.git', '\tbranch = main',
    '[submodule "paiement-api"]', '\tpath = paiement-api', '\turl = https://git.example/demo/paiement-api.git',
    '[submodule "dependencies/catalogue"]', '\tpath = dependencies/catalogue', '\turl = https://git.example/autre/catalogue.git', '',
  ].join('\n'));
  await put('livraison-demo/panier-web/README.md', '# panier-web\n');
  await put('livraison-demo/dependencies/catalogue/README.md', '# catalogue\n');
  await put('livraison-demo/compliance/delivery.yaml', 'owners:\n  - name: Alice Martin\n  - bob@example.com\npipelines:\n  build:\n    type: github-actions\n    url: https://ci.example/demo/build\n  release:\n    type: jenkins\n');
  await put('livraison-demo/.github/CODEOWNERS', '* @demo/equipe-panier\n/paiement-api/ @carla\n');
  await put('livraison-demo/.github/workflows/scan.yml', 'name: Scan de sécurité\non: push\n');
  await put('livraison-demo/docs/composants/panier.md', '---\ntitle: x\n---\n# Le composant panier\n');
  await put('livraison-demo/docs/glossaire.md', '# Glossaire\n\n| Terme | Définition |\n|---|---|\n| MD | Une livraison de maintenance |\n\n- **Remise** : une baisse du prix accordée au client\n\n## Panier\n\nLa liste des articles avant paiement.\n');
  await put('livraison-demo/KT/2026-10-passation.md', '# Passation octobre\n');
  await put('livraison-demo/.github/skills/livrer-md/SKILL.md', '---\nname: livrer-md\ndescription: Livre une livraison de maintenance de bout en bout.\n---\n\nÉtapes…\n');
  await put('outils/README.md', '# pas un méta-repo\n');
  await put('avec-sous-modules/.gitmodules', '[submodule "x"]\n\tpath = x\n\turl = https://git.example/x.git\n');
  return root;
}

describe('the team map from its meta-repositories (chantier 3)', () => {
  it('reads .gitmodules sections', () => {
    expect(parseGitmodules('[submodule "a"]\n path = a\n url = u\n[submodule "b"]\n\tpath = deps/b\n')).toEqual([
      { name: 'a', path: 'a', url: 'u', branch: null }, { name: 'b', path: 'deps/b', url: null, branch: null },
    ]);
  });

  it('finds the meta-repositories of a workspace, and only them', async () => {
    const root = await workspace();
    const map = await readMetaWorkspace(root);
    expect(map.metaRepos.map((m) => m.name)).toEqual(['livraison-demo']);
    expect(map.knowledge).toEqual([{ path: 'knowledge/onboarding.md', title: 'Arriver dans l’équipe' }]);
  });

  it('tells the team’s repositories from the dependencies, and reads owners, pipelines, docs, KT, glossary and skills', async () => {
    const m = await readMetaRepo(resolve(await workspace(), 'livraison-demo'));
    expect(m.repos.map((r) => [r.name, r.present])).toEqual([['panier-web', true], ['paiement-api', false]]);
    expect(m.dependencies.map((r) => r.name)).toEqual(['catalogue']);
    expect(m.owners.map((o) => o.who)).toEqual(['@demo/equipe-panier', '@carla', 'Alice Martin', 'bob@example.com']);
    expect(m.pipelines.map((p) => [p.name, p.kind])).toEqual([['build', 'github-actions'], ['release', 'jenkins'], ['Scan de sécurité', 'github-actions']]);
    expect(m.docs.map((d) => d.title)).toEqual(['Le composant panier', 'Glossaire']);
    expect(m.kt.map((d) => d.title)).toEqual(['Passation octobre']);
    expect(m.glossary.map((g) => [g.term, g.definition])).toEqual([['MD', 'Une livraison de maintenance'], ['Remise', 'une baisse du prix accordée au client'], ['Panier', 'La liste des articles avant paiement.']]);
    expect(m.skills).toEqual([{ name: 'livrer-md', description: 'Livre une livraison de maintenance de bout en bout.', path: '.github/skills/livrer-md/SKILL.md' }]);
  });

  it('places a folder in the map, and says a dependency is read only', async () => {
    const root = await workspace();
    const here = await metaForDir(resolve(root, 'livraison-demo', 'dependencies', 'catalogue'));
    expect(here).toEqual({ workspace: root, meta: resolve(root, 'livraison-demo'), repo: 'dependencies/catalogue' });
    const line = metaHeadline(await readMetaRepo(here!.meta, { light: true }), here!.repo);
    expect(line).toContain('2 repositories of the team, 1 dependencies');
    expect(line).toContain('catalogue, a dependency of another team: read it, do not change it.');
    expect(line).toContain('livrer-md');
    expect(await metaForDir(resolve(root, 'outils'))).toBeNull();
  });
});
