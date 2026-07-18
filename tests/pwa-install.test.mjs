import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const storage = memoryStorage();

const installState = await import(`../src/lib/pwaInstallState.js?test=${Date.now()}`);

test('PWA install dismissal persists until site data is cleared', () => {
  assert.equal(installState.isInstallDismissed(storage), false);
  installState.dismissInstallPrompt(storage);
  assert.equal(installState.isInstallDismissed(storage), true);
});

test('standalone display detection covers browser and iOS PWA modes', () => {
  assert.equal(installState.isStandaloneDisplay({
    matchMedia: () => ({ matches: true }),
    navigator: {},
  }), true);
  assert.equal(installState.isStandaloneDisplay({
    matchMedia: () => ({ matches: false }),
    navigator: { standalone: true },
  }), true);
  assert.equal(installState.isStandaloneDisplay({
    matchMedia: () => ({ matches: false }),
    navigator: {},
  }), false);
});

test('PwaStatus defers installation until explicit user action', () => {
  const source = fs.readFileSync(new URL('../src/components/PwaStatus.jsx', import.meta.url), 'utf8');
  assert.match(source, /setInstallEvent\(event\)/);
  assert.match(source, /await (?:installEvent|event)\.prompt\(\)/);
  assert.match(source, /dismissInstallPrompt\(\)/);
  assert.match(source, /addEventListener\('appinstalled'/);
  assert.match(source, />安装应用</);
  assert.match(source, /aria-label="关闭安装提示"/);
});

test('PWA update activation always reaches a reload', () => {
  const status = fs.readFileSync(new URL('../src/components/PwaStatus.jsx', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(status, /markPwaUpdateReload\(\)/);
  assert.match(status, /setTimeout\(\(\) => \{[\s\S]*window\.location\.reload\(\)/);
  assert.doesNotMatch(main, /claimPwaReload/);
  assert.match(worker, /event\.waitUntil\(self\.skipWaiting\(\)\)/);
});

test('PWA install dismissal uses a compact close icon', () => {
  const source = fs.readFileSync(new URL('../src/components/PwaStatus.jsx', import.meta.url), 'utf8');
  assert.match(source, /aria-label="关闭安装提示"/);
  assert.match(source, /<ToolbarGlyph name="close"/);
  assert.doesNotMatch(source, />关闭<\/button>/);
});
