// POST /api/lead — existing behaviour plus the #188 name/text spam rules.
// Run: npm run test:functions
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { call, resetNet, net, callsTo, jsonResponse, ROOT, logs } from './harness.mjs';

const ENV = { RESEND_API_KEY: 're_test', LEAD_FROM: 'leads@example.test', LEAD_TO: 'owner@example.test, crew@example.test' };
const RESEND = 'api.resend.com/emails';
const COURIER = 'email-bot-server.micaiah-tasks.workers.dev/api/subscribe';

function lead(over = {}) {
  return {
    name: 'Jane Carter', phone: '(256) 555-0100', zip: '35758', city: '', email: 'jane@example.test',
    message: 'Gutters overflowing at the back corner of the house.', service: 'gutter-cleaning',
    source: 'bluerivergutters.com', funnel: 'service-page-form', time_to_fill_ms: 24000, ...over
  };
}

// The Nov 14 submission, replayed as it arrived: the sales pitch typed into
// the name box, a web-studio email, a 305 number, a real Huntsville zip, no
// service, no message, filled in 6.3s.
const NOV14 = {
  name: "Your reviews say you're the one to call in Huntsville, but your website looks like it hasn't been touched since 2015 — can I send you a free redesign mockup?",
  phone: '(305) 555-0142',
  zip: '35801',
  city: '',
  email: 'hello@brightline-webstudio.com',
  message: '',
  service: '',
  source: 'bluerivergutters.com',
  funnel: 'homepage-form',
  time_to_fill_ms: 6332
};

beforeEach(() => {
  resetNet([
    { match: (u) => u.includes(RESEND), reply: () => jsonResponse({ id: 'email_1' }) },
    { match: (u) => u.includes(COURIER), reply: () => jsonResponse({ ok: true }) }
  ]);
  logs.length = 0;
});

const post = (body, opts = {}) => call('/api/lead', { method: 'POST', env: ENV, body, ...opts });
const sentMail = () => {
  const c = callsTo(RESEND);
  assert.equal(c.length, 1, 'expected exactly one Resend call, got ' + c.length);
  return JSON.parse(c[0].init.body);
};
async function assertSilentReject(body, label) {
  const r = await post(body);
  assert.equal(r.status, 200, label);
  assert.deepEqual(r.json, { ok: true }, label + ': must look like success');
  assert.equal(callsTo(RESEND).length, 0, label + ': reached Resend');
  assert.equal(callsTo(COURIER).length, 0, label + ': reached Courier');
}

// ---- #188: the bug ------------------------------------------------------

test('Nov 14 replay: the name-box sales pitch is refused (fake success, no Resend call)', async () => {
  assert.ok(NOV14.name.length > 100);
  await assertSilentReject(NOV14, 'Nov 14 pitch');
});

// ---- existing behaviour (regression) -------------------------------------

test('real lead: emailed via Resend with reply_to, forwarded to Courier, 200 ok', async () => {
  const r = await post(lead());
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  const m = sentMail();
  assert.equal(m.from, ENV.LEAD_FROM);
  assert.deepEqual(m.to, ['owner@example.test', 'crew@example.test']);
  assert.equal(m.reply_to, 'jane@example.test');
  assert.equal(m.subject, 'New lead: Jane Carter — gutter-cleaning (35758/Madison)');
  assert.match(m.text, /Name: +Jane Carter/);
  assert.match(m.text, /City: +Madison/);
  assert.match(m.text, /Submitted from: unknown, unknown, unknown/);
  assert.ok(!/Notes:/.test(m.text));
  assert.equal(callsTo(RESEND)[0].init.headers.Authorization, 'Bearer re_test');
  const courier = JSON.parse(callsTo(COURIER)[0].init.body);
  assert.equal(courier.email, 'jane@example.test');
  assert.equal(courier.list, 'blue-river-gutters-leads');
  assert.equal(courier.metadata.zip, '35758');
});

test('no email: lead sent, no reply_to, no Courier forward', async () => {
  const r = await post(lead({ email: '' }));
  assert.equal(r.status, 200);
  assert.equal(sentMail().reply_to, undefined);
  assert.equal(callsTo(COURIER).length, 0);
});

test('Huntsville prefix zip auto-fills the city; unknown funnel and extra fields noted', async () => {
  await post({ ...lead({ zip: '35806', funnel: 'mystery-form' }), utm: 'x' });
  const m = sentMail();
  assert.match(m.subject, /\(35806\/Huntsville\)$/);
  assert.match(m.text, /Unrecognized funnel "mystery-form"/);
  assert.match(m.text, /Unexpected fields ignored: utm/);
});

test('existing silent rejects still silent', async () => {
  await assertSilentReject(lead({ time_to_fill_ms: 2999 }), 'too fast');
  await assertSilentReject(lead({ time_to_fill_ms: 'abc' }), 'non-numeric fill time');
  await assertSilentReject(lead({ zip: '90210' }), 'out of area');
  await assertSilentReject(lead({ name: '' }), 'no name');
  await assertSilentReject(lead({ phone: '' }), 'no phone');
  await assertSilentReject(lead({ zip: '' }), 'no zip');
  await assertSilentReject({ ...lead(), metadata: {} }, 'legacy shape');
  await assertSilentReject([lead()], 'array body');
  const r = await call('/api/lead', { method: 'POST', env: ENV, rawBody: 'name=x' });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(net.calls.length, 0);
});

test('missing env -> loud 500 naming the missing vars', async () => {
  const r = await post(lead(), { env: { LEAD_FROM: 'x' } });
  assert.equal(r.status, 500);
  assert.match(r.json.detail, /RESEND_API_KEY, LEAD_TO/);
  assert.match(r.json.error, /256\) 616-6760/);
  assert.equal(net.calls.length, 0);
});

test('Resend failure -> 502 asking them to call, never a fake success', async () => {
  resetNet([{ match: (u) => u.includes(RESEND), reply: () => new Response('boom', { status: 500 }) }]);
  const r = await post(lead());
  assert.equal(r.status, 502);
  assert.match(r.json.error, /call us/);
  resetNet([{ match: (u) => u.includes(RESEND), reply: () => { throw new Error('offline'); } }]);
  assert.equal((await post(lead())).status, 502);
});

test('foreign geo: subject tagged up front, geo line in body; US untagged', async () => {
  await post(lead(), { cf: { country: 'GB', region: 'England', city: 'London' } });
  let m = sentMail();
  assert.ok(m.subject.startsWith('[submitted from GB] New lead: Jane Carter'), m.subject);
  assert.match(m.text, /Submitted from: London, England, GB/);
  resetNet([{ match: (u) => u.includes(RESEND), reply: () => jsonResponse({}) }, { match: (u) => u.includes(COURIER), reply: () => jsonResponse({}) }]);
  await post(lead(), { cf: { country: 'US', region: 'Alabama', city: 'Madison' } });
  m = sentMail();
  assert.ok(m.subject.startsWith('New lead:'), m.subject);
});

// ---- #188: blatant -> silent ---------------------------------------------

test('blatant name: over 60 chars, URL/domain, or @ -> silent reject', async () => {
  await assertSilentReject(lead({ name: 'A'.repeat(61) }), '61-char name');
  for (const name of [
    'http://cheap-seo.example', 'Visit https://x.test', 'www.growfast', 'Mike from growthlabs.com',
    'Ana at pixel.net', 'Team Acme.org', 'buildfast.io', 'Sam - leads.co', 'ana@studio', 'Bob @ Acme', 'Northline Web.Studio', 'growth.digital'
  ]) {
    await assertSilentReject(lead({ name }), 'name "' + name + '"');
  }
  const r = await post(lead({ name: 'B'.repeat(60) }));
  assert.equal(callsTo(RESEND).length, 1, 'a 60-char name is not blatant');
  assert.equal(r.status, 200);
});

test('outreach wordlist in ANY text field -> silent reject', async () => {
  await assertSilentReject(lead({ name: 'Digital Marketing Pro' }), 'wordlist in name');
  await assertSilentReject(lead({ message: 'We do SEO for contractors, can we talk?' }), 'whole-word seo in message');
  await assertSilentReject(lead({ message: 'Our backlink packages start at $99' }), 'phrase in message');
  await assertSilentReject(lead({ service: 'lead generation' }), 'wordlist in service');
  await assertSilentReject(lead({ city: 'Virtual Assistant Hub' }), 'wordlist in city');
});

test('wordlist does not fire on ordinary words that merely contain "seo"', async () => {
  await post(lead({ name: 'Seong Park', message: 'Need a quote; Seoul-born owner, house in Madison, gutters sag.' }));
  assert.equal(callsTo(RESEND).length, 1);
});

// ---- #188: borderline -> delivered, flagged --------------------------------

test('borderline name (5+ words, or 3+ digits) -> delivered with [suspect] first in subject', async () => {
  await post(lead({ name: 'John Paul Jacob Smith Jones' }));
  let m = sentMail();
  assert.ok(m.subject.startsWith('[suspect] New lead: John Paul Jacob Smith Jones'), m.subject);
  assert.match(m.text, /Suspect: name has 5\+ words/);

  for (const name of ['Jane 555', 'J4ne C4rt3r']) {
    resetNet([{ match: (u) => u.includes(RESEND), reply: () => jsonResponse({}) }, { match: (u) => u.includes(COURIER), reply: () => jsonResponse({}) }]);
    await post(lead({ name }));
    m = sentMail();
    assert.ok(m.subject.startsWith('[suspect] New lead: ' + name), m.subject);
    assert.match(m.text, /Suspect: name has 3\+ digits/);
  }

  resetNet([{ match: (u) => u.includes(RESEND), reply: () => jsonResponse({}) }, { match: (u) => u.includes(COURIER), reply: () => jsonResponse({}) }]);
  await post(lead({ name: 'Jane 555' }), { cf: { country: 'IN', region: 'x', city: 'y' } });
  m = sentMail();
  assert.ok(m.subject.startsWith('[suspect] [submitted from IN] New lead: Jane 555'), m.subject);
});

// ---- #188: normal names untouched ----------------------------------------

test('normal names pass clean: "Mary Beth Smith-Jones Jr." and a plain 2-word name', async () => {
  for (const name of ['Mary Beth Smith-Jones Jr.', 'Jane Carter']) {
    resetNet([{ match: (u) => u.includes(RESEND), reply: () => jsonResponse({}) }, { match: (u) => u.includes(COURIER), reply: () => jsonResponse({}) }]);
    const r = await post(lead({ name }));
    assert.equal(r.status, 200);
    const m = sentMail();
    assert.equal(m.subject, 'New lead: ' + name + ' — gutter-cleaning (35758/Madison)');
    assert.ok(!/Suspect/.test(m.text), name + ' flagged');
  }
});

// ---- drift check: server wordlist == the client's -----------------------

test('outreach wordlist is the one the client ships (no drift)', () => {
  const require = createRequire(import.meta.url);
  const shared = require(join(ROOT, 'src/_data/leadSpam.js'));
  const client = readFileSync(join(ROOT, 'src/js/lead-form.js'), 'utf8');
  const arrayIn = (name) => {
    const m = client.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
    assert.ok(m, name + ' not found in src/js/lead-form.js');
    return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
  };
  assert.deepEqual(shared.outreachPhrases, arrayIn('OUTREACH_PHRASES'), 'OUTREACH_PHRASES drifted: update src/_data/leadSpam.js and the client together');
  assert.deepEqual(shared.outreachWords, arrayIn('OUTREACH_WORDS'), 'OUTREACH_WORDS drifted');
  const link = client.match(/var NAME_LINK = \/.*?\\\.\(([a-z|]+)\)\\b\/i;/);
  assert.ok(link, 'NAME_LINK TLD group not found in src/js/lead-form.js');
  assert.deepEqual(shared.nameTlds, link[1].split('|'), 'name-link TLDs drifted: update src/_data/leadSpam.js and NAME_LINK together');
});
