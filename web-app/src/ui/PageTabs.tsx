import type { LucideIcon } from 'lucide-react';
import { hrefFor, type Route } from '../app/router';

export type PageTab = { to: Route; label: string; current: boolean; count?: number; icon?: LucideIcon };

/** The pages inside a destination, as tabs: each one has its address, so it can be bookmarked. */
export function PageTabs({ tabs, label }: { tabs: readonly PageTab[]; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <a key={hrefFor(tab.to)} href={hrefFor(tab.to)} aria-current={tab.current ? 'page' : undefined}>
            {Icon ? <Icon size={15} aria-hidden="true" /> : null}{tab.label}{tab.count ? <span className="n">{tab.count}</span> : null}
          </a>
        );
      })}
    </nav>
  );
}
