// Test harness for the Pages Functions in functions/.
//
// Tests never import functions/*.js directly: they run against the REAL Pages
// bundle, built by `wrangler pages functions build` (the same build Cloudflare
// runs on deploy), so routing, the bundled serviceArea import and the
// generated _routes.json are all exercised. Network is never touched: global
// fetch is replaced by a mock that routes by URL and fails loudly on anything
// unexpected, and caches.default is an in-memory stand-in.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// workerd keeps request.cf across new Request()/clone(); Node's undici drops
// it. The Pages router hands handlers `new Request(request.clone())`, so carry
// cf through both, the way production does.
const NativeRequest = globalThis.Request;
class CfRequest extends NativeRequest {
  constructor(input, init) {
    super(input, init);
    const cf = (init && init.cf) || (input && input.cf);
    if (cf) Object.defineProperty(this, 'cf', { value: cf });
  }
  clone() {
    const c = new CfRequest(super.clone());
    if (this.cf) Object.defineProperty(c, 'cf', { value: this.cf });
    return c;
  }
}
globalThis.Request = CfRequest;

let built;
export async function loadWorker() {
  if (built) return built;
  const out = mkdtempSync(join(tmpdir(), 'brg-functions-'));
  execFileSync('wrangler', [
    'pages', 'functions', 'build', 'functions',
    '--outdir', out,
    '--output-routes-path', join(out, '_routes.json')
  ], { cwd: ROOT, stdio: 'pipe' });
  copyFileSync(join(out, 'index.js'), join(out, 'worker.mjs'));
  const mod = await import(pathToFileURL(join(out, 'worker.mjs')).href);
  built = {
    worker: mod.default,
    routes: JSON.parse(readFileSync(join(out, '_routes.json'), 'utf8'))
  };
  return built;
}

// ---- fetch mock -----------------------------------------------------------
// handlers: [{ match: (url, init) => bool, reply: (url, init) => Response }]
export const net = { calls: [], handlers: [] };
export function resetNet(handlers = []) {
  net.calls = [];
  net.handlers = handlers;
}
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  net.calls.push({ url, init });
  const h = net.handlers.find((x) => x.match(url, init));
  if (!h) throw new Error('UNEXPECTED NETWORK CALL in test: ' + (init.method || 'GET') + ' ' + url);
  return h.reply(url, init);
};
export const callsTo = (fragment) => net.calls.filter((c) => c.url.includes(fragment));

// ---- caches.default stand-in ---------------------------------------------
// Honors the same rule the real Cache API does for what we rely on: only a
// response with a positive max-age is stored.
export const cache = { store: new Map(), puts: [] };
export function resetCache() {
  cache.store.clear();
  cache.puts = [];
}
globalThis.caches = {
  default: {
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      const hit = cache.store.get(key);
      return hit ? hit.clone() : undefined;
    },
    async put(req, resp) {
      const key = typeof req === 'string' ? req : req.url;
      const cc = resp.headers.get('Cache-Control') || '';
      cache.puts.push({ key, cacheControl: cc });
      const m = cc.match(/max-age=(\d+)/);
      if (/no-store|private/.test(cc) || !m || Number(m[1]) <= 0) return;
      cache.store.set(key, resp.clone());
    }
  }
};

// ---- invoking the worker --------------------------------------------------
export async function call(path, { method = 'GET', body, rawBody, env = {}, cf } = {}) {
  const { worker } = await loadWorker();
  const init = { method, cf };
  if (rawBody !== undefined) init.body = rawBody;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const req = new Request('https://bluerivergutters.com' + path, init);
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p), passThroughOnException() {} };
  const fullEnv = {
    ASSETS: { fetch: async () => new Response('static asset (no function matched)', { status: 404 }) },
    ...env
  };
  const res = await worker.fetch(req, fullEnv, ctx);
  await Promise.allSettled(pending);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, headers: res.headers, text, json };
}

export const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Silence the functions' own console output unless DEBUG is set, but keep it
// inspectable.
export const logs = [];
if (!process.env.DEBUG) {
  for (const level of ['log', 'warn', 'error']) {
    console[level] = (...args) => logs.push({ level, msg: args.join(' ') });
  }
}
