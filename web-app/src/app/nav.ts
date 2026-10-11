import { Archive, BadgeCheck, Blocks, Brain, Briefcase, CalendarCheck, CheckCheck, CircleHelp, FileStack, FolderGit2, FolderKanban, FolderPlus, HardDrive, HeartPulse, Inbox, Layers, Library, MessageCircle, MessageCircleQuestion, Network, Package, Palette, Paperclip, ScrollText, Settings, Share2, Sparkles, Sprout, Stethoscope, Sun, Tags, Target, Terminal, Upload, Wrench, type LucideIcon } from 'lucide-react';
import type { Route } from './router';

/**
 * The five screens of the 2.0 (F2.0-01): today, the projects, the memory, the
 * assistant, progressing. Every page of the 1.5 lives in one of them, in
 * « À valider » (the top bar) or in the « Plus » menu; old addresses still open
 * the right page (router.ts).
 */
export type ScreenId = 'today' | 'projects' | 'memory' | 'assistant' | 'progress';
export type NavEntry = { route: Route; label: string; icon: LucideIcon; module?: 'dev'; hint?: string };

export const SCREENS: readonly (NavEntry & { id: ScreenId })[] = [
  { id: 'today', route: { name: 'today' }, label: 'app.screen.today', icon: Sun },
  { id: 'projects', route: { name: 'projects' }, label: 'app.screen.projects', icon: FolderKanban },
  { id: 'memory', route: { name: 'brain' }, label: 'app.screen.memory', icon: Library },
  { id: 'assistant', route: { name: 'ask' }, label: 'app.screen.assistant', icon: MessageCircle },
  { id: 'progress', route: { name: 'learn' }, label: 'app.screen.progress', icon: Sprout },
];

/** What waits for the person's yes: a button of the top bar, on every screen. */
export const VALIDATE: NavEntry = { route: { name: 'inbox' }, label: 'app.nav.inbox', icon: CheckCheck };

/** Everything that is not daily: the « Plus » menu. */
export const MORE: readonly NavEntry[] = [
  { route: { name: 'tools' }, label: 'app.nav.tools', icon: Wrench, hint: 'app.more.tools' },
  { route: { name: 'upkeep' }, label: 'app.nav.upkeep', icon: HeartPulse, hint: 'app.more.upkeep' },
  { route: { name: 'modules' }, label: 'app.nav.modules', icon: Blocks, hint: 'app.more.modules' },
  { route: { name: 'help' }, label: 'app.nav.help', icon: CircleHelp, hint: 'app.more.help' },
];
export const SETTINGS: NavEntry = { route: { name: 'settings' }, label: 'app.nav.settings', icon: Settings };

/** The screen a page belongs to; null for « À valider » and the pages of the « Plus » menu. */
export function screenOf(route: Route): ScreenId | null {
  switch (route.name) {
    case 'today': case 'day': return 'today';
    case 'projects': case 'repos': return 'projects';
    case 'brain': case 'graph': case 'documents': return 'memory';
    case 'ask': case 'claude': return 'assistant';
    case 'learn': return 'progress';
    default: return null;
  }
}

/** The name of the page in the top bar: its screen's, else its own. */
export function titleKey(route: Route): string {
  const screen = screenOf(route);
  return screen ? SCREENS.find((s) => s.id === screen)!.label : `app.nav.${route.name}`;
}

export type ScreenTab = { to: Route; label: string; current: boolean; icon: LucideIcon };

/** The pages of a screen, as tabs under the top bar; a screen with one page has none. */
export function screenTabs(route: Route, devOn: boolean): ScreenTab[] {
  switch (screenOf(route)) {
    case 'memory':
      return [
        { to: { name: 'brain' }, label: 'app.memory.notes', current: route.name === 'brain', icon: Library },
        { to: { name: 'graph' }, label: 'app.memory.graph', current: route.name === 'graph', icon: Share2 },
        { to: { name: 'documents' }, label: 'app.memory.documents', current: route.name === 'documents', icon: Paperclip },
      ];
    case 'assistant':
      return [
        { to: { name: 'ask' }, label: 'app.assistant.ask', current: route.name === 'ask', icon: MessageCircleQuestion },
        { to: { name: 'claude' }, label: 'app.assistant.terminal', current: route.name === 'claude', icon: Terminal },
      ];
    case 'projects': {
      if (!devOn) return [];
      const arch = route.name === 'repos' && route.tab === 'architecture';
      return [
        { to: { name: 'projects' }, label: 'app.projects.all', current: route.name === 'projects', icon: FolderKanban },
        { to: { name: 'repos' }, label: 'app.projects.repos', current: route.name === 'repos' && !arch, icon: FolderGit2 },
        { to: { name: 'repos', tab: 'architecture' }, label: 'app.projects.arch', current: arch, icon: Network },
      ];
    }
    default:
      return [];
  }
}

/** Every destination, for the ⌘K palette: the screens first. */
export const NAV: readonly NavEntry[] = [
  ...SCREENS,
  VALIDATE,
  { route: { name: 'graph' }, label: 'app.memory.graph', icon: Share2 },
  { route: { name: 'documents' }, label: 'app.memory.documents', icon: Paperclip },
  { route: { name: 'repos' }, label: 'app.projects.repos', icon: FolderGit2, module: 'dev' },
  ...MORE,
  { route: { name: 'claude' }, label: 'app.assistant.terminal', icon: Terminal },
  SETTINGS,
];

/** The pages inside the destinations, for the ⌘K palette. */
export const PLACES: readonly NavEntry[] = [
  { route: { name: 'today', tab: 'focus' }, label: 'app.today.tab.focus', icon: Target },
  { route: { name: 'today', tab: 'focus', done: true }, label: 'app.today.endSession', icon: BadgeCheck },
  { route: { name: 'today', tab: 'week' }, label: 'app.today.tab.week', icon: CalendarCheck },
  { route: { name: 'inbox', tab: 'suggestions' }, label: 'app.inbox.tab.suggestions', icon: Sparkles },
  { route: { name: 'inbox', tab: 'captures' }, label: 'app.inbox.tab.captures', icon: Archive },
  { route: { name: 'inbox', tab: 'captures', compose: true }, label: 'app.inbox.capture', icon: Inbox },
  { route: { name: 'inbox', tab: 'history' }, label: 'app.inbox.tab.history', icon: ScrollText },
  { route: { name: 'repos', tab: 'architecture' }, label: 'app.repos.tab.arch', icon: Network, module: 'dev' },
  { route: { name: 'learn', tab: 'progress' }, label: 'app.learn.tab.progress', icon: Layers },
  { route: { name: 'learn', tab: 'career' }, label: 'app.learn.tab.career', icon: Briefcase },
  { route: { name: 'tools', tab: 'source' }, label: 'app.tools.tab.source', icon: Upload },
  { route: { name: 'tools', tab: 'skills' }, label: 'app.tools.tab.skills', icon: Sparkles },
  { route: { name: 'tools', tab: 'templates' }, label: 'app.tools.tab.templates', icon: FileStack },
  { route: { name: 'tools', tab: 'categories' }, label: 'app.tools.tab.categories', icon: Tags },
  { route: { name: 'tools', tab: 'share' }, label: 'app.tools.tab.share', icon: Package },
  { route: { name: 'upkeep', tab: 'health' }, label: 'app.upkeep.tab.health', icon: HeartPulse },
  { route: { name: 'upkeep', tab: 'doctor' }, label: 'app.upkeep.tab.doctor', icon: Stethoscope },
  { route: { name: 'upkeep', tab: 'usage' }, label: 'app.upkeep.tab.usage', icon: Layers },
  { route: { name: 'upkeep', tab: 'backup' }, label: 'app.upkeep.tab.backup', icon: HardDrive },
  { route: { name: 'settings', tab: 'appearance' }, label: 'app.settings.tab.appearance', icon: Palette },
  { route: { name: 'settings', tab: 'brains' }, label: 'app.settings.tab.brains', icon: Brain },
  { route: { name: 'settings', tab: 'new' }, label: 'app.kb.create', icon: FolderPlus },
];
