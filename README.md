# Blue River Gutters Website

Professional gutter services website for Blue River Gutters, serving Huntsville, Madison, Decatur, and throughout North Alabama.

## Tech Stack

- **Static Site Generator:** [Eleventy (11ty)](https://www.11ty.dev/) v3.0
- **Templating:** Nunjucks
- **CSS:** Custom stylesheet (no framework)
- **Images:** Cloudinary CDN
- **Hosting:** GitHub Pages

## Project Structure

```
/
├── src/                    # Source files (11ty input)
│   ├── _includes/          # Reusable components
│   │   ├── layouts/        # Page layouts (base, city, service)
│   │   └── partials/       # Header, footer
│   ├── _data/              # Global data files (JSON/JS)
│   ├── css/                # Stylesheets
│   ├── js/                 # JavaScript files
│   ├── images/             # Local images (prefer Cloudinary)
│   ├── locations/          # City landing pages
│   ├── services/           # Service pages by city
│   ├── blog/               # Blog posts
│   └── index.njk           # Homepage
├── .github/workflows/      # GitHub Actions
│   └── build.yml           # Auto-build and deploy
├── _site/                  # Built output (gitignored)
├── eleventy.config.js      # 11ty configuration
├── package.json            # Dependencies
└── README.md               # This file
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

The dev server runs at `http://localhost:8080` with live reload.

### Build Output

The `_site` folder contains the built static files. This folder is gitignored.

## Deployment

### Automatic Deployment

The site auto-deploys to GitHub Pages via GitHub Actions when changes are pushed to `main`:

1. Push triggers `.github/workflows/build.yml`
2. Action installs dependencies and runs `npx eleventy`
3. Built `_site/` folder deploys to `gh-pages` branch
4. GitHub Pages serves from `gh-pages` branch

### GitHub Pages Setup

To enable GitHub Pages for this repo:

1. Go to **Settings** → **Pages**
2. Under "Build and deployment":
   - Source: **Deploy from a branch**
   - Branch: **gh-pages** / **(root)**
3. Save

**Preview site:** [mrmicaiah.github.io/bluerivergutters](https://mrmicaiah.github.io/bluerivergutters)

When ready for production, add `cname: bluerivergutters.com` to the workflow deploy step and configure DNS.

### Manual Deploy

If needed, you can manually trigger a deploy:
1. Go to **Actions** tab
2. Select "Build and Deploy 11ty Site"
3. Click "Run workflow"

## Image Handling

Images are served via Cloudinary CDN for performance:

- **Cloud name:** `dxzw1zwez`
- **Folder:** `blue-river-gutters/`
- **Base URL:** `https://res.cloudinary.com/dxzw1zwez/image/upload/`

Example usage:
```html
<img src="https://res.cloudinary.com/dxzw1zwez/image/upload/v1/blue-river-gutters/hero.jpg" alt="...">
```

## Content Structure

### City Landing Pages
- Location: `src/locations/[city].njk`
- Layout: `city.njk`
- URL pattern: `/gutters-[city]-al/`

### Service Pages
- Location: `src/services/[city]/[service].njk`
- Layout: `service.njk`
- URL pattern: `/services/[city]/[service]/`

Six services per city:
- Seamless Gutters
- Gutter Guards
- Gutter Cleaning
- Downspouts
- Underground Drains
- Rotten Wood Repair

### Blog
- Location: `src/blog/`
- Informational content for SEO and authority building

## Development Notes

- Templates use Nunjucks (`.njk`) files
- Markdown (`.md`) supported for content pages
- CSS variables defined in `src/css/styles.css`
- Site data (company info, navigation) goes in `src/_data/`
- Each layout (city, service) has its own CSS file

---

**Client:** Blue River Gutters  
**Managed by:** Untitled Publishers
