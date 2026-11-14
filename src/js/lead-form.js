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
 *      (a name needs 2+ characters: a typo gets told, not dropped)
 *   4. message shape (only if a message was given)        -> visible
 *   5. spamReason(): a name that isn't a name, or outreach markers in any
 *      text field (name, message, service, city)          -> silent
 *   6. zip outside the service area                       -> visible
 * Only a submission past all six is sent. A borderline name (isSuspectName:
 * 5+ words or 3+ digits) is still sent; /api/lead tags it [suspect].
 *
 * Clarity instrumentation lives here too, one path for all four forms
 * (homepage, service, city, contact) via BRGLeadGuards.instrument():
 *   form_start_<kind>   once, on the first real interaction with the form
 *   form_submit_<kind>  once, only after /api/lead answers OK — never on a
 *                       silent reject, a visible reject, or a failed send
 * Both also set the Clarity tag  form = <funnel>  (the same string the payload
 * carries), so funnels can be split per form without reading recordings.
 */
(function () {
  // Same-origin Pages Function. It re-checks the timing floor server-side and
  // forwards email-bearing leads to Courier, so the subscriber list is fed as
  // before.
  var LEAD_API = '/api/lead';

  // Bump when the marker list or zip allowlist changes, so a later recount can
  // tell which filter era a lead arrived under.
  var SCAN_VERSION = 3;

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

  // Names that can't be a person's name. The Nov 14 lead was a 140-character
  // sales pitch typed into the name box. Mirrored server-side in /api/lead.
  var MAX_NAME_CHARS = 60;
  var MIN_NAME_CHARS = 2;
  // Keep the TLDs a superset of NAME_URL in functions/api/lead.js: a name the
  // server drops silently must never reach it from here, or Clarity would
  // count a form_submit for spam.
  var NAME_LINK = /https?:|www\.|@|\.(com|net|org|io|co|biz|info|us|xyz|online|site|agency|ai|dev|app|store|tech|digital|studio)\b/i;

  function hasName(name) {
    return String(name || '').trim().length >= MIN_NAME_CHARS;
  }

  // '' when the lead may be sent; otherwise why it is being silently dropped.
  // Fields: name, message, service, city (any may be missing).
  function spamReason(fields) {
    fields = fields || {};
    var name = String(fields.name || '').trim();
    if (name.length > MAX_NAME_CHARS) return 'name too long';
    if (NAME_LINK.test(name)) return 'link or address in name';
    var texts = [name, fields.message, fields.service, fields.city];
    for (var i = 0; i < texts.length; i++) {
      if (looksLikeOutreach(texts[i])) return 'outreach markers';
    }
    return '';
  }

  // Borderline, not blocked: sent as normal, flagged by the server.
  function isSuspectName(name) {
    name = String(name || '').trim();
    return name.split(/\s+/).filter(Boolean).length >= 5 || (name.match(/[0-9]/g) || []).length >= 3;
  }

  function isPhone(phone) {
    return String(phone || '').replace(/\D/g, '').length >= 10;
  }

  function isEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
  }

  // Every Clarity call goes through here. If the tag hasn't defined
  // window.clarity yet, install Clarity's own queue stub — the same
  // clarity.q array its script drains on load — so an early call is held, not
  // dropped. If Clarity is blocked the queue just sits there. Never throws.
  function clarityCall() {
    try {
      if (typeof window.clarity !== 'function') {
        window.clarity = function () {
          (window.clarity.q = window.clarity.q || []).push(arguments);
        };
      }
      window.clarity.apply(window, arguments);
    } catch (err) { /* analytics must never break a form */ }
  }

  // Once per event name per page load: a retry after a visible error, a
  // double-click, or a second success can't double-count.
  var fired = {};
  function fireOnce(eventName, funnel) {
    if (fired[eventName]) return;
    fired[eventName] = true;
    clarityCall('set', 'form', funnel);
    clarityCall('event', eventName);
  }

  // kind:   homepage | service | city | contact   -> form_start_/form_submit_<kind>
  // funnel: the payload's funnel string           -> Clarity tag form=<funnel>
  // Returns { submitted() } — call it on the OK response from /api/lead and
  // nowhere else.
  function instrument(form, kind, funnel) {
    var started = false;
    var START_EVENTS = ['pointerdown', 'keydown', 'input', 'change'];
    function start() {
      if (started) return;
      started = true;
      START_EVENTS.forEach(function (type) { form.removeEventListener(type, start, true); });
      fireOnce('form_start_' + kind, funnel);
    }
    // Real interaction only: a tap or click, a key, typing, or autofill (which
    // fires input/change). Not focusin — a programmatic focus() isn't a person.
    START_EVENTS.forEach(function (type) { form.addEventListener(type, start, true); });
    return {
      submitted: function () {
        start(); // a submit is never reported without its start
        fireOnce('form_submit_' + kind, funnel);
      }
    };
  }

  window.BRGLeadGuards = {
    SCAN_VERSION: SCAN_VERSION,
    LEAD_API: LEAD_API,
    cityForZip: cityForZip,
    inServiceArea: inServiceArea,
    hasSubstantiveMessage: hasSubstantiveMessage,
    looksLikeOutreach: looksLikeOutreach,
    hasName: hasName,
    spamReason: spamReason,
    isSuspectName: isSuspectName,
    MAX_NAME_CHARS: MAX_NAME_CHARS,
    isPhone: isPhone,
    isEmail: isEmail,
    instrument: instrument
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

    var funnel = kind + '-page-form';
    var analytics = instrument(form, kind, funnel);

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

      if (!hasName(name)) return showError('Please tell us your name.', nameField);
      if (!isPhone(phone)) return showError('Please enter a phone number we can reach you at.', phoneField);
      if (!/^[0-9]{5}$/.test(zip)) return showError('Please enter your 5-digit zip code so we know the area.', zipField);
      if (emailRequired && !email) return showError('Please enter your email address.', emailField);
      if (email && !isEmail(email)) return showError('Please enter a valid email address.', emailField);

      // No message box on this form, so guard 4 has nothing to check.
      var spam = spamReason({ name: name, service: form.getAttribute('data-service') || '', city: cityForZip(zip) });
      if (spam) {
        console.warn('Spam screen (' + spam + ') — silent reject');
        showSuccess();
        return;
      }

      if (!inServiceArea(zip)) {
        return showError("Looks like you're outside our North Alabama service area. " +
          'If you think that\'s wrong, call us at (256) 616-6760', zipField);
      }

      var originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';

      var payload = {
        name: name,
        phone: phone,
        zip: zip,
        city: cityForZip(zip),
        email: email,
        message: '',
        service: form.getAttribute('data-service') || '',
        source: 'bluerivergutters.com',
        funnel: funnel,
        time_to_fill_ms: elapsed
      };

      try {
        var resp = await fetch(LEAD_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await resp.json().catch(function () { return {}; });

        if (resp.ok) {
          analytics.submitted();
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
