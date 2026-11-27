// Pure-logic tests: argument parsing, PNG codec, config validation, executable checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCommandArgs } from '../lib/args.mjs';
import { decodePng, encodePng } from '../lib/png.mjs';
import { validateConfig } from '../lib/config.mjs';
import { validateExe, snapName } from '../lib/browsers.mjs';
import { usesProfile } from '../lib/lifecycle.mjs';
import { normalizeUrl } from '../commands/goto.mjs';

const spec = {
  selector: { type: 'string', positional: 0, required: true },
  text: { type: 'string', positional: 1, rest: true },
  props: { type: 'string', list: true },
  nth: { type: 'number' },
  flag: { type: 'boolean' },
  dflt: { type: 'number', default: 5 },
};

test('parseCommandArgs maps positionals, lists, numbers, defaults', () => {
  const a = parseCommandArgs(spec, ['#x', 'hello', 'there', '--props', 'a,b', '--props', 'c', '--nth', '2', '--flag', '--timeout', '500']);
  assert.deepEqual(a, { selector: '#x', text: 'hello there', props: ['a', 'b', 'c'], nth: 2, flag: true, dflt: 5, timeout: 500 });
});

test('parseCommandArgs rejects bad input with BAD_ARGS', () => {
  for (const argv of [[], ['#x', '--nth', 'two'], ['#x', '--bogus']]) {
    assert.throws(() => parseCommandArgs(spec, argv), (e) => e.code === 'BAD_ARGS', argv.join(' '));
  }
  assert.throws(() => parseCommandArgs({ a: { type: 'string', positional: 0 } }, ['1', '2']), /unexpected argument/);
});

test('PNG round-trip', () => {
  const img = { width: 3, height: 2, data: Buffer.from([...Array(24).keys()].map((i) => (i * 37) % 256)) };
  const back = decodePng(encodePng(img));
  assert.deepEqual({ ...back, data: [...back.data] }, { ...img, data: [...img.data] });
  assert.throws(() => decodePng(Buffer.from('nope')), (e) => e.code === 'BAD_ARGS');
});

test('validateConfig', () => {
  const good = { version: 1, browsers: [{ id: 'brave', label: 'Brave', exe: '/usr/bin/brave-browser', snap: null, args: [] }] };
  assert.equal(validateConfig(good), good);
  const bad = [
    null, {}, { version: 2, browsers: good.browsers }, { version: 1, browsers: [] },
    { version: 1, browsers: [{ ...good.browsers[0], exe: 'brave' }] },
    { version: 1, browsers: [{ ...good.browsers[0], id: 'Bad Id' }] },
    { version: 1, browsers: [{ ...good.browsers[0], args: [1] }] },
    { version: 1, browsers: [good.browsers[0], good.browsers[0]] },
  ];
  for (const cfg of bad) assert.throws(() => validateConfig(cfg), (e) => e.code === 'CONFIG_INVALID', JSON.stringify(cfg));
});

test('validateExe rejects missing and non-executable files', () => {
  assert.throws(() => validateExe('definitely-not-a-browser-xyz'), (e) => e.code === 'EXE_NOT_FOUND');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdbg-unit-')), 'notexec');
  fs.writeFileSync(f, '#!/bin/sh\n');
  assert.throws(() => validateExe(f), (e) => e.code === 'EXE_NOT_FOUND');
  fs.rmSync(path.dirname(f), { recursive: true });
});

test('snapName', () => {
  assert.equal(snapName('/snap/bin/chromium'), 'chromium');
  assert.equal(snapName('/bin/sh'), null);
});

test('usesProfile handles argv and space-joined titles, with a boundary', () => {
  assert.ok(usesProfile(['chrome', '--user-data-dir=/p/x', '--a'], '/p/x'));
  assert.ok(usesProfile(['chrome --user-data-dir=/p/x --a'], '/p/x'));
  assert.ok(!usesProfile(['chrome --user-data-dir=/p/x2 --a'], '/p/x'));
});

test('normalizeUrl', () => {
  assert.equal(normalizeUrl('localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeUrl('example.com/a'), 'http://example.com/a');
  assert.equal(normalizeUrl('https://x.dev'), 'https://x.dev');
  assert.equal(normalizeUrl('file:///tmp/a.html'), 'file:///tmp/a.html');
  assert.equal(normalizeUrl('about:blank'), 'about:blank');
});
