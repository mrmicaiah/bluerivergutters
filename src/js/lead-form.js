/* Lead forms — shared guards + the service/city page lead form.
 *
 * Needs /js/service-area.js loaded first (window.BRG_SERVICE_AREA, generated
 * from src/_data/serviceArea.js). Exposes window.BRGLeadGuards for the contact
 * form, and wires every <form data-form-kind="..."> rendered by
 * partials/lead-form.njk.
 *
 * Guard chain, in order. Silent rejects show a fake success so a bot never
 * learns which rule caught it; visible rejects tell a real customer how to
 * get back in.
 *   1. honeypot field filled          -> silent
 *   2. submitted under 3 seconds      -> silent
 *   3. required fields / formats      -> visible
 *   4. message shape (only if a message was given)        -> visible
 *   5. outreach markers in the message                    -> silent
 *   6. zip outside the service area                       -> visible
 * Only a submission past all six is sent, and only then does the submit
 * event fire.
 */
(function () {
  var COURIER_API = 'https://email-bot-server.micaiah-tasks.workers.dev/api/subscribe';
  var COURIER_LIST = 'blue-river-gutters-leads';

  // Bump when the marker list or zip allowlist changes, so a later recount can
  // tell which filter era a lead arrived under.
  var SCAN_VERSION = 2;

  var AREA = window.BRG_SERVICE_AREA || { prefixes: {}, zips: {} };

  // Conservative on purpose: a homeowner describing a gutter problem never
  // writes any of these. Phrases are matched as substrings.
  var OUTREACH_PHRASES = [
    'search ranking', 'virtual assistant', 'outsourc', 'backlink',
    'guest post', 'web design services', 'digital marketing',
    'lead generation', 'increase your revenue', 'grow your business',
    'marketing agency', 'appointment setter'
  ];

  // Matched as whole words only. 'seo' as a bare substring would fire on any
  // longer word that happens to contain it.
  var OUTREACH_WORDS = ['seo'];

  // 15 of the 18 junk submissions on record put a bare phone number in the
  // message box — no letters at all. Requiring a few real words is the most
  // effective filter the contact form has. Messages are optional now, so this
  // only runs on a message that was actually typed.
  var MIN_MESSAGE_WORDS = 4;

  function cityForZip(zip) {
    zip = String(zip || '');
    if (!/^[0-9]{5}$/.test(zip)) return '';
    if (AREA.zips[zip]) return AREA.zips[zip];
    for (var prefix in AREA.prefixes) {
      if (zip.indexOf(prefix) === 0) return AREA.prefixes[prefix];
    }
    return '';
  }

  function inServiceArea(zip) {
    return cityForZip(zip) !== '';
  }

  function hasSubstantiveMessage(message) {
    var words = String(message || '').trim().split(/\s+/).filter(function (w) {
      return /[A-Za-z]/.test(w);
    });
    return words.length >= MIN_MESSAGE_WORDS;
  }

  function looksLikeOutreach(message) {
    var text = String(message || '').toLowerCase();
    if (!text) return false;
    if (OUTREACH_PHRASES.some(function (phrase) { return text.indexOf(phrase) !== -1; })) return true;
    return OUTREACH_WORDS.some(function (word) {
      return new RegExp('\\b' + word + '\\b').test(text);
    });
  }

  function isPhone(phone) {
    return String(phone || '').replace(/\D/g, '').length >= 10;
  }

  function isEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
  }

  function track(name) {
    window.brgTrack && window.brgTrack(name);
  }

  window.BRGLeadGuards = {
    SCAN_VERSION: SCAN_VERSION,
    COURIER_API: COURIER_API,
    COURIER_LIST: COURIER_LIST,
    cityForZip: cityForZip,
    inServiceArea: inServiceArea,
    hasSubstantiveMessage: hasSubstantiveMessage,
    looksLikeOutreach: looksLikeOutreach,
    isPhone: isPhone,
    isEmail: isEmail
  };

  // Shows the detected city next to the zip field, and keeps the hidden city
  // input in step. Used by the contact form too.
  window.BRGLeadGuards.bindZipCity = function (zipInput, cityInput, hintEl) {
    if (!zipInput) return;
    function update() {
      var zip = zipInput.value.trim();
      var city = cityForZip(zip);
      if (cityInput) cityInput.value = city;
      if (!hintEl) return;
      if (city) hintEl.textContent = city + ' area';
      else if (/^[0-9]{5}$/.test(zip)) hintEl.textContent = 'Outside our usual area';
      else hintEl.textContent = '';
    }
    zipInput.addEventListener('input', update);
    update();
  };

  function wire(form) {
    var kind = form.getAttribute('data-form-kind');
    var card = form.closest('.lead-form-card');
    var errorEl = form.querySelector('.lead-form-error');
    var submitBtn = form.querySelector('button[type="submit"]');
    var emailRequired = form.getAttribute('data-email-required') === 'true';
    var loadTime = Date.now();

    form.addEventListener('focusin', function () { track('form_start_' + kind); }, { once: true });

    window.BRGLeadGuards.bindZipCity(
      form.querySelector('[name="zip"]'),
      form.querySelector('[name="city"]'),
      form.querySelector('.lead-form-zip-city')
    );

    function showError(msg, field) {
      errorEl.textContent = msg;
      errorEl.classList.add('active');
      if (field) field.focus();
    }

    function showSuccess() {
      card.querySelector('.lead-form-view').hidden = true;
      card.querySelector('.lead-form-success').hidden = false;
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errorEl.classList.remove('active');

      if (form.querySelector('[name="website"]').value) {
        console.warn('Honeypot triggered — silent reject');
        showSuccess();
        return;
      }

      var elapsed = Date.now() - loadTime;
      if (elapsed < 3000) {
        console.warn('Form filled too fast (' + elapsed + 'ms) — silent reject');
        showSuccess();
        return;
      }

      var nameField = form.querySelector('[name="name"]');
      var phoneField = form.querySelector('[name="phone"]');
      var zipField = form.querySelector('[name="zip"]');
      var emailField = form.querySelector('[name="email"]');
      var name = nameField.value.trim();
      var phone = phoneField.value.trim();
      var zip = zipField.value.trim();
      var email = emailField ? emailField.value.trim() : '';

      if (!name) return showError('Please tell us your name.', nameField);
      if (!isPhone(phone)) return showError('Please enter a phone number we can reach you at.', phoneField);
      if (!/^[0-9]{5}$/.test(zip)) return showError('Please enter your 5-digit zip code so we know the area.', zipField);
      if (emailRequired && !email) return showError('Please enter your email address.', emailField);
      if (email && !isEmail(email)) return showError('Please enter a valid email address.', emailField);

      // No message box on this form, so guards 4 and 5 have nothing to check.

      if (!inServiceArea(zip)) {
        return showError("Looks like you're outside our North Alabama service area. " +
          'If you think that\'s wrong, call us at (256) 616-6760', zipField);
      }

      var originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';

      var payload = {
        name: name,
        list: COURIER_LIST,
        source: 'bluerivergutters.com',
        funnel: kind + '-page-form',
        metadata: {
          phone: phone,
          zip: zip,
          city: cityForZip(zip),
          service: form.getAttribute('data-service') || 'not specified',
          page: window.location.pathname,
          time_to_fill_ms: elapsed,
          scan_version: SCAN_VERSION
        }
      };
      if (email) payload.email = email;

      // Past every guard — the genuine send, and the only branch that fires the
      // submit event. Fired before the request so it can't be lost to a slow
      // or failed fetch.
      track('form_submit_' + kind);

      try {
        var resp = await fetch(COURIER_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await resp.json().catch(function () { return {}; });

        if (resp.ok) {
          if (typeof gtag === 'function') {
            gtag('event', 'generate_lead', {
              event_category: 'engagement',
              event_label: kind + '_page_form',
              value: 1
            });
          }
          showSuccess();
          return;
        }
        showError(data.error || 'Something went wrong. Please call us at (256) 616-6760.');
      } catch (err) {
        showError('Connection issue. Please call us at (256) 616-6760.');
      }
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    });
  }

  function init() {
    document.querySelectorAll('form[data-form-kind]').forEach(wire);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
