// Banner-concept picker — the live-banner-options preview branch ONLY.
//
// true on Cloudflare Pages builds of that branch (CF_PAGES_BRANCH), or
// locally with BRG_BANNER_PICKER=1. Every other build (main, production,
// other previews) gets false, and base.njk then renders no picker and
// ignores ?banner= entirely. Delete this file with the picker once
// Micaiah has chosen.
module.exports = process.env.BRG_BANNER_PICKER === '1' || process.env.CF_PAGES_BRANCH === 'live-banner-options';
