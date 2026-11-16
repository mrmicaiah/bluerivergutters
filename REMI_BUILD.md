# Blue River Gutters website — how we work (build and bugs managers)

Maintained by Remi (Studio87 operations). Version 1, 2026-11-15.
Read this at the start of every chat and every work order. If anything older in your chat disagrees with this file, this file wins.

**This repo is public.** Nothing private goes in it: no passwords, keys, tokens, personal emails or phone numbers, in files, commits or messages.

## Current goal (phase: grow)

**Grow Blue River's local search and leads.** The site is live (moved from Wix, complete). This phase is Blue River Live (the `/live/` photo stream and homepage live strip, Adam posting from the field) and the hyper-local SEO build-out below. Remi rewrites this section when the phase changes.

## 1. The project

Website for Blue River Gutters (owner Adam Bussey; gutter installation, repair, cleaning and guards in Huntsville and North Alabama), bluerivergutters.com.
- Eleventy (11ty) with Nunjucks templates. Cloudflare Pages, which **auto-deploys on push to main** (~1-2 min).
- Images: Cloudinary (cloud `dxzw1zwez`). Analytics: GA4.
- Admin dashboard at `/admin/` (password protected; the password is never written anywhere).

### Before building any page
1. Check `src/_includes/layouts/` for an existing template (base.njk, service.njk, location.njk, blog.njk).
2. Look at similar existing pages for front matter structure.
3. Use `.njk` files, not `.html`.
4. Internal links use the `| url` filter: `{{ '/page-slug/' | url }}`.

### File structure
```
src/
├── locations/         city landing pages (gutters-madison-al.njk)
├── services/[city]/   service pages by city
├── blog/              blog posts
├── articles/          SEO articles
├── admin/             admin dashboard (password protected)
└── _includes/layouts/ templates
```

## 2. The SEO strategy

Don't fight for "gutters Huntsville AL". Blanket the service area with city-specific pages that catch long-tail, high-intent searches: every city, packed with local references, local problems and local solutions. Competitors: Mr Gutter (mrgutter.com) and Gutter Gliders. (Studio87 also builds Mr Gutter's site: never share content or branding between the two.)

**Content architecture**
1. City landing pages: `/gutters-[city]-al/`. Local drainage problems, services, why local matters, testimonials, CTA. 800-1200 words (tiny towns 800-1000).
2. Service + city pages: `/services/[city]/[service]/` for Seamless Gutters, Gutter Guards, Gutter Cleaning, Downspouts, Underground Drains, Rotten Wood Repair. 1200-1500 words: local problem hook, solution, benefits, FAQ, schema.
3. Problem-focused blog posts: `/blog/[slug]/`, 1500-2500 words (red clay soil, flood plain, seasonal maintenance, pine needles, pricing guides).

**Target cities**
- Tier 1: Huntsville, Madison, Decatur, Athens, Hartselle
- Tier 2: Scottsboro, Albertville, Cullman, Arab, Guntersville
- Tier 3: Meridianville, Hazel Green, Hampton Cove, Owens Cross Roads, Harvest, Toney, New Hope, New Market, Monrovia, Brownsboro, Priceville, Trinity, Tanner, Somerville, Lacey's Spring, Elkmont, Ardmore, Gurley, Paint Rock, Triana

**Local angles:** red clay soil that won't absorb water; Tennessee River flood plain; pine needle season; builder-grade gutters failing in fast-growing Madison/Hampton Cove; humidity and wood rot; spring storms and fall leaf timing.

**Every page has:** LocalBusiness schema, Service schema (service pages), FAQ schema where it applies, Breadcrumb schema, a meta title and description with city + service, internal links to related pages, mobile layout, fast images via Cloudinary.
**Site-wide:** XML sitemap (Eleventy), HTML sitemap page, robots.txt, 301s from the old Wix URLs, consistent business name, address and phone on every page.

**Tone and structure:** professional but approachable, local expertise, specific over generic. Hook with a local problem → the solution → why Blue River → a clear CTA (call or schedule) → FAQ with schema.
**Internal linking:** every service page links to its city page; every city page links to its 6 service pages; blog posts link to relevant service and city pages; the footer links all locations.
**Business facts** (years in business, review counts and ratings) come from Adam through Micaiah and are checked before use. Don't invent them.

## 3. Rules of the build

- Nothing is ever deleted: close, combine, archive, park branches, or mark deprecated. Code included.
- No workarounds: fix the real cause.
- Nothing private in this public repo (see the top).
- No direct contact with Adam or his customers. Anything for Adam is a draft for Micaiah.

## 4. How work reaches you

- Work comes only as a work order from Remi. One order at a time.
- Anything new you find (a bug, a risk, an idea) is NOT added to the current order. Post it on the order as a finding; Remi takes it down as a new request.
- Micaiah may talk to you directly and often reviews Blue River on production himself. His word stands; post what he decided on the order.

## 5. Reporting: on the work order, not in Remi's chat

Post everything on the work order: your checklist, progress, findings, questions, and your done list. Remi reads order posts at every check-in.

Message Remi directly ONLY when:
- the order is done and ready to go live (with the go-live commands), or
- you need a push or deploy run, or
- the order is live and confirmed, ready to close.

A question that needs Micaiah: post it on the order in one plain line with the fact and your recommendation. Remi brings it to him and posts his answer back. Keep working on everything that doesn't depend on it.

Messages to Remi start with the order number, stay short, and are never re-sent or acknowledged.

## 6. How you build

1. When an order arrives, post your checklist on it: one line per thing that must be true, a rough size, simple test steps, and what going live will need. Then start; don't wait for a reply.
2. Where there are tests, write them first and see them fail for the right reason. At minimum the build is green, schema validates, and changed pages are checked on a phone-size screen.
3. Commit everything. Do NOT push.
4. Post the done list line by line: tested how? which commits? anything not done or done differently?
5. Separate what's proven from what's assumed.

Studio87: this chat is the manager; Claude Code workers run in the repo. Read `/mnt/skills/user/studio87-operating-instructions/SKILL.md` before dispatching. Dispatch with ```PROMPT blocks; worker replies arrive as user messages. For long specs, write them to a repo file and point the worker at it.

## 7. Going live

Micaiah often reviews Blue River on production and pushes it himself. When he hasn't, send Remi the exact commands, one per line; Remi runs them in your pane one at a time:
- The push to main, with a range check (origin/main must be where you expect; the exact commits listed). Cloudflare deploys it.
Then check it live yourself and tell Remi "confirmed live".

## 8. Never without Micaiah's yes

Domain or DNS changes, Cloudflare or GA4 account settings, anything that costs money or contacts Adam or customers, secrets.

## 9. Test data

Test form submissions or posts are marked TEST and never deleted.
