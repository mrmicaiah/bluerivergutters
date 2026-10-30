// Lead-form settings shared by the contact form and partials/lead-form.njk.
//
// Both forms post to /api/lead (functions/api/lead.js), which accepts leads
// without an email and forwards the email-bearing ones to Courier itself.
// emailRequired: false makes email optional on every form (format-checked only
// when filled). Never set it false on a deploy that lacks /api/lead.
module.exports = {
  emailRequired: false
};
