import {
  Archive, BadgeCheck, Blocks, Brain, Briefcase, CalendarCheck, CircleHelp, FileStack, FolderGit2, FolderPlus, GraduationCap, HardDrive, HeartPulse, Inbox, Layers,
  MessageCircleQuestion, Palette, ScrollText, Settings, Share2, Sparkles, Stethoscope, Sun, Tags, Target, Terminal, Upload, Wrench, type LucideIcon,
} from 'lucide-react';
import type { Route } from './router';

/**
 * The destinations of the side bar, in two groups: the person's brain, and OKB
 * itself. Every page of the first versions lives in one of them (see router.ts).
 */
export type NavEntry = { route: Route; label: string; icon: LucideIcon; section: 'brain' | 'okb'; module?: 'dev'; count?: 'waiting' };
export const NAV: readonly NavEntry[] = [
  { route: { name: 'today' }, label: 'app.nav.today', icon: Sun, section: 'brain' },
  { route: { name: 'brain' }, label: 'app.nav.brain', icon: Brain, section: 'brain' },
  { route: { name: 'graph' }, label: 'app.nav.graph', icon: Share2, section: 'brain' },
  { route: { name: 'ask' }, label: 'app.nav.ask', icon: MessageCircleQuestion, section: 'brain' },
  { route: { name: 'inbox' }, label: 'app.nav.inbox', icon: Inbox, section: 'brain', count: 'waiting' },
  { route: { name: 'repos' }, label: 'app.nav.repos', icon: FolderGit2, section: 'brain', module: 'dev' },
  { route: { name: 'learn' }, label: 'app.nav.learn', icon: GraduationCap, section: 'brain' },
  { route: { name: 'tools' }, label: 'app.nav.tools', icon: Wrench, section: 'okb' },
  { route: { name: 'upkeep' }, label: 'app.nav.upkeep', icon: HeartPulse, section: 'okb' },
  { route: { name: 'modules' }, label: 'app.nav.modules', icon: Blocks, section: 'okb' },
  { route: { name: 'claude' }, label: 'app.nav.claude', icon: Terminal, section: 'okb' },
  { route: { name: 'settings' }, label: 'app.nav.settings', icon: Settings, section: 'okb' },
  { route: { name: 'help' }, label: 'app.nav.help', icon: CircleHelp, section: 'okb' },
];

/** The pages inside the destinations, for the ⌘K palette. */
export const PLACES: readonly { route: Route; label: string; icon: LucideIcon; module?: 'dev' }[] = [
  { route: { name: 'today', tab: 'focus' }, label: 'app.today.tab.focus', icon: Target },
  { route: { name: 'today', tab: 'focus', done: true }, label: 'app.today.endSession', icon: BadgeCheck },
  { route: { name: 'today', tab: 'week' }, label: 'app.today.tab.week', icon: CalendarCheck },
  { route: { name: 'inbox', tab: 'suggestions' }, label: 'app.inbox.tab.suggestions', icon: Sparkles },
  { route: { name: 'inbox', tab: 'captures' }, label: 'app.inbox.tab.captures', icon: Archive },
  { route: { name: 'inbox', tab: 'captures', compose: true }, label: 'app.inbox.capture', icon: Inbox },
  { route: { name: 'inbox', tab: 'history' }, label: 'app.inbox.tab.history', icon: ScrollText },
  { route: { name: 'repos', tab: 'architecture' }, label: 'app.repos.tab.arch', icon: FolderGit2, module: 'dev' },
  { route: { name: 'learn', tab: 'progress' }, label: 'app.learn.tab.progress', icon: Layers },
  { route: { name: 'learn', tab: 'career' }, label: 'app.learn.tab.career', icon: Briefcase },
  { route: { name: 'tools', tab: 'source' }, label: 'app.tools.tab.source', icon: Upload },
  { route: { name: 'tools', tab: 'skills' }, label: 'app.tools.tab.skills', icon: Sparkles },
  { route: { name: 'tools', tab: 'templates' }, label: 'app.tools.tab.templates', icon: FileStack },
  { route: { name: 'tools', tab: 'categories' }, label: 'app.tools.tab.categories', icon: Tags },
  { route: { name: 'upkeep', tab: 'health' }, label: 'app.upkeep.tab.health', icon: HeartPulse },
  { route: { name: 'upkeep', tab: 'doctor' }, label: 'app.upkeep.tab.doctor', icon: Stethoscope },
  { route: { name: 'upkeep', tab: 'usage' }, label: 'app.upkeep.tab.usage', icon: Layers },
  { route: { name: 'upkeep', tab: 'backup' }, label: 'app.upkeep.tab.backup', icon: HardDrive },
  { route: { name: 'settings', tab: 'appearance' }, label: 'app.settings.tab.appearance', icon: Palette },
  { route: { name: 'settings', tab: 'brains' }, label: 'app.settings.tab.brains', icon: Brain },
  { route: { name: 'settings', tab: 'new' }, label: 'app.kb.create', icon: FolderPlus },
];
