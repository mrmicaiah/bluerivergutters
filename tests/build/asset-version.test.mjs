// Cache-busting: every /css/ and /js/ reference in the built site carries
// ?v=<content hash of its source>. Builds a throwaway copy of the repo (the
// real _site and sources are never touched): two builds with no asset change
// give identical versions; one edited CSS line changes that file's version
// and nothing else's; no un-versioned reference anywhere.
// Run: npm run test:build
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brg-assetv-'));
const copy = path.join(tmp, 'repo');
execFileSync('rsync', ['-a', '--exclude', 'node_modules', '--exclude', '_site', '--exclude', '.git', '--exclude', '.studio87', ROOT + '/', copy + '/']);
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(copy, 'node_modules'));

function build(out) {
  execFileSync(path.join(copy, 'node_modules/.bin/eleventy'), ['--quiet', '--output=' + out], { cwd: copy, stdio: ['ignore', 'ignore', 'pipe'] });
  const refs = {}, bare = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.html')) {
        const h = fs.readFileSync(p, 'utf8');
        for (const m of h.matchAll(/(?:href|src)="(\/(?:css|js)\/[^"]+)"/g)) {
          const [file, q] = m[1].split('?');
          if (!/^v=[0-9a-f]{10}$/.test(q || '')) bare.push(path.relative(out, p) + ': ' + m[1]);
          else (refs[file] ||= new Set()).add(q);
        }
      }
    }
  })(out);
  return { refs: Object.fromEntries(Object.entries(refs).map(([k, s]) => [k, [...s]])), bare };
}

test('asset references are content-versioned', () => {
  try {
    const a = build(path.join(tmp, 'a'));
    assert.deepEqual(a.bare, [], 'un-versioned /css/ or /js/ references');
    for (const f of ['/css/main.css', '/js/navigation.js', '/js/lead-form.js', '/js/service-area.js', '/js/live-post.js'])
      assert.ok(a.refs[f], f + ' is referenced with ?v=');
    for (const [f, vs] of Object.entries(a.refs)) assert.equal(vs.length, 1, f + ' has one version across all pages');

    const b = build(path.join(tmp, 'b'));
    assert.deepEqual(b.refs, a.refs, 'a rebuild with no asset change keeps every version');

    fs.appendFileSync(path.join(copy, 'src/css/main.css'), '\n/* cache-bust test */ .x-test { color: red; }\n');
    const c = build(path.join(tmp, 'c'));
    assert.notDeepEqual(c.refs['/css/main.css'], a.refs['/css/main.css'], 'editing main.css changes its version');
    for (const f of Object.keys(a.refs)) if (f !== '/css/main.css') assert.deepEqual(c.refs[f], a.refs[f], f + ' version unchanged');

    fs.appendFileSync(path.join(copy, 'src/_data/serviceArea.js'), '\n// cache-bust test\n');
    const d = build(path.join(tmp, 'd'));
    assert.notDeepEqual(d.refs['/js/service-area.js'], c.refs['/js/service-area.js'], 'editing serviceArea data changes the generated service-area.js version');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
