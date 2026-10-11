export type DesktopUpdate = { state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'; channel: 'stable' | 'preview'; version?: string; percent?: number; reason?: string };
export type DesktopBridge = { version: string; platform: string; chooseFolder: () => Promise<string | null>; updates: { status: () => Promise<DesktopUpdate>; check: () => Promise<DesktopUpdate>; download: () => Promise<DesktopUpdate>; install: () => Promise<DesktopUpdate> } };
declare global { interface Window { okbDesktop?: DesktopBridge } }
