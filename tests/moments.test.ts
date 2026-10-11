import { describe, expect, it } from 'vitest';
import { detectMoments, isClosing, type MomentInput } from '../src/suggest/moments.js';

const LONG = 'Une explication. '.repeat(60);
const spot = (input: Partial<MomentInput>) => detectMoments({ prompt: '', answer: LONG, earlier: [], toolErrors: 0, ...input });
const kinds = (input: Partial<MomentInput>) => spot(input).map((m) => m.kind);

describe('the moments worth a note, spotted without AI (F2.0-09)', () => {
  it('a long explanation the person asked for: the term is the title of a concept card', () => {
    expect(spot({ prompt: "c'est quoi OData ?" })).toEqual([{ kind: 'explained', type: 'concept', signal: 'asked', title: 'OData', hint: "c'est quoi OData ?" }]);
    expect(spot({ prompt: 'explique-moi comment marche le cache des bundles' })[0]).toMatchObject({ kind: 'explained', title: 'Cache des bundles' });
    expect(spot({ prompt: 'what is a WBS element?' })[0]).toMatchObject({ kind: 'explained', title: 'WBS element' });
    // A short answer explained nothing worth a card.
    expect(spot({ prompt: "c'est quoi OData ?", answer: 'Un protocole.' })).toEqual([]);
  });

  it('something the person did not know', () => {
    expect(spot({ prompt: 'ah je savais pas que les index étaient reconstruits' })[0]).toMatchObject({ kind: 'explained', signal: 'unknown', title: null });
  });

  it('the same question asked twice in the session', () => {
    const again = spot({ prompt: "rappelle-moi, c'est quoi OData ?", earlier: ["c'est quoi OData ?", 'ok merci'] });
    expect(again[0]).toMatchObject({ kind: 'repeat', type: 'concept', signal: 'repeat', title: 'OData' });
    // The same question in other words counts too; a different one does not.
    expect(kinds({ prompt: 'comment je relance le serveur de test déjà ?', earlier: ['comment relancer le serveur de test ?'] })).toContain('repeat');
    expect(kinds({ prompt: 'comment je relance le serveur de test ?', earlier: ['comment vider le cache du navigateur ?'] })).not.toContain('repeat');
  });

  it('a bug solved after several tries, not one that worked at once', () => {
    const tries = ['le build plante avec ENOENT sur dist/cli', 'toujours pas, même erreur', 'ça marche pas non plus'];
    const solved = spot({ prompt: 'ah ça marche enfin, merci', answer: 'Parfait.', earlier: tries });
    expect(solved).toEqual([{ kind: 'solved', type: 'known-error', signal: 'solved', title: null, hint: 'le build plante avec ENOENT sur dist/cli' }]);
    expect(kinds({ prompt: 'ça marche, merci', answer: 'Parfait.', earlier: ['lance le build'] })).toEqual([]);
    // Many failed commands and one complaint are several tries too.
    expect(kinds({ prompt: 'it works now', answer: 'Great.', earlier: ['still failing'], toolErrors: 4 })).toEqual(['solved']);
  });

  it('a decision taken', () => {
    expect(spot({ prompt: 'ok on part sur SQLite plutôt que des fichiers JSON', answer: 'Entendu.' })).toEqual([{ kind: 'decision', type: 'decision', signal: 'decision', title: null, hint: 'ok on part sur SQLite plutôt que des fichiers JSON' }]);
    expect(kinds({ prompt: "let's go with the stdio transport", answer: 'OK.' })).toEqual(['decision']);
    expect(kinds({ prompt: 'tu peux relire ce fichier ?', answer: 'Oui.' })).toEqual([]);
  });

  it('a command discovered: the person asked how, the answer gives a command', () => {
    const answer = `${LONG}\n\n\`\`\`bash\ngit worktree add ../okb-v2 -b v2-socle\n\`\`\`\n`;
    expect(spot({ prompt: 'comment je crée un deuxième dossier de travail git ?', answer })).toEqual([{ kind: 'command', type: 'recipe', signal: 'asked', title: null, hint: 'git worktree add ../okb-v2 -b v2-socle' }]);
    // Code that is not a command to run is not a recipe.
    expect(kinds({ prompt: 'comment je crée un type ?', answer: `${LONG}\n\`\`\`ts\ntype A = string;\n\`\`\`` })).toEqual([]);
  });

  it('an error and its cause', () => {
    const prompt = "j'ai cette erreur :\nError: SQLITE_BUSY: database is locked\n    at openDb (db.ts:41)";
    const answer = `${LONG} La cause : deux processus ouvrent la base sans délai d’attente.`;
    expect(spot({ prompt, answer })).toEqual([{ kind: 'error', type: 'known-error', signal: 'solved', title: null, hint: 'Error: SQLITE_BUSY: database is locked' }]);
    // An error with no explained cause is not yet worth a card.
    expect(kinds({ prompt, answer: 'Je regarde.' })).toEqual([]);
  });

  it('an ordinary exchange is no moment, and one answer gives one moment per kind at most', () => {
    expect(spot({ prompt: 'ajoute un test pour la recherche' })).toEqual([]);
    const both = spot({ prompt: "c'est quoi un index inversé ? et c'est quoi un trigramme ?" });
    expect(both.filter((m) => m.kind === 'explained')).toHaveLength(1);
  });

  it('knows when the person closes the session', () => {
    for (const p of ['merci, à demain', 'ok fin de session', "c'est bon pour aujourd'hui", 'bonne soirée !', "that's all for today, thanks", 'on s’arrête là']) expect(isClosing(p), p).toBe(true);
    for (const p of ['merci, et maintenant le test suivant', 'continue', "c'est bon, passe à la suite", 'merci']) expect(isClosing(p), p).toBe(false);
  });
});
