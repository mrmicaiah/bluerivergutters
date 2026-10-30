// Service area: the single source for every lead form's zip handling.
//
// Rendered into each form script (window.BRG_SERVICE_AREA) and read by
// /js/lead-guards.js for two jobs: the zip allowlist guard (out-of-area zips
// get a visible message, never a silent fail) and the zip -> city auto-fill.
// Covers the 30 cities in src/locations/. All of Huntsville proper is 358xx,
// so that block is accepted by prefix; everything else is listed explicitly.
// Deliberately generous — a wrong rejection turns away a paying customer,
// while a wrong acceptance only lets through a lead we can triage.
//
// When a zip shares two towns, the city is the one a homeowner most likely
// writes on an envelope; the comment names the other.
module.exports = {
  prefixes: {
    '358': 'Huntsville' // incl. Monrovia, Redstone
  },
  zips: {
    '35756': 'Madison', // also covers Triana
    '35757': 'Madison',
    '35758': 'Madison',
    '35749': 'Harvest', // also Monrovia
    '35750': 'Hazel Green',
    '35759': 'Meridianville',
    '35760': 'New Hope',
    '35761': 'New Market',
    '35763': 'Owens Cross Roads', // also Hampton Cove
    '35764': 'Paint Rock',
    '35773': 'Toney',
    '35741': 'Brownsboro',
    '35748': 'Gurley',
    '35754': 'Laceys Spring',
    '35739': 'Ardmore',
    '35620': 'Elkmont',
    '35611': 'Athens',
    '35612': 'Athens',
    '35613': 'Athens',
    '35614': 'Athens',
    '35671': 'Tanner',
    '35601': 'Decatur',
    '35602': 'Decatur',
    '35603': 'Decatur', // also covers Priceville
    '35673': 'Trinity',
    '35640': 'Hartselle',
    '35670': 'Somerville',
    '35055': 'Cullman',
    '35056': 'Cullman',
    '35057': 'Cullman',
    '35058': 'Cullman',
    '35016': 'Arab',
    '35950': 'Albertville',
    '35951': 'Albertville',
    '35976': 'Guntersville',
    '35768': 'Scottsboro',
    '35769': 'Scottsboro'
  }
};
