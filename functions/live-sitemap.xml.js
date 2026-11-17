// GET /live-sitemap.xml — /live/ and its current archive pages
// (functions/_shared/ssr.js). Listed in robots.txt; cached 1h.
import { serveSitemap } from './_shared/ssr.js';

export const onRequestGet = serveSitemap;
