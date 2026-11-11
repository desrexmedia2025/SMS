/* =============================================================================
   Public landing page behaviour.

   Deliberately standalone (no dependency on common.js) so the page loads on two
   small files. It does seven things:
     1. applies the theme the visitor already chose inside their dashboard,
     2. reads the school name, motto and contact details from the public
        session endpoint,
     3. opens the mobile menu,
     4. marks the section you are reading in the top bar and fills a scroll
        progress bar,
     5. fades sections in on first scroll, with a small stagger,
     6. stamps the footer year.

   Everything is optional: if an element is missing the step is skipped, and the
   page stays fully usable when the script never runs. Nothing here animates on
   scroll - the page is simply there when you arrive.
   ============================================================================= */

(function initLandingPage() {
  var THEME_KEY = 'sms_theme_pref';
  var DARK_THEMES = ['dark', 'midnight', 'plum'];

  function storedPref() {
    try {
      return String(localStorage.getItem(THEME_KEY) || 'light').toLowerCase();
    } catch (_) {
      return 'light';
    }
  }

  function prefersDark() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (_) {
      return false;
    }
  }

  function isDark(pref) {
    if (pref === 'system') return prefersDark();
    return DARK_THEMES.indexOf(pref) !== -1;
  }

  function setTheme(dark, persist) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
      } catch (_) {
        /* storage unavailable: the choice simply is not remembered */
      }
    }
  }

  // Applied before first paint: the script is loaded with `defer` from the <head>.
  var currentPref = storedPref();
  setTheme(isDark(currentPref), false);
  if (currentPref === 'system') {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        setTheme(Boolean(e.matches), false);
      });
    } catch (_) {
      /* older browsers keep the value they were given */
    }
  }

  var themeBtn = document.getElementById('lp-theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setTheme(!nowDark, true);
    });
  }

  // Mobile menu
  var nav = document.getElementById('lp-nav');
  var menuBtn = document.getElementById('lp-menu-btn');
  if (nav && menuBtn) {
    menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('.lp-nav-links a')) {
        nav.classList.remove('is-open');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Scroll progress bar + shadow on the sticky bar + current section in the nav
  var progress = document.getElementById('lp-progress');
  var links = Array.prototype.slice.call(document.querySelectorAll('.lp-nav-links a[href^="#"]'));
  var sections = links
    .map(function (link) {
      var id = link.getAttribute('href').slice(1);
      var el = document.getElementById(id);
      return el ? { link: link, el: el } : null;
    })
    .filter(Boolean);

  var ticking = false;

  function onScroll() {
    var doc = document.documentElement;
    var scrollable = doc.scrollHeight - window.innerHeight;
    var ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    if (progress) progress.style.width = (ratio * 100).toFixed(2) + '%';
    if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 8);

    if (sections.length) {
      var marker = window.scrollY + window.innerHeight * 0.3;
      var current = null;
      sections.forEach(function (entry) {
        if (entry.el.offsetTop <= marker) current = entry;
      });
      sections.forEach(function (entry) {
        var active = entry === current;
        entry.link.classList.toggle('is-active', active);
        if (active) {
          entry.link.setAttribute('aria-current', 'true');
        } else {
          entry.link.removeAttribute('aria-current');
        }
      });
    }
    ticking = false;
  }

  function requestScrollUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(onScroll);
  }

  window.addEventListener('scroll', requestScrollUpdate, { passive: true });
  window.addEventListener('resize', requestScrollUpdate);
  onScroll();

  // School branding and contact details from the public session endpoint
  function setText(id, value) {
    var el = document.getElementById(id);
    if (el && value) el.textContent = value;
  }

  function setContact(ids, value, href) {
    if (!value) return false;
    var row = document.getElementById(ids.row);
    if (!row) return false;
    var target = document.getElementById(ids.target);
    if (target) {
      target.textContent = value;
      if (href) target.setAttribute('href', href);
    }
    row.classList.remove('hidden');
    return true;
  }

  if (typeof fetch === 'function') {
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data) return;
        var school = data.school || {};
        var name = school.school_name || 'School Management System';
        setText('lp-school-name', name);
        setText('lp-footer-school-name', name);
        setText('lp-copyright-name', name);
        setText('lp-school-motto', school.motto || '');
        document.title = name;
        ['og:site_name', 'og:title', 'twitter:title'].forEach(function (prop) {
          var tag = document.querySelector('meta[property="' + prop + '"], meta[name="' + prop + '"]');
          if (tag) tag.setAttribute('content', name);
        });

        var shown = 0;
        if (setContact({ row: 'lp-contact-email', target: 'lp-contact-email-link' }, school.email, 'mailto:' + school.email)) {
          shown += 1;
        }
        if (setContact({ row: 'lp-contact-phone', target: 'lp-contact-phone-link' }, school.phone, 'tel:' + String(school.phone).replace(/\s+/g, ''))) {
          shown += 1;
        }
        if (setContact({ row: 'lp-contact-address', target: 'lp-contact-address-text' }, school.address, null)) {
          shown += 1;
        }
        if (shown > 0) {
          var block = document.getElementById('lp-contact-block');
          if (block) block.classList.remove('hidden');
        }

        if (data.googleAuthEnabled === false) {
          var foot = document.querySelector('.lp-panel-foot');
          if (foot) foot.textContent = 'Sign in with the school email address and password issued to you.';
        }
        if (data.authenticated && data.redirectTo) {
          window.location.replace(data.redirectTo);
        }
      })
      .catch(function () {
        /* offline or blocked: the page keeps its default wording */
      });
  }

  // Structured data for the questions, built from the words already on the page so
  // the two can never disagree.
  (function addFaqSchema() {
    var pairs = [];
    document.querySelectorAll('.lp-faq details').forEach(function (item) {
      var question = item.querySelector('summary');
      var answer = item.querySelector('.lp-faq-body');
      if (!question || !answer) return;
      var text = answer.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return;
      pairs.push({
        '@type': 'Question',
        name: question.textContent.replace(/\s+/g, ' ').trim(),
        acceptedAnswer: { '@type': 'Answer', text: text }
      });
    });
    if (!pairs.length) return;
    var tag = document.createElement('script');
    tag.type = 'application/ld+json';
    tag.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: pairs });
    document.head.appendChild(tag);
  })();

  setText('lp-year', String(new Date().getFullYear()));
})();
