# How to Implement Schema Markup

## Quick Implementation Guide

### Step 1: Choose Required Schemas

| Page Type | Required Schemas |
|-----------|------------------|
| Homepage | LocalBusiness, AggregateRating |
| City Landing Page | LocalBusiness, Breadcrumb, FAQ, AggregateRating |
| Service + City Page | LocalBusiness, Service, Breadcrumb, FAQ |
| Blog Post | LocalBusiness, Breadcrumb |
| Contact Page | LocalBusiness |

### Step 2: Add to HTML

Place schema in the `<head>` section:

```html
<head>
  <title>Seamless Gutters Madison AL | Blue River Gutters</title>
  <meta name="description" content="...">
  
  <!-- Schema Markup -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Service",
    ...
  }
  </script>
  
  <!-- You can include multiple schemas -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    ...
  }
  </script>
</head>
```

### Step 3: Replace Variables

Find and replace all `{{VARIABLE}}` placeholders with actual values.

**Example for Madison Seamless Gutters page:**

```
{{PAGE_URL}} → https://bluerivergutters.com/seamless-gutters-madison-al/
{{SERVICE_NAME}} → Seamless Gutter Installation
{{CITY_NAME}} → Madison
{{CITY_STATE}} → AL
{{SERVICE_DESCRIPTION}} → Professional seamless gutter installation in Madison, AL. Custom-fit aluminum gutters with no seams to leak.
```

### Step 4: Validate

Always validate schema before publishing:

1. **Google Rich Results Test**: https://search.google.com/test/rich-results
2. **Schema.org Validator**: https://validator.schema.org/

---

## Complete Example: Service + City Page

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Seamless Gutters Madison AL | Blue River Gutters</title>
  <meta name="description" content="Professional seamless gutter installation in Madison, Alabama. Custom-fit, no leaks. Free estimates. Call (256) 616-6760.">
  
  <!-- LocalBusiness Schema (every page) -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "HomeAndConstructionBusiness",
    "@id": "https://bluerivergutters.com/#organization",
    "name": "Blue River Gutters",
    "url": "https://bluerivergutters.com",
    "telephone": "+1-256-616-6760",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "3315 Memorial Pkwy SW Suite B13",
      "addressLocality": "Huntsville",
      "addressRegion": "AL",
      "postalCode": "35801",
      "addressCountry": "US"
    }
  }
  </script>
  
  <!-- Service Schema -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "Seamless Gutter Installation in Madison, AL",
    "description": "Professional seamless gutter installation in Madison, Alabama. Custom-fabricated on-site for a perfect fit with no seams to leak.",
    "provider": {
      "@type": "HomeAndConstructionBusiness",
      "@id": "https://bluerivergutters.com/#organization"
    },
    "areaServed": {
      "@type": "City",
      "name": "Madison",
      "addressRegion": "AL"
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.7",
      "reviewCount": "240"
    }
  }
  </script>
  
  <!-- Breadcrumb Schema -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": "https://bluerivergutters.com"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "Madison, AL",
        "item": "https://bluerivergutters.com/gutters-madison-al/"
      },
      {
        "@type": "ListItem",
        "position": 3,
        "name": "Seamless Gutters"
      }
    ]
  }
  </script>
  
  <!-- FAQ Schema -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "How much do seamless gutters cost in Madison, AL?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Seamless gutter installation in Madison typically costs $6-12 per linear foot, depending on material and home height. We provide free estimates for accurate pricing."
        }
      },
      {
        "@type": "Question",
        "name": "How long does seamless gutter installation take?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Most Madison homes can have new seamless gutters installed in a single day. Larger or multi-story homes may take 1-2 days."
        }
      }
    ]
  }
  </script>
</head>
<body>
  ...
</body>
</html>
```

---

## Common Mistakes to Avoid

1. **Duplicate @id values** - Each @id should be unique across the site
2. **Missing required properties** - Always include name, description for services
3. **Invalid JSON** - Use a JSON validator before testing
4. **Broken URLs** - Make sure all URLs are valid and accessible
5. **Fake reviews** - Only use real customer reviews in Review schema
6. **Wrong date format** - Use ISO 8601 format: YYYY-MM-DD

---

## Testing Checklist

- [ ] JSON is valid (no syntax errors)
- [ ] All placeholder variables replaced
- [ ] URLs are correct and accessible
- [ ] Phone number includes country code (+1)
- [ ] Passes Google Rich Results Test
- [ ] Review dates are in YYYY-MM-DD format
- [ ] LocalBusiness @id matches across all pages

---

*For questions, contact Untitled Publishers.*
