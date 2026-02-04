module.exports = function(eleventyConfig) {
  // Passthrough copy for static assets - map src/css to /css in output
  eleventyConfig.addPassthroughCopy({"src/css": "css"});
  eleventyConfig.addPassthroughCopy({"src/js": "js"});
  eleventyConfig.addPassthroughCopy({"src/images": "images"});
  
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
    }
    return dateString;
  });

  // ISO date filter for sitemap (YYYY-MM-DD format)
  eleventyConfig.addFilter("isoDate", function(date) {
    if (!date) return "";
    const d = new Date(date);
    return d.toISOString().slice(0, 10);
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
