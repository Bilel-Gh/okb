import { readFileSync } from 'node:fs';
import { updateChannelFor } from './dist/desktop/policy.js';
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const { channel, manifest } = updateChannelFor(version);
const signed = process.env.OKB_SIGNED_RELEASE === '1';
const policy = { stable: process.env.OKB_UPDATE_STABLE, preview: process.env.OKB_UPDATE_PREVIEW, publisher: process.env.OKB_SIGNING_PUBLISHER };
if (signed && (!policy.stable || !policy.preview || !policy.publisher)) throw new Error('Signed release requires both update feeds and the signing publisher.');
export default {
  appId: 'org.okb.desktop', productName: 'OKB', copyright: 'Copyright © OKB contributors',
  extraMetadata: { main: 'dist/desktop/main.js' },
  directories: { output: 'desktop-build' },
  files: ['dist/**', 'web/**', 'templates/**', 'plugin/**', 'plugins/**', '.claude-plugin/**', 'docs/guide/**', 'examples/**', 'package.json', 'LICENSE', '!**/*.map', '!**/*.d.ts'],
  extraResources: [{ from: 'desktop/update-policy.json', to: 'update-policy.json' }],
  asar: true, npmRebuild: false,
  detectUpdateChannel: false, generateUpdatesFilesForAllChannels: false,
  forceCodeSigning: signed,
  mac: { icon: 'desktop/icons/OKB.icns', target: ['dmg', 'zip'], category: 'public.app-category.productivity', hardenedRuntime: true, entitlements: 'desktop/entitlements.mac.plist', entitlementsInherit: 'desktop/entitlements.mac.plist', ...(signed ? { identity: policy.publisher, notarize: true } : { identity: null }) },
  win: { icon: 'desktop/icons/OKB.ico', target: ['nsis'], ...(policy.publisher ? { publisherName: policy.publisher } : {}) },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false, createDesktopShortcut: true },
  artifactName: 'OKB-${version}-${os}-${arch}.${ext}',
  publish: policy[channel] ? [{ provider: 'generic', url: policy[channel], channel: manifest }] : null,
};
