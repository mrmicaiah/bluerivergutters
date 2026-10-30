// POST /api/lead — every lead form on the site posts here (src/js/lead-form.js,
// src/contact.njk). Payload is flat, every key present, blanks as "":
//   { name, phone, zip, city, email, message, service, source, funnel, time_to_fill_ms }
//
// Accepted leads are emailed through Resend (RESEND_API_KEY, LEAD_FROM,
// LEAD_TO). Leads with an email are also forwarded to Courier in the legacy
// subscribe shape so the subscriber list keeps growing; a Courier failure is
// logged and never fails the lead.
//
// Spam rejections (too fast, out of area, old/replayed payload shape, not
// JSON) get the same 200 as a real lead, so a bot learns nothing. Format
// errors are blocked client-side and never reach here. A lead is never
// dropped silently: if it can't be sent, the visitor gets a 500 asking them
// to call.
import serviceArea from '../../src/_data/serviceArea.js';

const COURIER_API = 'https://email-bot-server.micaiah-tasks.workers.dev/api/subscribe';
const COURIER_LIST = 'blue-river-gutters-leads';
const FIELDS = ['name', 'phone', 'zip', 'city', 'email', 'message', 'service', 'source', 'funnel', 'time_to_fill_ms'];
// Keys only the pre-/api/lead Courier-era forms sent: a payload carrying them
// is a replay of an old capture, not one of our current forms.
const LEGACY_KEYS = ['metadata', 'list', 'website'];
const KNOWN_FUNNELS = ['contact-form-v3', 'service-page-form', 'city-page-form'];
const MIN_FILL_MS = 3000;
const CALL_US = 'Something went wrong sending your request. Please call us at (256) 616-6760.';

// Same rule as cityForZip in src/js/lead-form.js.
function cityForZip(zip) {
  if (!/^[0-9]{5}$/.test(zip)) return '';
  if (serviceArea.zips[zip]) return serviceArea.zips[zip];
  for (const prefix in serviceArea.prefixes) {
    if (zip.startsWith(prefix)) return serviceArea.prefixes[prefix];
  }
  return '';
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// What a real lead gets, and what every silent reject gets too.
function accepted() {
  return json({ ok: true });
}

function reject(reason) {
  console.log('lead rejected (silent):', reason);
  return accepted();
}

function str(value) {
  return typeof value === 'string' ? value.trim().slice(0, 5000) : '';
}

export async function onRequestPost({ request, env, waitUntil }) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return reject('body is not JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reject('body is not an object');
  if (LEGACY_KEYS.some((k) => k in body)) return reject('legacy payload shape');

  const lead = {};
  for (const k of FIELDS) if (k !== 'time_to_fill_ms') lead[k] = str(body[k]);
  const fillMs = Number(body.time_to_fill_ms);

  if (!lead.name || !lead.phone || !lead.zip) return reject('missing name/phone/zip');
  if (!Number.isFinite(fillMs) || fillMs < MIN_FILL_MS) return reject('filled too fast: ' + body.time_to_fill_ms);
  const areaCity = cityForZip(lead.zip);
  if (!areaCity) return reject('zip outside service area: ' + lead.zip);
  if (!lead.city) lead.city = areaCity;

  const missing = ['RESEND_API_KEY', 'LEAD_FROM', 'LEAD_TO'].filter((k) => !env[k]);
  if (missing.length) {
    console.error('LEAD NOT SENT — missing env vars: ' + missing.join(', '), JSON.stringify(lead));
    return json({ error: CALL_US, detail: 'Server misconfigured: missing ' + missing.join(', ') }, 500);
  }

  const notes = [];
  if (!KNOWN_FUNNELS.includes(lead.funnel)) notes.push('Unrecognized funnel "' + lead.funnel + '"');
  const extra = Object.keys(body).filter((k) => !FIELDS.includes(k));
  if (extra.length) notes.push('Unexpected fields ignored: ' + extra.join(', '));

  const subject = ('New lead: ' + lead.name + ' — ' + (lead.service || 'general') +
    ' (' + lead.zip + '/' + lead.city + ')').replace(/[\r\n]+/g, ' ');
  const text = [
    'Name:     ' + lead.name,
    'Phone:    ' + lead.phone,
    'Email:    ' + (lead.email || '(none)'),
    'Zip:      ' + lead.zip,
    'City:     ' + lead.city,
    'Service:  ' + (lead.service || '(general)'),
    'Message:  ' + (lead.message || '(none)'),
    '',
    'Funnel:   ' + lead.funnel,
    'Source:   ' + lead.source,
    'Time to fill: ' + Math.round(fillMs / 1000) + 's',
    'Received: ' + new Date().toISOString()
  ].concat(notes.length ? ['', 'Notes:'].concat(notes.map((n) => '- ' + n)) : []).join('\n');

  const mail = {
    from: env.LEAD_FROM,
    to: env.LEAD_TO.split(',').map((s) => s.trim()).filter(Boolean),
    subject,
    text
  };
  if (lead.email) mail.reply_to = lead.email;

  let resp;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(mail)
    });
  } catch (err) {
    console.error('LEAD NOT SENT — Resend unreachable:', err.message, JSON.stringify(lead));
    return json({ error: CALL_US }, 502);
  }
  if (!resp.ok) {
    console.error('LEAD NOT SENT — Resend ' + resp.status + ':', await resp.text(), JSON.stringify(lead));
    return json({ error: CALL_US }, 502);
  }

  if (lead.email) {
    waitUntil(fetch(COURIER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: lead.email,
        name: lead.name,
        list: COURIER_LIST,
        source: lead.source,
        funnel: lead.funnel,
        metadata: {
          phone: lead.phone,
          zip: lead.zip,
          city: lead.city,
          service: lead.service,
          message: lead.message,
          time_to_fill_ms: fillMs
        }
      })
    }).then((r) => {
      if (!r.ok) console.error('Courier subscribe failed (lead already sent):', r.status);
    }).catch((err) => console.error('Courier subscribe failed (lead already sent):', err.message)));
  }

  return accepted();
}
