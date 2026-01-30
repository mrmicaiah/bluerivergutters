module.exports = function(eleventyConfig) {
  // Passthrough copy for static assets - map src/css to /css in output
  eleventyConfig.addPassthroughCopy({"src/css": "css"});
  eleventyConfig.addPassthroughCopy({"src/js": "js"});
  eleventyConfig.addPassthroughCopy({"src/images": "images"});

  // Watch for changes in these directories
  eleventyConfig.addWatchTarget("src/css/");
  eleventyConfig.addWatchTarget("src/js/");

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_includes/layouts",
      data: "_data"
    },
    pathPrefix: "/bluerivergutters/",
    templateFormats: ["njk", "md", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};
