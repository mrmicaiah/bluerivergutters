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
│   │   ├── layouts/        # Page layouts (base, page, etc.)
│   │   └── partials/       # Header, footer, nav, etc.
│   ├── _data/              # Global data files (JSON/JS)
│   ├── css/                # Stylesheets
│   ├── js/                 # JavaScript files
│   ├── images/             # Local images (prefer Cloudinary)
│   ├── locations/          # City landing pages
│   ├── services/           # Service pages by city
│   ├── blog/               # Blog posts
│   └── index.njk           # Homepage
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

The `_site` folder contains the built static files. This folder is gitignored — GitHub Pages will build from source.

## Deployment

The site deploys automatically to GitHub Pages when changes are pushed to the `main` branch.

**Live site:** [bluerivergutters.com](https://bluerivergutters.com)  
**Preview site:** [mrmicaiah.github.io/bluerivergutters](https://mrmicaiah.github.io/bluerivergutters)

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

### City Landing Pages (`/locations/`)
One page per service area city. URL pattern: `/gutters-[city]-al/`

### Service Pages (`/services/[city]/`)
Six services per city:
- Seamless Gutters
- Gutter Guards
- Gutter Cleaning
- Downspouts
- Underground Drains
- Rotten Wood Repair

### Blog (`/blog/`)
Informational content for SEO and authority building.

## Development Notes

- Templates use Nunjucks (`.njk`) files
- Markdown (`.md`) supported for content pages
- CSS variables defined in `src/css/styles.css`
- Site data (company info, navigation) goes in `src/_data/`

---

**Client:** Blue River Gutters  
**Managed by:** Untitled Publishers
