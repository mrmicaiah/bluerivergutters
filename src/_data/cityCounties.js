// city_slug -> county, read from the city landing pages' frontmatter
// (src/locations/*.njk), so the county named on a service-city page's
// location line always matches its city page. Used by partials/service-hero.njk.
const fs = require("fs");
const path = require("path");

module.exports = function () {
  const dir = path.join(__dirname, "..", "locations");
  const map = {};
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".njk")) continue;
    const fm = (fs.readFileSync(path.join(dir, file), "utf8").match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
    const slug = (fm.match(/^city_slug:\s*["']?([^"'\n]+?)["']?\s*$/m) || [])[1];
    const county = (fm.match(/^county:\s*["']?([^"'\n]+?)["']?\s*$/m) || [])[1];
    if (slug && county) map[slug] = county;
  }
  return map;
};
