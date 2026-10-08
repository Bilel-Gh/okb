/** Light, dark, or the system's choice; remembered on this browser (the classic app's key). */
export type ThemeChoice = 'auto' | 'light' | 'dark';

export function readTheme(): ThemeChoice {
  try { const v = localStorage.getItem('okb-theme'); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; }
}

export function applyTheme(choice: ThemeChoice): 'light' | 'dark' {
  const dark = choice === 'dark' || (choice === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('okb-theme', choice); } catch { /* private window */ }
  return dark ? 'dark' : 'light';
}
