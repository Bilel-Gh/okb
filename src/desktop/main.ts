import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';
import type { OkbConfig } from '../config/schema.js';
import { loadConfig } from '../config/load.js';
import { closeDbs } from '../state/db.js';
import { shutdownAssistant } from '../assistant/assistant.js';
import { serve } from '../web/server.js';
import { allowedNavigation, parseUpdatePolicy, portableAgentPath, updateChannelFor, updateIdentityMatches, type UpdatePolicy } from './policy.js';

// The same loopback server and engine as `okb serve`, with a random free port. No second backend.
let stopWeb: () => Promise<void> = async () => {};
let mainWindow: BrowserWindow | null = null;
let origin = '';
let quitting = false;
type UpdateState = { state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'; version?: string; percent?: number; reason?: string; channel: 'stable' | 'preview' };
let updates: UpdateState = { state: 'disabled', channel: 'preview', reason: 'Distribution feed and signing identity are not configured.' };
let policy: UpdatePolicy = { enabled: false };
let updater: import('electron-updater').AppUpdater | null = null;
let stopping: Promise<void> | null = null;
function stopServices(): Promise<void> {
  return stopping ??= (async () => {
    // Start draining HTTP writes and cancelling agents together: an assistant request may itself be in flight.
    await Promise.all([stopWeb(), shutdownAssistant()]);
    closeDbs();
  })();
}

function trusted(frameUrl: string | undefined): boolean { return Boolean(frameUrl && allowedNavigation(frameUrl, origin)); }
async function configureUpdates() {
  const file = app.isPackaged ? resolve(process.resourcesPath, 'update-policy.json') : resolve(app.getAppPath(), 'desktop', 'update-policy.json');
  policy = parseUpdatePolicy(JSON.parse(await readFile(file, 'utf8').catch(() => '{}')) as unknown);
  const { channel, manifest } = updateChannelFor(app.getVersion());
  updates.channel = channel;
  if (!app.isPackaged || !policy.enabled) return;
  let signedIdentity = false;
  try {
    if (process.platform === 'win32') {
      const metadata = parseYaml(await readFile(resolve(process.resourcesPath, 'app-update.yml'), 'utf8')) as { publisherName?: unknown };
      const exec = promisify(execFile);
      // Fixed script, literal path from an environment value: neither a shell expansion nor a filename as code.
      const script = "$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath $env:OKB_SIGNED_BINARY; $p=if($s.SignerCertificate){$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)}else{''}; @{status=$s.Status.ToString();publisher=$p}|ConvertTo-Json -Compress";
      const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, OKB_SIGNED_BINARY: process.execPath }, timeout: 10000, windowsHide: true });
      const signature = JSON.parse(result.stdout) as { status?: string; publisher?: string };
      signedIdentity = updateIdentityMatches('win32', policy.publisher, { publisherNames: metadata.publisherName, signatureStatus: signature.status, certificatePublisher: signature.publisher });
    } else if (process.platform === 'darwin') {
      const exec = promisify(execFile);
      const bundle = resolve(process.execPath, '..', '..', '..');
      await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { timeout: 10000 });
      const details = await exec('/usr/bin/codesign', ['-dv', '--verbose=4', bundle], { timeout: 10000 });
      const authority = /^Authority=(.+)$/m.exec(details.stderr)?.[1];
      signedIdentity = updateIdentityMatches('darwin', policy.publisher, { authority });
    }
  } catch { /* An unsigned or unverified prototype keeps updates off. */ }
  if (!signedIdentity) { updates.reason = 'The installed signing identity has not been verified.'; return; }
  const loaded = createRequire(import.meta.url)('electron-updater') as typeof import('electron-updater');
  updater = loaded.autoUpdater;
  updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.allowDowngrade = false; updater.allowPrerelease = channel === 'preview';
  // Identity and feed are compiled into the distributable; a web page cannot redirect updates.
  updater.setFeedURL({ provider: 'generic', url: policy[channel], channel: manifest });
  updates = { state: 'idle', channel };
  updater.on('checking-for-update', () => { updates = { state: 'checking', channel }; });
  updater.on('update-available', (info) => { updates = { state: 'available', version: info.version, channel }; });
  updater.on('update-not-available', () => { updates = { state: 'idle', channel }; });
  updater.on('download-progress', (info) => { updates = { ...updates, state: 'downloading', percent: Math.round(info.percent) }; });
  updater.on('update-downloaded', (info) => { updates = { state: 'downloaded', version: info.version, channel }; });
  updater.on('error', () => { updates = { state: 'error', channel, reason: 'The update could not be checked or verified.' }; });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({ width: 1280, height: 860, minWidth: 360, minHeight: 560, title: 'OKB', backgroundColor: '#f6f5f2', show: false, webPreferences: { preload: resolve(dirname(fileURLToPath(import.meta.url)), 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => { if (!allowedNavigation(target, origin)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  void win.loadURL(origin);
  return win;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.on('activate', () => { if (!mainWindow && origin) mainWindow = createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true; event.preventDefault();
    void stopServices().finally(() => app.quit());
  });
  void app.whenReady().then(async () => {
    process.env.PATH = portableAgentPath(process.env.PATH, homedir());
    process.env.OKB_DESKTOP = '1';
    let config: OkbConfig | null = null;
    try { config = (await loadConfig()).config; } catch (error) {
      // A genuinely fresh installation gets onboarding; broken existing settings are reported rather than replaced.
      const { listKbs } = await import('../kb/registry.js');
      if ((await listKbs()).length) throw error;
    }
    const serving = await serve(config, { port: 0, env: process.env }); stopWeb = serving.shutdown; origin = serving.url;
    ipcMain.handle('okb:choose-folder', async (event) => {
      if (!trusted(event.senderFrame?.url) || event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Untrusted page');
      const result = await dialog.showOpenDialog(mainWindow!, { title: 'OKB', properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    });
    ipcMain.handle('okb:update', async (event, action: unknown) => {
      if (!trusted(event.senderFrame?.url) || event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Untrusted page');
      if (action === 'status') return updates;
      if (!updater) return updates;
      if (action === 'check') await updater.checkForUpdates();
      else if (action === 'download' && updates.state === 'available') await updater.downloadUpdate();
      else if (action === 'install' && updates.state === 'downloaded') {
        // The person chose restart; stop the local server and flush SQLite before replacing the application.
        quitting = true; await stopServices(); updater.quitAndInstall();
      } else throw new Error('Update action not available');
      return updates;
    });
    await configureUpdates();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' }, { label: 'Affichage', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: 'OKB', submenu: [{ label: 'Diagnostic et sauvegarde', click: () => { void mainWindow?.loadURL(`${origin}/#/upkeep/doctor`); } }, { label: 'Guide Claude Code', click: () => { void shell.openExternal('https://code.claude.com/docs/en/setup'); } }] },
      { role: 'windowMenu' },
    ]));
    mainWindow = createWindow();
  }).catch((error: unknown) => { dialog.showErrorBox('OKB', `Le démarrage a échoué. Les notes n’ont pas été remplacées.\n${error instanceof Error ? error.message : 'Unknown error'}`); app.quit(); });
}
