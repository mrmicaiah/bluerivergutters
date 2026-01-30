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

The CNAME file for `bluerivergutters.com` is automatically added during deploy.

**Live site:** [bluerivergutters.com](https://bluerivergutters.com)  
**Preview site:** [mrmicaiah.github.io/bluerivergutters](https://mrmicaiah.github.io/bluerivergutters)

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

## GitHub Actions Workflow

The workflow file (`.github/workflows/build.yml`) should contain:

```yaml
name: Build and Deploy 11ty Site

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    
    permissions:
      contents: write
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build 11ty site
        run: npx eleventy

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./_site
          publish_branch: gh-pages
          cname: bluerivergutters.com
```

---

**Client:** Blue River Gutters  
**Managed by:** Untitled Publishers
