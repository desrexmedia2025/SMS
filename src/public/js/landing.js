/* =============================================================================
   Public landing page behaviour.

   Deliberately standalone (no dependency on common.js) so the page loads on two
   small files. It does five things:
     1. applies the theme the visitor already chose inside their dashboard,
     2. reads the school name and motto from the public session endpoint,
     3. opens the mobile menu,
     4. fades sections in on first scroll,
     5. stamps the footer year.

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

  // Apply before first paint: the script is loaded with `defer` from the <head>.
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

  // School branding from the public session endpoint
  function setText(id, value) {
    var el = document.getElementById(id);
    if (el && value) el.textContent = value;
  }

  if (typeof fetch === 'function') {
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data) return;
        var name = (data.school && data.school.school_name) || 'School Management System';
        setText('lp-school-name', name);
        setText('lp-footer-school-name', name);
        setText('lp-copyright-name', name);
        setText('lp-school-motto', (data.school && data.school.motto) || '');
        document.title = name;
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

  // Reveal sections as they scroll into view
  var reveals = document.querySelectorAll('.lp-reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('lp-js');
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );
    reveals.forEach(function (el) {
      observer.observe(el);
    });
  }

  setText('lp-year', String(new Date().getFullYear()));
})();
