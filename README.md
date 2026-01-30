# Blue River Gutters Website

Professional gutter services website for Blue River Gutters, serving Huntsville, Madison, Decatur, and throughout North Alabama.

## Tech Stack

- **Static Site Generator:** [Eleventy (11ty)](https://www.11ty.dev/) v3.0
- **Templating:** Nunjucks
- **CSS:** Custom stylesheet (no framework)
- **Images:** Cloudinary CDN
- **Hosting:** GitHub Pages (auto-deploy from gh-pages branch)

## Project Structure

```
/
├── src/                      # Source files (11ty input)
│   ├── _includes/
│   │   ├── layouts/          # Page layouts
│   │   │   ├── base.njk      # Master template (head, scripts)
│   │   │   ├── city.njk      # City landing pages
│   │   │   └── service.njk   # Service+city pages
│   │   └── partials/
│   │       ├── header.njk
│   │       └── footer.njk
│   ├── _data/                # Global data files (JSON/JS)
│   ├── css/
│   │   ├── styles.css        # Main stylesheet
│   │   ├── city-pages.css    # City page styles
│   │   ├── service-pages.css # Service page styles
│   │   └── locations-page.css
│   ├── js/
│   ├── images/
│   ├── locations/            # City landing pages (.njk)
│   │   ├── index.njk         # /locations/
│   │   ├── huntsville.njk    # /gutters-huntsville-al/
│   │   ├── madison.njk       # /gutters-madison-al/
│   │   ├── decatur.njk       # /gutters-decatur-al/
│   │   ├── athens.njk        # /gutters-athens-al/
│   │   └── hartselle.njk     # /gutters-hartselle-al/
│   ├── services/             # Service pages by city
│   │   ├── huntsville/
│   │   │   └── seamless-gutters.njk
│   │   └── madison/
│   │       ├── seamless-gutters.njk
│   │       ├── gutter-guards.njk
│   │       ├── gutter-cleaning.njk
│   │       ├── downspouts.njk
│   │       ├── underground-drains.njk
│   │       └── rotten-wood-repair.njk
│   ├── blog/                 # Blog posts (future)
│   └── index.njk             # Homepage
├── .github/workflows/
│   └── build.yml             # Auto-build and deploy
├── _site/                    # Built output (gitignored)
├── eleventy.config.js        # 11ty configuration
├── package.json
└── README.md
```

## Local Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Start dev server with hot reload
npm run serve

# Build for production
npm run build
```

Dev server runs at `http://localhost:8080` with live reload.

## Deployment

Site auto-deploys to GitHub Pages via GitHub Actions on push to `main`:

1. Push triggers `.github/workflows/build.yml`
2. Action runs `npm install` and `npx eleventy`
3. Built `_site/` folder deploys to `gh-pages` branch
4. GitHub Pages serves from `gh-pages` branch

**Preview site:** [mrmicaiah.github.io/bluerivergutters](https://mrmicaiah.github.io/bluerivergutters)

### Manual Deploy

1. Go to **Actions** tab
2. Select "Build and Deploy 11ty Site"
3. Click "Run workflow"

## Image Handling

Images served via Cloudinary CDN:

- **Cloud name:** `dxzw1zwez`
- **Base URL:** `https://res.cloudinary.com/dxzw1zwez/image/upload/`

## Content Patterns

### City Landing Pages

- **Location:** `src/locations/[city].njk`
- **Layout:** `city.njk`
- **URL:** `/gutters-[city]-al/`

Front matter includes: city, city_slug, county, distance, local_hook, neighborhoods, testimonials, faqs

### Service Pages

- **Location:** `src/services/[city]/[service].njk`
- **Layout:** `service.njk`
- **URL:** `/services/[city]/[service]/`

Front matter includes: service, service_slug, city, city_slug, hero_intro, benefits array, faqs array

Content blocks use `{% set %}` for multi-paragraph HTML:
- `local_problem` - City-specific problem description
- `service_explanation` - What the service is/how it works
- `why_us` - Why choose Blue River Gutters

## Adding New Pages

### New City

1. Create `src/locations/[city].njk`
2. Use `city.njk` layout
3. Set front matter (copy from existing city)
4. Write content blocks

### New Service Page

1. Create `src/services/[city]/[service].njk`
2. Use `service.njk` layout
3. Set front matter with service and city data
4. Write content blocks

---

## Cleanup Notes

The following legacy files can be deleted (replaced by 11ty):

- `/index.html` → now `src/index.njk`
- `/test.html` → test file, not needed
- `/css/` folder → now `src/css/`
- `/locations/*.html` → now `src/locations/*.njk`
- `/services/madison/*.html` → now `src/services/madison/*.njk`
- `/templates/` folder → layouts now in `src/_includes/layouts/`

---

**Client:** Blue River Gutters  
**Managed by:** Untitled Publishers
