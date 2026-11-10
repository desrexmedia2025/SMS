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
   page stays fully usable when the script never runs.
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

  // Reveal sections as they scroll into view, with a small stagger inside each grid
  var reveals = document.querySelectorAll('.lp-reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('lp-js');
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );

    var seenGroups = new Map();
    Array.prototype.forEach.call(reveals, function (el) {
      var parent = el.parentElement;
      var index = seenGroups.get(parent) || 0;
      seenGroups.set(parent, index + 1);
      if (index > 0 && index < 8) {
        el.style.transitionDelay = Math.min(index * 60, 360) + 'ms';
      }
      observer.observe(el);
    });
  }

  setText('lp-year', String(new Date().getFullYear()));
})();
