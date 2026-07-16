import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const text = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));

test('project branding is consistently Readoshi', () => {
  const pkg = JSON.parse(text('package.json'));
  const manifest = JSON.parse(text('public/manifest.json'));
  const html = text('index.html');
  const readme = text('README.md');
  const app = text('src/App.jsx');
  const home = text('src/pages/Home.jsx');
  const css = text('src/index.css');
  const workflow = text('.github/workflows/android-apk.yml');

  assert.equal(pkg.name, 'readoshi');
  assert.equal(manifest.name, 'Readoshi');
  assert.equal(manifest.short_name, 'Readoshi');
  assert.match(manifest.description, /A LANraragi Reader/);
  assert.match(html, /<title>Readoshi<\/title>/);
  assert.match(html, /media="\(prefers-color-scheme: light\)"[^>]+href="\/icons\/favicon-black-32\.png"/);
  assert.match(html, /media="\(prefers-color-scheme: dark\)"[^>]+href="\/icons\/favicon-white-32\.png"/);
  assert.match(readme, /<h1 align="center">Readoshi<\/h1>/);
  assert.match(readme, /<div align="center"><sub><sub>A LANraragi Reader<\/sub><\/sub><\/div>/);
  assert.doesNotMatch(readme, /<h1[^>]*>[^<]*Readoshi[^\n]*A LANraragi Reader/);
  assert.doesNotMatch(readme, /<p align="center"><strong>A LANraragi Reader<\/strong><\/p>/);
  assert.match(readme, /public\/logo-black\.png/);
  assert.match(readme, /public\/logo-white\.png/);
  assert.match(readme, /history:<token>:<server-md5>/);
  assert.match(readme, /watchlist:<token>:<server-md5>/);
  assert.match(readme, /dedupe:<token>:<server-md5>:non-duplicates/);
  assert.match(readme, /schema v3/);
  assert.doesNotMatch(readme, /schema v2|`dedupe:non-duplicates`：/);
  assert.match(workflow, /appId: 'com\.kelcoin\.readoshi'/);
  assert.match(workflow, /appName: 'Readoshi'/);
  assert.match(workflow, /public\/logo-white\.png/);
  assert.match(app, /className="login-brand-lockup"/);
  assert.match(app, /src="\/logo-white\.png"/);
  assert.match(app, /src="\/logo-black\.png"/);
  assert.match(app, /className="login-title">Readoshi<\/h2>/);
  assert.match(app, />LANraragi 地址 \*<\/label>/);
  assert.match(app, />LANraragi API Key \*<\/label>/);
  assert.doesNotMatch(app, />配置 LANraragi<\/h2>|>服务器地址 \*<\/label>|>API Key \*<\/label>/);
  assert.match(css, /:root\[data-theme="light"\] \.login-brand-logo\.is-light/);
  assert.match(home, /className="home-brand-logo is-dark"[^>]+src="\/logo-white\.png"/);
  assert.match(home, /className="home-brand-logo is-light"[^>]+src="\/logo-black\.png"/);
  assert.match(css, /:root\[data-theme="light"\] \.home-brand-logo\.is-light/);
});

test('all logo image assets live under public', () => {
  for (const path of [
    'public/logo-black.png',
    'public/logo-white.png',
    'public/icons/favicon-black-32.png',
    'public/icons/favicon-white-32.png',
    'public/icons/icon-180.png',
    'public/icons/icon-192.png',
    'public/icons/icon-512.png',
  ]) assert.equal(exists(path), true, `${path} missing`);

  assert.equal(exists('logo.png'), false, 'root logo.png must move into public');
  assert.equal(exists('favicon.ico'), false, 'root favicon.ico must move into public');
});
