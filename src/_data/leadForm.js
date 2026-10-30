// Lead-form settings shared by the contact form and partials/lead-form.njk.
//
// emailRequired: true while Courier's /api/subscribe still needs an email on
// every lead. Flip to false ONLY after Micaiah confirms the worker accepts
// email-less leads — the client change must never deploy ahead of the server.
module.exports = {
  emailRequired: true
};
