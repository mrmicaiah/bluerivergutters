module.exports = function(eleventyConfig) {
  // Passthrough copy for static assets - map src/css to /css in output
  eleventyConfig.addPassthroughCopy({"src/css": "css"});
  eleventyConfig.addPassthroughCopy({"src/js": "js"});
  eleventyConfig.addPassthroughCopy({"src/images": "images"});
  eleventyConfig.addPassthroughCopy({"src/fonts": "fonts"});
  
  // Passthrough for Cloudflare Pages _redirects file
  eleventyConfig.addPassthroughCopy({"src/_redirects": "_redirects"});

  // Watch for changes in these directories
  eleventyConfig.addWatchTarget("src/css/");
  eleventyConfig.addWatchTarget("src/js/");

  // Date filter for Nunjucks templates
  eleventyConfig.addFilter("dateFormat", function(dateString, format) {
    const date = new Date(dateString);
    const months = ["January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December"];
    const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                         "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    if (format === "MMMM YYYY") {
      return months[date.getMonth()] + " " + date.getFullYear();
    } else if (format === "MMM YYYY") {
      return monthsShort[date.getMonth()] + " " + date.getFullYear();
    } else if (format === "MMMM D, YYYY") {
      // UTC: a bare "2026-08-02" parses as UTC midnight, which is the previous
      // day in Central time.
      return months[date.getUTCMonth()] + " " + date.getUTCDate() + ", " + date.getUTCFullYear();
    }
    return dateString;
  });

  // ISO date filter for sitemap (YYYY-MM-DD format)
  eleventyConfig.addFilter("isoDate", function(date) {
    if (!date) return "";
    const d = new Date(date);
    return d.toISOString().slice(0, 10);
  });

  // Mobile variant of a Cloudinary background image, used by the .rsp-bg
  // media query (main.css) and the paired hero preloads (base.njk).
  //   "wide" (default): same framing at w_828, for short landscape heroes.
  //   "tall": 3:4 content-aware crop at w_828, for heroes that run tall on
  //   phones (80vh+). A landscape 1920 cover-scaled into a portrait box gets
  //   upscaled anyway, so the crop is both smaller and sharper.
  // Non-Cloudinary URLs pass through untouched.
  eleventyConfig.addFilter("mobileBg", function(url, crop) {
    if (!url || url.indexOf("res.cloudinary.com/") === -1 || url.indexOf("/upload/") === -1) return url;
    const mobile = crop === "tall" ? "c_fill,g_auto,ar_3:4,w_828" : "w_828";
    const [base, rest] = url.split("/upload/");
    const parts = rest.split("/");
    // First path segment is a transformation if it isn't a version (v123) and
    // isn't the public id itself (the last segment).
    if (parts.length > 1 && !/^v\d+$/.test(parts[0])) {
      const kept = parts[0].split(",").filter(p => !/^(w|h|c|g|ar)_/.test(p));
      parts[0] = kept.concat(mobile.split(",")).join(",");
    } else {
      parts.unshift("f_auto,q_auto," + mobile);
    }
    return base + "/upload/" + parts.join("/");
  });

  // Ensure a Cloudinary URL has f_auto,q_auto. Frontmatter image URLs are
  // sometimes bare (/upload/<id>), which serves the original file — ~100 KB
  // instead of ~14 KB for the 400x300 service images. URLs that already carry
  // a transformation are left alone.
  eleventyConfig.addFilter("cldAuto", function(url) {
    if (!url || url.indexOf("res.cloudinary.com/") === -1 || url.indexOf("/upload/") === -1) return url;
    const [base, rest] = url.split("/upload/");
    const first = rest.split("/")[0];
    const hasTransform = rest.indexOf("/") !== -1 && !/^v\d+$/.test(first);
    return hasTransform ? url : base + "/upload/f_auto,q_auto/" + rest;
  });

  // Blog collection - all posts in /blog/ folder with tags: blog
  eleventyConfig.addCollection("blog", function(collectionApi) {
    return collectionApi.getFilteredByTag("blog").sort((a, b) => {
      return new Date(b.data.publish_date) - new Date(a.data.publish_date);
    });
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_includes/layouts",
      data: "_data"
    },
    // Removed pathPrefix for Cloudflare Pages (was "/bluerivergutters/" for GitHub Pages)
    templateFormats: ["njk", "md", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};
