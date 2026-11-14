// Outreach/pitch wordlist: the server's copy of the list the lead forms check
// client-side (OUTREACH_PHRASES / OUTREACH_WORDS in src/js/lead-form.js).
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
  outreachWords: ['seo']
};
