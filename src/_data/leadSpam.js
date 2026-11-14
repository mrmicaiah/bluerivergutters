// Outreach/pitch wordlist and name-link TLDs: the server's copy of the lists
// the lead forms check client-side (OUTREACH_PHRASES / OUTREACH_WORDS and the
// TLD group of NAME_LINK in src/js/lead-form.js).
//
// functions/api/lead.js imports this file, the same way it imports
// serviceArea.js. The client still carries its own inline copy, so
// tests/functions/lead.test.mjs fails if the two drift: change both together.
//
// Conservative on purpose: a homeowner describing a gutter problem never
// writes any of these.
module.exports = {
  // Matched as case-insensitive substrings.
  outreachPhrases: [
    'search ranking', 'virtual assistant', 'outsourc', 'backlink',
    'guest post', 'web design services', 'digital marketing',
    'lead generation', 'increase your revenue', 'grow your business',
    'marketing agency', 'appointment setter'
  ],
  // Matched as whole words only: 'seo' as a bare substring would fire on any
  // longer word that happens to contain it.
  outreachWords: ['seo'],
  // Domain endings that mark a name as a link (with http(s):, www. and @,
  // which the server and client check alongside). Must equal the TLD group in
  // NAME_LINK in src/js/lead-form.js, same order.
  nameTlds: [
    'com', 'net', 'org', 'io', 'co', 'biz', 'info', 'us', 'xyz', 'online',
    'site', 'agency', 'ai', 'dev', 'app', 'store', 'tech', 'digital', 'studio'
  ]
};
