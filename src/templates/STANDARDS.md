---
# Internal reference doc — build it, but never publish it.
permalink: false
eleventyExcludeFromCollections: true
---

# Blue River Gutters Site Standards

**Reference this document before creating any new pages.**

This is an **11ty (Eleventy)** static site. Understanding the build system prevents common issues.

---

## Site Architecture

```
src/
├── _data/           # Global data files (JSON/JS)
├── _includes/
│   ├── layouts/     # Page layouts (base.njk, service.njk, city.njk)
│   └── partials/    # Reusable components (header.njk, footer.njk)
├── css/             # Stylesheets
├── js/              # Scripts
├── locations/       # City landing pages
├── services/        # Service pages organized by city
│   ├── huntsville/
│   ├── madison/
│   └── ...
├── blog/            # Blog posts
└── index.njk        # Homepage
```

---

## CSS Paths

**Always use 11ty's url filter for paths:**

```njk
<link rel="stylesheet" href="{{ '/css/styles.css' | url }}">
```

This outputs root-relative paths (`/css/styles.css`) that work from any folder depth.

**NEVER use:**
- Relative paths: `../css/styles.css`
- Hardcoded absolute paths without the url filter

The base layout (`_includes/layouts/base.njk`) already handles CSS loading — new pages should extend it.

---

## Image URLs (Cloudinary)

**All images are hosted on Cloudinary.**

| Setting | Value |
|---------|-------|
| Cloud name | `dxzw1zwez` |
| Base URL | `https://res.cloudinary.com/dxzw1zwez/image/upload/` |

### Common Images

| Image | URL |
|-------|-----|
| Logo | `https://res.cloudinary.com/dxzw1zwez/image/upload/logo_fih2rm.webp` |
| OG/Hero Background | `https://res.cloudinary.com/dxzw1zwez/image/upload/hero-bg_axhlw4.jpg` |
| Why Local Section | `https://res.cloudinary.com/dxzw1zwez/image/upload/f_auto,q_auto,w_600/cleaning_composite_facia_ekqfke.webp` |

### Service Hero Images

| Service | URL |
|---------|-----|
| Seamless Gutters | `https://res.cloudinary.com/dxzw1zwez/image/upload/f_auto,q_auto,w_1920/corner_of_a_roof_gutters_yd8zzf.jpg` |
| Gutter Guards | `https://res.cloudinary.com/dxzw1zwez/image/upload/f_auto,q_auto,w_1920/gutter_guards_metal_roof_hnrqoc.webp` |
| Gutter Cleaning | `https://res.cloudinary.com/dxzw1zwez/image/upload/f_auto,q_auto,w_1920/dirty_gutter_v8f4cm.jpg` |
| Downspouts | `https://res.cloudinary.com/dxzw1zwez/image/upload/f_auto,q_auto,w_1920/gutter_on_house_zbvhii.webp` |
| Underground Drains | `https://res.cloudinary.com/dxzw1zwez/image/upload/f_auto,q_auto,w_1920/french_drains_peqnfn.webp` |
| Rotten Wood Repair | `https://res.cloudinary.com/dxzw1zwez/image/upload/f_auto,q_auto,w_1920/rotten_wood_hero_r1dtrh.jpg` |

### Service Card Images

| Service | URL |
|---------|-----|
| Seamless Gutters | `https://res.cloudinary.com/dxzw1zwez/image/upload/service-seamless-gutters_hcf6si.webp` |

### Image Transformation Parameters

Always include these for performance:

- `f_auto` — Auto-select best format (WebP, AVIF where supported)
- `q_auto` — Auto-select quality level
- `w_[width]` — Resize to specific width

**Example:** `f_auto,q_auto,w_1920` for hero images

---

## Navigation Links

**All navigation links must use root-relative paths or the url filter.**

| Page | URL |
|------|-----|
| Home | `/` |
| Services Index | `/services/` |
| Locations | `/locations/` |
| Blog | `/blog/` |
| Contact/CTA | `/#contact` (homepage section) |

**In templates, use:**
```njk
<a href="{{ '/' | url }}">Home</a>
<a href="{{ '/services/' | url }}">Services</a>
```

---

## File Naming Conventions

### City Landing Pages
**Location:** `src/locations/`  
**Format:** `gutters-[city]-al.njk`  
**Permalink:** `/gutters-[city]-al/`

**Examples:**
- `gutters-huntsville-al.njk` → `/gutters-huntsville-al/`
- `gutters-madison-al.njk` → `/gutters-madison-al/`

### Service Pages
**Location:** `src/services/[city]/`  
**Format:** `[service-slug].njk`  
**Permalink:** `/services/[city]/[service-slug]/`

**Examples:**
- `src/services/huntsville/seamless-gutters.njk` → `/services/huntsville/seamless-gutters/`
- `src/services/madison/gutter-guards.njk` → `/services/madison/gutter-guards/`

### Blog Posts
**Location:** `src/blog/`  
**Format:** `[slug].njk` or `[slug].md`  
**Permalink:** `/blog/[slug]/`

---

## Layouts

### Available Layouts

| Layout | Purpose | Location |
|--------|---------|----------|
| `base.njk` | Base HTML wrapper | `src/_includes/layouts/` |
| `service.njk` | Service + city pages (pass-through; sections in `partials/service-body.njk`) | `src/_includes/layouts/` |
| `city.njk` | City landing pages (pass-through; sections in `partials/city-body.njk`) | `src/_includes/layouts/` |
| `article.njk` | Blog posts | `src/_includes/layouts/` |

### Using Layouts

```njk
---
layout: service.njk
title: Seamless Gutters Huntsville AL
description: Professional seamless gutter installation...
---
```

**Don't create new layout files unless absolutely necessary.** Existing layouts handle all current use cases.

{% raw %}
### Content Blocks on Service and City Pages — REQUIRED PATTERN

Service and city pages write their long-form prose into `{% set %}` blocks (`local_problem`,
`service_explanation`, `why_us` on service pages; `local_problems`, `why_local`,
`local_deep_dive`, `homeowner_guide`, `local_spotlight` on city pages).

**A `{% set %}` variable is NOT visible to an Eleventy layout.** Eleventy renders the page and
its layout as two separate passes — only frontmatter data and `content` cross that boundary. A
page that just defines set-blocks and stops renders *nothing*: the sections silently disappear
and the page ships frontmatter-only. (This is exactly what happened site-wide before Sept 2026 —
81,000 words across 192 pages were written but never published.)

So the page markup lives in a partial that the page itself includes, which keeps the set-blocks
in scope. **Every service and city page must end with its include line:**

```njk
---
layout: service.njk
...
---

{% set local_problem %}
<p>...</p>
{% endset %}

{% set service_explanation %}
<p>...</p>
{% endset %}

{% set why_us %}
<p>...</p>
{% endset %}

{% include "partials/service-body.njk" %}
```

City pages use `{% include "partials/city-body.njk" %}` instead. The include goes **last**, after
every set-block — Nunjucks evaluates top to bottom, so anything defined below the include is
invisible to it.

**After adding or editing one of these pages, always confirm your prose is actually in the
output:**

```bash
npm run build && grep -c "a distinctive phrase from your set-block" _site/<your-page>/index.html
```

A count of 0 means the include line is missing or misplaced.
{% endraw %}

---

## Schema Markup

### Required on Every Page

1. **LocalBusiness** — Embedded in base layout (verify it's present)
2. **BreadcrumbList** — Required for all subpages

### Required by Page Type

| Page Type | Additional Schema |
|-----------|-------------------|
| Service pages | `Service` schema |
| FAQ sections | `FAQPage` schema |

### Schema is Handled by Layouts

The `service.njk` and `city.njk` body partials automatically generate schema markup based on frontmatter data. Don't manually add schema unless the layout doesn't cover your case.

---

## Frontmatter Reference (Service Pages)

```yaml
---
layout: service.njk
title: SEO Title | Blue River Gutters
description: Meta description (150-160 chars)
permalink: /services/[city]/[service]/

# Service + City Data
service: Service Name
service_slug: service-slug
city: City Name
city_slug: city-slug
state: AL
distance: "15"  # Minutes from Huntsville

# Images
service_image: https://res.cloudinary.com/...

# Hero
hero_headline: Main H1 Headline
hero_intro: "Opening paragraph text"

# Section Headings
problem_eyebrow: The City Problem
problem_headline: Why City Homes Need Service

explanation_eyebrow: The Smart Choice
explanation_headline: What Are Service?

benefits_eyebrow: Why Upgrade?
benefits_headline: Benefits of Service

# Benefits Array
benefits:
  - title: Benefit Title
    text: Benefit description text

# FAQs Array
faqs:
  - question: Question text?
    answer: "<p>Answer HTML</p>"

# CTA
cta_headline: Get a Free Estimate
cta_subhead: Subheading text
---
```

---

## Brand Colors (CSS Variables)

```css
:root {
  --navy: #0f172a;
  --slate: #334155;
  --gray: #64748b;
  --light-gray: #f1f5f9;
  --cream: #faf8f5;
  --white: #ffffff;
  --blue: #1e40af;
  --blue-light: #3b82f6;
  --red: #b91c1c;      /* Primary CTA color */
  --red-dark: #991b1b;
}
```

---

## Before Publishing Checklist

- [ ] Layout is set correctly (service.njk, city.njk, etc.)
- [ ] Permalink follows naming convention
- [ ] All frontmatter fields populated
- [ ] All Cloudinary image URLs are valid
- [ ] Local build passes (`npm run build` or `npx @11ty/eleventy`)
- [ ] Mobile responsive (check at 375px width)
- [ ] Links work from the page's actual URL depth
- [ ] Meta title under 60 characters
- [ ] Meta description 150-160 characters
- [ ] FAQs have proper HTML in answers

---

## Common Mistakes to Avoid

1. **Using relative CSS paths** — Always use `{{ '/css/styles.css' | url }}`
2. **Broken image URLs** — Always copy exact Cloudinary URLs from this doc
3. **Wrong permalink format** — Must start and end with `/`
4. **Missing trailing slash** — `/services/huntsville/seamless-gutters/` not `/services/huntsville/seamless-gutters`
5. **Hardcoding content in layouts** — Use frontmatter variables instead
6. **Creating duplicate layouts** — Reuse the existing layouts; add content via {% raw %}`{% set %}`{% endraw %} blocks
7. **Omitting the body include** — A service or city page without its trailing
   {% raw %}`{% include "partials/service-body.njk" %}`{% endraw %} (or `city-body.njk`) renders
   with *no* content sections at all, silently. See "Content Blocks on Service and City Pages" above.

---

## Quick Reference Commands

```bash
# Local development
npm run dev

# Build for production
npm run build

# Check if build succeeds
npx @11ty/eleventy
```

---

*Last updated: January 30, 2026*
