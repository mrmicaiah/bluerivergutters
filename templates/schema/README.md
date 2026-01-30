# Blue River Gutters - Schema Markup Templates

This folder contains reusable JSON-LD schema markup snippets for SEO.

## Files

| File | Purpose |
|------|--------|
| `local-business.json` | LocalBusiness schema - include on every page |
| `service.json` | Service schema - use on service-specific pages |
| `faq.json` | FAQPage schema - use when page has FAQ section |
| `breadcrumb.json` | BreadcrumbList schema - include on all interior pages |
| `aggregate-rating.json` | AggregateRating schema - use on pages with testimonials |
| `how-to-use.md` | Implementation guide |

## Quick Start

1. Copy the appropriate JSON-LD snippet
2. Replace placeholder variables (marked with `{{VARIABLE_NAME}}`)
3. Place inside `<script type="application/ld+json">` tags in page `<head>`
4. Validate at https://search.google.com/test/rich-results

## Placeholder Variables

### Common Variables
- `{{PAGE_URL}}` - Full URL of current page
- `{{PAGE_TITLE}}` - Title of current page
- `{{PAGE_DESCRIPTION}}` - Meta description of current page

### City-Specific Variables
- `{{CITY_NAME}}` - City name (e.g., "Madison")
- `{{CITY_STATE}}` - State abbreviation (always "AL")
- `{{CITY_FULL}}` - Full city/state (e.g., "Madison, AL")

### Service-Specific Variables
- `{{SERVICE_NAME}}` - Service name (e.g., "Seamless Gutter Installation")
- `{{SERVICE_DESCRIPTION}}` - Brief service description
- `{{SERVICE_URL}}` - URL to service page

---

*Last updated: January 30, 2026*
