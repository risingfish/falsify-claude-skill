// One headless session runs every command against tests/fixtures/page.html served over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { testBrowsers, makeEnv, cli, stateOf, serveFixtures } from './helpers.mjs';

const browser = testBrowsers()[0];
let ctx, srv, page;

const ok = async (...args) => {
  const r = await cli(ctx, ...args);
  assert.equal(r.ok, true, `${args.join(' ')} -> ${JSON.stringify(r.error)}`);
  return r.result;
};
const fails = async (code, ...args) => {
  const r = await cli(ctx, ...args);
  assert.equal(r.ok, false, `${args.join(' ')} should fail`);
  assert.equal(r.error.code, code, `${args.join(' ')} -> ${JSON.stringify(r.error)}`);
  assert.notEqual(r.exitCode, 0);
  return r.error;
};

before(async () => {
  assert.ok(browser, 'no Chromium-based browser installed');
  ctx = makeEnv([{ id: browser.id, label: browser.label, exe: browser.exe, snap: browser.snap, args: browser.args }], 'commands');
  srv = await serveFixtures();
  page = `${srv.url}/page.html`;
  await ok('launch');
});

after(async () => {
  const st = stateOf(ctx);
  await cli(ctx, 'stop');
  srv?.server.close();
  fs.rmSync(ctx.root, { recursive: true, force: true });
  if (st?.profileDir) fs.rmSync(st.profileDir, { recursive: true, force: true });
});

test('launch twice reports the running session', async () => {
  const r = await ok('launch');
  assert.equal(r.alreadyRunning, true);
});

test('goto, reload, wait', async () => {
  const r = await ok('goto', page);
  assert.equal(r.status, 200);
  assert.equal(r.title, 'Fixture');
  assert.equal((await ok('reload')).title, 'Fixture');
  await ok('wait', '#nav');
  await ok('wait', '--network-idle');
  assert.ok((await ok('wait', '--ms', '30')).waitedMs >= 30);
  await fails('BAD_ARGS', 'wait');
  await fails('BAD_ARGS', 'goto', page, '--wait', 'never');
});

test('inspect, html, css', async () => {
  const r = await ok('inspect', '#nav', '--props', 'cursor');
  assert.equal(r.tag, 'nav');
  assert.equal(r.styles.display, 'flex');
  assert.equal(r.styles.gap, '8px');
  assert.ok('cursor' in r.styles);
  assert.equal(r.text, 'One Two Three');
  await fails('AMBIGUOUS_MATCH', 'inspect', '.item');
  assert.equal((await ok('inspect', '.item', '--nth', '2')).text, 'Three');
  await fails('BAD_ARGS', 'inspect', '.item', '--nth', '9');
  await fails('NO_MATCH', 'inspect', '#missing');
  await fails('BAD_ARGS', 'inspect');
  const h = await ok('html', '#nav', '--max', '20');
  assert.equal(h.truncated, true);
  assert.equal(h.html, '<nav id="nav"><span ');
  assert.match((await ok('html', '#nav', '--inner')).html, /^<span class="item">One/);
  assert.deepEqual((await ok('css', '#nav', '--props', 'display,gap')).styles, { display: 'flex', gap: '8px' });
  assert.ok(Object.keys((await ok('css', '#nav', '--all')).styles).length > 100);
  await fails('BAD_ARGS', 'css', '#nav');
});

test('at and overflow', async () => {
  const at = await ok('at', '10', '220');
  assert.equal(at.stack[0].selector, 'div#overlay');
  const o = await ok('overflow');
  assert.equal(o.hasHorizontalScroll, true);
  assert.deepEqual(o.elements.map((e) => e.selector), ['div#wide'], 'clipped .inner is not reported');
});

test('eval: expression, statements, await', async () => {
  assert.equal((await ok('eval', 'document.title')).value, 'Fixture');
  assert.equal((await ok('eval', 'const x = 2; return x * 21')).value, 42);
  assert.equal((await ok('eval', 'await new Promise(r => setTimeout(r, 5)); return 7')).value, 7);
  assert.equal((await ok('eval', 'undefined')).value, null);
});

test('screenshot modes and diff', async () => {
  await ok('emulate', '--reset');
  await ok('scroll', '--to', '0,0');
  const v1 = await ok('screenshot', '--name', 'v1');
  assert.ok(fs.existsSync(v1.path));
  assert.equal(v1.mode, 'viewport');
  const full = await ok('screenshot', '--full', '--name', 'full');
  assert.ok(full.height > 3000);
  const el = await ok('screenshot', '--selector', '#nav', '--name', 'nav');
  assert.equal(el.height, 46);
  await ok('scroll', '--to', '0,0');
  await ok('screenshot', '--name', 'v2');
  const same = await ok('diff', 'v1', 'v2');
  assert.equal(same.changedPixels, 0, 'full/element shots must not leave state behind');
  await ok('css-inject', '#nav { background: rgb(200, 0, 0) !important; }', '--id', 'red');
  await ok('screenshot', '--name', 'v3');
  const d = await ok('diff', 'v1', 'v3');
  assert.ok(d.changedPixels > 0);
  assert.equal(d.bbox.y, 0);
  assert.equal(d.bbox.height, 46);
  assert.ok(fs.existsSync(d.diffPath));
  await fails('BAD_ARGS', 'diff', 'v1', 'nope');
  await fails('BAD_ARGS', 'diff', 'v1', 'nav');
  await fails('BAD_ARGS', 'screenshot', '--full', '--selector', '#nav');
});

test('css-inject replaces by id, css-remove restores', async () => {
  const bg = async () => (await ok('css', '#nav', '--props', 'background-color')).styles['background-color'];
  const original = 'rgb(30, 60, 90)';
  await ok('css-remove');
  assert.equal(await bg(), original);
  await ok('css-inject', '#nav { background: rgb(1, 2, 3) !important; }', '--id', 'a');
  assert.equal(await bg(), 'rgb(1, 2, 3)');
  assert.equal((await ok('css-inject', '#nav { background: rgb(4, 5, 6) !important; }', '--id', 'a')).replaced, true);
  assert.equal(await bg(), 'rgb(4, 5, 6)');
  await fails('NO_MATCH', 'css-remove', '--id', 'zzz');
  assert.deepEqual((await ok('css-remove', '--id', 'a')).active, []);
  assert.equal(await bg(), original);
});

test('device, viewport, media, emulate --reset', async () => {
  const d = await ok('device', 'Pixel 7', '--reload');
  assert.equal(d.emulation.device, 'Pixel 7');
  let v = (await ok('eval', '({ dpr: devicePixelRatio, touch: navigator.maxTouchPoints, ua: navigator.userAgent, dir: getComputedStyle(document.getElementById("nav")).flexDirection })')).value;
  assert.ok(v.dpr > 2);
  assert.ok(v.touch > 0);
  assert.match(v.ua, /Pixel 7/);
  assert.equal(v.dir, 'column', 'mobile media query applies');
  assert.ok((await ok('device', '--list', 'iphone')).devices.length > 5);
  await fails('NO_MATCH', 'device', 'Nokia 3310');
  await ok('media', '--color-scheme', 'dark', '--reduced-motion');
  assert.equal((await ok('eval', 'matchMedia("(prefers-color-scheme: dark)").matches && matchMedia("(prefers-reduced-motion: reduce)").matches')).value, true);
  await ok('media', '--no-reduced-motion');
  assert.equal((await ok('eval', 'matchMedia("(prefers-reduced-motion: reduce)").matches')).value, false);
  await fails('BAD_ARGS', 'media', '--color-scheme', 'purple');
  assert.deepEqual((await ok('emulate', '--reset')).emulation, {});
  v = (await ok('eval', '({ dpr: devicePixelRatio, touch: navigator.maxTouchPoints, dark: matchMedia("(prefers-color-scheme: dark)").matches })')).value;
  assert.deepEqual(v, { dpr: 1, touch: 0, dark: false });
  await ok('viewport', '400x300', '--dpr', '2');
  assert.deepEqual((await ok('eval', '({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })')).value, { w: 400, h: 300, dpr: 2 });
  await fails('BAD_ARGS', 'viewport', 'big');
  await ok('emulate', '--reset');
});

test('click, type, hover, scroll', async () => {
  await ok('goto', page);
  await ok('click', '#btn');
  assert.equal((await ok('eval', 'document.getElementById("btn").textContent')).value, 'clicked');
  await ok('type', '#name', 'hello', 'world');
  assert.equal((await ok('eval', 'document.getElementById("name").value')).value, 'hello world');
  await ok('hover', '#btn');
  assert.equal((await ok('scroll', '--to', '0,400')).scrollY, 400);
  assert.equal((await ok('scroll', '--by', '0,-100')).scrollY, 300);
  await ok('scroll', '#nav');
  await fails('BAD_ARGS', 'scroll', '--to', 'x');
});

test('console captures logs and page errors', async () => {
  await ok('console', '--clear');
  await ok('reload');
  await ok('wait', '--ms', '200');
  const all = await ok('console');
  assert.ok(all.entries.some((e) => e.type === 'warning' && e.text === 'fixture loaded'));
  const errs = await ok('console', '--errors');
  assert.ok(errs.entries.every((e) => e.type === 'error' || e.type === 'pageerror'));
  assert.ok(errs.entries.some((e) => e.text.includes('boom from fixture')));
  assert.equal((await ok('console', '--since', all.now)).total, 0);
  await fails('BAD_ARGS', 'console', '--since', 'yesterday');
});

test('tabs, newtab, tab, --tab', async () => {
  const first = (await ok('tabs')).tabs.find((t) => t.current);
  const nt = await ok('newtab', `${srv.url}/page.html?second`);
  assert.match(nt.id, /^[0-9A-F]{8}$/);
  const list = (await ok('tabs')).tabs;
  assert.equal(list.length, 2);
  assert.equal(list.find((t) => t.current).id, nt.id);
  assert.match((await ok('eval', 'location.search', '--tab', first.id)).value, /^$/);
  assert.equal((await ok('tab', first.id.slice(0, 4))).id, first.id);
  await fails('NO_PAGE', 'tab', 'ZZZZ');
});

test('unknown command and help', async () => {
  await fails('UNKNOWN_COMMAND', 'frobnicate');
  const h = await cli(ctx, 'help');
  assert.match(h.text, /screenshot/);
  assert.match((await cli(ctx, 'help', 'inspect')).text, /--nth/);
  assert.match((await cli(ctx, 'inspect', '--help')).text, /inspect <selector>/);
});
