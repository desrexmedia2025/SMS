// Hardened DOM, HTTP, CSRF, Session Carrier, Theme, Multi-Language, Terms Gate, Currency, Paystack Checkout & CSV utilities for SMS
window.SMS = (() => {
  const SESSION_STORAGE_KEY = 'sms_session_token';
  const THEME_STORAGE_KEY = 'sms_theme_pref';
  const LANG_STORAGE_KEY = 'sms_lang_pref';
  let csrfToken = '';
  let sessionToken = '';
  let currencySymbol = 'GH₵';
  let currencyCode = 'GHS';
  let currentUser = null;
  let googleAuthEnabled = false;
  let googleAuthMode = 'sandbox';
  let activeThemePref = 'light';
  let activeLangPref = 'en';

  const I18N_DICTIONARY = {
    fr: {
      'Overview': 'Aperçu',
      'Site Analytics': 'Analytique du site',
      'Classes & Subjects': 'Classes et matières',
      'Register Teacher': 'Inscrire un enseignant',
      'Teachers List': 'Liste des enseignants',
      'Assign Class & Subject': 'Affecter classe et matière',
      'Students': 'Élèves',
      'Timetable': 'Emploi du temps',
      'Finance & Paystack': 'Finances et Paystack',
      'Staff Accounts': 'Comptes du personnel',
      'Announcements': 'Annonces',
      'Settings': 'Paramètres',
      'Classwork, Homework, Tests & Exams': 'Devoirs, contrôles et examens',
      'My Classes & Students': 'Mes classes et élèves',
      'Profile': 'Profil',
      'My Scores': 'Mes notes',
      'Fees & Paystack': 'Frais et Paystack',
      'Fees & Billing': 'Frais et facturation',
      'Payments & Receipts': 'Paiements et reçus',
      'Student Balances': 'Soldes des élèves',
      'Sign Out': 'Déconnexion',
      'Hide Menu': 'Masquer le menu',
      'Show Menu': 'Afficher le menu',
      'Menu': 'Menu',
      'Search': 'Rechercher',
      'Clear': 'Effacer',
      'Refresh': 'Actualiser',
      'Print': 'Imprimer',
      'Close': 'Fermer',
      'Shortcuts': 'Raccourcis',
      'Currency': 'Devise',
      'School Currency': 'Devise scolaire',
      'Theme': 'Thème',
      'Language': 'Langue',
      'Terms & Conditions': 'Conditions générales',
      'Academics': 'Scolarité',
      'Administration': 'Administration',
      'Save Settings': 'Enregistrer les paramètres',
      'Search sections or records...': 'Rechercher une section ou un dossier...',
    },
    es: {
      'Overview': 'Resumen',
      'Site Analytics': 'Analítica del sitio',
      'Classes & Subjects': 'Clases y materias',
      'Register Teacher': 'Registrar docente',
      'Teachers List': 'Lista de docentes',
      'Assign Class & Subject': 'Asignar clase y materia',
      'Students': 'Estudiantes',
      'Timetable': 'Horario',
      'Finance & Paystack': 'Finanzas y Paystack',
      'Staff Accounts': 'Cuentas del personal',
      'Announcements': 'Anuncios',
      'Settings': 'Configuración',
      'Classwork, Homework, Tests & Exams': 'Tareas, pruebas y exámenes',
      'My Classes & Students': 'Mis clases y estudiantes',
      'Profile': 'Perfil',
      'My Scores': 'Mis calificaciones',
      'Fees & Paystack': 'Tasas y Paystack',
      'Fees & Billing': 'Tasas y facturación',
      'Payments & Receipts': 'Pagos y recibos',
      'Student Balances': 'Saldos estudiantiles',
      'Sign Out': 'Cerrar sesión',
      'Hide Menu': 'Ocultar menú',
      'Show Menu': 'Mostrar menú',
      'Menu': 'Menú',
      'Search': 'Buscar',
      'Clear': 'Limpiar',
      'Refresh': 'Actualizar',
      'Print': 'Imprimir',
      'Close': 'Cerrar',
      'Shortcuts': 'Accesos rápidos',
      'Currency': 'Moneda',
      'School Currency': 'Moneda escolar',
      'Theme': 'Tema',
      'Language': 'Idioma',
      'Terms & Conditions': 'Términos y condiciones',
      'Academics': 'Académico',
      'Administration': 'Administración',
      'Save Settings': 'Guardar configuración',
      'Search sections or records...': 'Buscar secciones o registros...',
    },
    pt: {
      'Overview': 'Visão geral',
      'Site Analytics': 'Análise do site',
      'Classes & Subjects': 'Turmas e disciplinas',
      'Register Teacher': 'Registar professor',
      'Teachers List': 'Lista de professores',
      'Assign Class & Subject': 'Atribuir turma e disciplina',
      'Students': 'Estudantes',
      'Timetable': 'Horário',
      'Finance & Paystack': 'Finanças e Paystack',
      'Staff Accounts': 'Contas da equipa',
      'Announcements': 'Comunicados',
      'Settings': 'Definições',
      'Classwork, Homework, Tests & Exams': 'Trabalhos, testes e exames',
      'My Classes & Students': 'Minhas turmas e alunos',
      'Profile': 'Perfil',
      'My Scores': 'Minhas notas',
      'Fees & Paystack': 'Propinas e Paystack',
      'Fees & Billing': 'Propinas e faturação',
      'Payments & Receipts': 'Pagamentos e recibos',
      'Student Balances': 'Saldos dos alunos',
      'Sign Out': 'Terminar sessão',
      'Hide Menu': 'Ocultar menu',
      'Show Menu': 'Mostrar menu',
      'Menu': 'Menu',
      'Search': 'Pesquisar',
      'Clear': 'Limpar',
      'Refresh': 'Atualizar',
      'Print': 'Imprimir',
      'Close': 'Fechar',
      'Shortcuts': 'Atalhos',
      'Currency': 'Moeda',
      'School Currency': 'Moeda escolar',
      'Theme': 'Tema',
      'Language': 'Idioma',
      'Terms & Conditions': 'Termos e condições',
      'Academics': 'Académico',
      'Administration': 'Administração',
      'Save Settings': 'Guardar definições',
      'Search sections or records...': 'Pesquisar secções ou registos...',
    },
    tw: {
      'Overview': 'Nsɛm Titiriw',
      'Site Analytics': ' Dwumadi Akontaabu',
      'Classes & Subjects': 'Adesuakuw ne Adesua',
      'Register Teacher': 'Kyerɛw Ɔkyerɛkyerɛfo',
      'Teachers List': 'Akyerɛkyerɛfo Din',
      'Assign Class & Subject': 'Kyɛ Adesuakuw ne Adesua',
      'Students': 'Adesuafo',
      'Timetable': 'Berɛ Nhyehyɛe',
      'Finance & Paystack': 'Sikasɛm ne Paystack',
      'Staff Accounts': 'Adwumayɛfo Akonta',
      'Announcements': 'Nkaebɔ',
      'Settings': 'Nhyehyɛe',
      'Classwork, Homework, Tests & Exams': 'Adesua Dwuma ne Nsɔhwɛ',
      'My Classes & Students': 'Me Adesuakuw ne Adesuafo',
      'Profile': 'Me Ho Nsɛm',
      'My Scores': 'Me Nkontaabu',
      'Fees & Paystack': 'Sukuu Ka ne Paystack',
      'Fees & Billing': 'Sukuu Ka Nhyehyɛe',
      'Payments & Receipts': 'Tua ne Risiti',
      'Student Balances': 'Adesuafo Sika Ka',
      'Sign Out': 'Pue',
      'Hide Menu': 'Fa Menu Sie',
      'Show Menu': 'Kyerɛ Menu',
      'Menu': 'Menu',
      'Search': 'Hwehwɛ',
      'Clear': 'Pepa',
      'Refresh': 'San Yi',
      'Print': 'Tintim',
      'Close': 'To Mu',
      'Shortcuts': ' Kwan Tiawa',
      'Currency': 'Sika Su',
      'School Currency': 'Sukuu Sika Su',
      'Theme': 'Ahosu',
      'Language': 'Kasa',
      'Terms & Conditions': 'Mmara ne Nhyehyɛe',
      'Academics': 'Adesua',
      'Administration': 'Ntotoe',
      'Save Settings': 'Kora Nhyehyɛe',
      'Search sections or records...': 'Hwehwɛ biribi wɔ ha...',
    },
    ar: {
      'Overview': 'نظرة عامة',
      'Site Analytics': 'تحليلات الموقع',
      'Classes & Subjects': 'الفصول والمواد',
      'Register Teacher': 'تسجيل معلم',
      'Teachers List': 'قائمة المعلمين',
      'Assign Class & Subject': 'تعيين فصل ومادة',
      'Students': 'الطلاب',
      'Timetable': 'الجدول الدراسي',
      'Finance & Paystack': 'المالية و Paystack',
      'Staff Accounts': 'حسابات الموظفين',
      'Announcements': 'الإعلانات',
      'Settings': 'الإعدادات',
      'Classwork, Homework, Tests & Exams': 'الواجبات والاختبارات والامتحانات',
      'My Classes & Students': 'فصولي وطلابي',
      'Profile': 'الملف الشخصي',
      'My Scores': 'درجاتي',
      'Fees & Paystack': 'الرسوم و Paystack',
      'Fees & Billing': 'الرسوم والفواتير',
      'Payments & Receipts': 'المدفوعات والإيصالات',
      'Student Balances': 'أرصدة الطلاب',
      'Sign Out': 'تسجيل الخروج',
      'Hide Menu': 'إخفاء القائمة',
      'Show Menu': 'إظهار القائمة',
      'Menu': 'القائمة',
      'Search': 'بحث',
      'Clear': 'مسح',
      'Refresh': 'تحديث',
      'Print': 'طباعة',
      'Close': 'إغلاق',
      'Shortcuts': 'اختصارات',
      'Currency': 'العملة',
      'School Currency': 'عملة المدرسة',
      'Theme': 'المظهر',
      'Language': 'اللغة',
      'Terms & Conditions': 'الشروط والأحكام',
      'Academics': 'الشؤون الأكاديمية',
      'Administration': 'الإدارة',
      'Save Settings': 'حفظ الإعدادات',
      'Search sections or records...': 'ابحث في الأقسام أو السجلات...',
    },
  };

  function resolveEffectiveTheme(pref) {
    const clean = String(pref || 'light').toLowerCase();
    if (clean === 'system') {
      try {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
      } catch (_) {
        return 'light';
      }
    }
    if (['light', 'dark', 'ocean'].includes(clean)) return clean;
    return 'light';
  }

  function applyTheme(pref, { persistLocal = true } = {}) {
    const normalized = ['light', 'dark', 'ocean', 'system'].includes(String(pref || '').toLowerCase())
      ? String(pref).toLowerCase()
      : 'light';
    activeThemePref = normalized;
    const effective = resolveEffectiveTheme(normalized);
    document.documentElement.setAttribute('data-theme', effective);
    document.documentElement.setAttribute('data-theme-pref', normalized);
    if (persistLocal) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, normalized);
      } catch (_) {
        // ignore storage errors
      }
    }
    const sbTheme = document.getElementById('sb-theme-select');
    if (sbTheme && sbTheme.value !== normalized) sbTheme.value = normalized;
  }

  function translateText(str, lang) {
    const cleanKey = String(str || '').trim();
    if (!cleanKey || lang === 'en') return cleanKey;
    const dict = I18N_DICTIONARY[lang];
    return (dict && dict[cleanKey]?.trim()) || cleanKey;
  }

  function applyLanguage(lang, { persistLocal = true } = {}) {
    const normalized = ['en', 'fr', 'es', 'pt', 'tw', 'ar'].includes(String(lang || '').toLowerCase())
      ? String(lang).toLowerCase()
      : 'en';
    activeLangPref = normalized;
    document.documentElement.setAttribute('lang', normalized);
    document.documentElement.setAttribute('dir', normalized === 'ar' ? 'rtl' : 'ltr');

    if (persistLocal) {
      try {
        localStorage.setItem(LANG_STORAGE_KEY, normalized);
      } catch (_) {
        // ignore storage errors
      }
    }

    const sbLang = document.getElementById('sb-lang-select');
    if (sbLang && sbLang.value !== normalized) sbLang.value = normalized;

    const selectors = [
      '.nav-item-label',
      '.nav-btn',
      '.nav-section-label',
      '.topbar-title',
      '.card-title',
      '.sidebar-control-label',
      '.sidebar-logout-btn',
      '.sidebar-terms-btn',
      '.menu-btn-text',
      'button[data-search-btn]',
      'button[data-search-clear]',
      '#topbar-search-btn',
      '#topbar-search-clear-btn',
      '#stu-filter-btn',
      '#acc-filter-btn',
      '#tch-search-btn',
      '#usr-search-btn',
    ];

    document.querySelectorAll(selectors.join(',')).forEach((el) => {
      if (el.children.length > 0) return;
      if (el.dataset.i18nOrig === undefined) {
        el.dataset.i18nOrig = el.textContent.trim();
      }
      const orig = el.dataset.i18nOrig;
      if (!orig) return;
      el.textContent = normalized === 'en' ? orig : translateText(orig, normalized);
    });

    document.querySelectorAll('input[placeholder]').forEach((inp) => {
      if (inp.dataset.i18nPhOrig === undefined) {
        inp.dataset.i18nPhOrig = inp.getAttribute('placeholder') || '';
      }
      const orig = inp.dataset.i18nPhOrig;
      if (!orig) return;
      inp.setAttribute('placeholder', normalized === 'en' ? orig : translateText(orig, normalized));
    });

    try {
      window.dispatchEvent(new CustomEvent('sms:languagechange', { detail: { lang: normalized } }));
    } catch (_) {
      // ignore
    }
  }

  // Bootstrap saved theme & language before first paint to prevent flash
  (() => {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme) applyTheme(savedTheme, { persistLocal: false });
      const savedLang = localStorage.getItem(LANG_STORAGE_KEY);
      if (savedLang && savedLang !== 'en') {
        document.documentElement.setAttribute('lang', savedLang);
        document.documentElement.setAttribute('dir', savedLang === 'ar' ? 'rtl' : 'ltr');
        activeLangPref = savedLang;
      }
    } catch (_) {
      // ignore storage errors
    }
  })();

  function setSessionToken(tok) {
    sessionToken = String(tok || '').trim();
    try {
      if (sessionToken) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
      } else {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch (_) {
      // ignore storage errors
    }
  }

  function getSessionToken() {
    if (sessionToken) return sessionToken;
    try {
      sessionToken = String(sessionStorage.getItem(SESSION_STORAGE_KEY) || '').trim();
    } catch (_) {
      sessionToken = '';
    }
    return sessionToken;
  }

  function withNavSession(targetUrl, tokenOverride) {
    const urlStr = String(targetUrl || '/');
    if (!urlStr.startsWith('/') || urlStr.startsWith('//')) return urlStr;
    const tok = String(tokenOverride || getSessionToken() || '').trim();
    if (!tok) return urlStr;
    const u = new URL(urlStr, window.location.origin);
    u.searchParams.set('_st', tok);
    return `${u.pathname}${u.search}${u.hash}`;
  }

  function navigateAuthenticated(targetUrl, tokenOverride) {
    if (tokenOverride) setSessionToken(tokenOverride);
    window.location.replace(withNavSession(targetUrl, tokenOverride));
  }

  // Bootstrap fallback session token from URL on navigation & strip immediately from address bar
  (() => {
    try {
      const u = new URL(window.location.href);
      const navTok = u.searchParams.get('_st');
      if (navTok) {
        setSessionToken(navTok);
        u.searchParams.delete('_st');
        window.history.replaceState({}, '', `${u.pathname}${u.search}${u.hash}`);
      } else {
        getSessionToken();
      }
    } catch (_) {
      // ignore
    }
  })();

  function esc(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(amount, symOverride) {
    const sym = symOverride || currencySymbol || 'GH₵';
    const num = Number(amount || 0);
    const formatted = `${esc(sym)} ${num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    return `<span class="sensitive-figure">${formatted}</span>`;
  }

  function moneyPlain(amount, symOverride) {
    const sym = symOverride || currencySymbol || 'GH₵';
    const num = Number(amount || 0);
    return `${sym} ${num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function setCurrency(code, symbol) {
    if (code) currencyCode = code;
    if (symbol) currencySymbol = symbol;
    const sbCur = document.getElementById('sb-currency-display');
    if (sbCur) {
      sbCur.textContent = `${currencyCode} (${currencySymbol})`;
    }
  }

  function getCurrency() {
    return { code: currencyCode, symbol: currencySymbol };
  }

  function toast(message, type = 'info') {
    let box = document.getElementById('toast-container');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-container';
      box.className = 'toast-container';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function api(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = {
      Accept: 'application/json',
      ...(options.headers || {}),
    };
    const activeSessionTok = getSessionToken();
    if (activeSessionTok) {
      headers['X-SMS-Session'] = activeSessionTok;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const res = await fetch(url, {
      ...options,
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));
    if (data && data.sessionToken) {
      setSessionToken(data.sessionToken);
    }
    if (data && data.csrfToken) {
      csrfToken = data.csrfToken;
    }

    if (res.status === 401 && window.location.pathname.startsWith('/dashboard/')) {
      setSessionToken('');
      window.location.href = '/login?error=session_expired';
      throw new Error('Session expired. Redirecting to sign in...');
    }

    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  async function initSession() {
    const sess = await api('/api/auth/session');
    csrfToken = sess.csrfToken || '';
    currentUser = sess.user || null;
    googleAuthEnabled = Boolean(sess.googleAuthEnabled);
    googleAuthMode = String(sess.googleAuthMode || 'sandbox');
    if (sess.school) {
      setCurrency(sess.school.currency_code, sess.school.currency_symbol);
    }
    if (sess.user) {
      const userTheme = sess.user.themePreference;
      const userLang = sess.user.languagePreference;
      let storedTheme = '';
      let storedLang = '';
      try {
        storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || '';
        storedLang = localStorage.getItem(LANG_STORAGE_KEY) || '';
      } catch (_) {
        // ignore
      }
      applyTheme(storedTheme || userTheme || 'light', { persistLocal: true });
      applyLanguage(storedLang || userLang || 'en', { persistLocal: true });
    } else {
      applyTheme(activeThemePref, { persistLocal: false });
      applyLanguage(activeLangPref, { persistLocal: false });
    }
    try {
      sessionStorage.removeItem('sms_privacy_masked');
      document.body?.classList.remove('privacy-masked');
    } catch (_) {
      // ignore storage errors
    }
    enhancePasswordInputs();
    installBackButtonGuard();
    if (window.location.pathname.startsWith('/dashboard/') && sess.authenticated && sess.user) {
      ensureFirstVisitTermsGate(sess.user);
    }
    return sess;
  }

  function buildTermsClausesHtml() {
    return `
      <div class="terms-clause">
        <h4>1. Portal Access &amp; Role Responsibility</h4>
        <p>Your School Management System credentials are strictly personal. You are responsible for all actions taken under your session across Superadmin, Teacher, Student, or Financial workspaces.</p>
      </div>
      <div class="terms-clause">
        <h4>2. Academic Honesty &amp; Coursework Conduct</h4>
        <p>Submitted classwork, homework, tests, exams, grades, and uploaded documents/media must be authentic, accurate, and compliant with school academic standards.</p>
      </div>
      <div class="terms-clause">
        <h4>3. Student &amp; Staff Data Confidentiality</h4>
        <p>Personal records, admission details, contact numbers, grades, and financial balances are confidential school records and may not be shared with unauthorized third parties.</p>
      </div>
      <div class="terms-clause">
        <h4>4. Fee Billing, Paystack Payments &amp; Receipts</h4>
        <p>All online payments, outbound transfers, and reversals processed through Paystack are logged with official receipt numbers and audit trails. Fraudulent or disputed chargebacks are subject to administrative review.</p>
      </div>
      <div class="terms-clause">
        <h4>5. Acceptable Portal Use &amp; Security</h4>
        <p>Users must not attempt unauthorized access, session tampering, or uploading harmful content. School Administration reserves the right to suspend accounts that violate portal policy.</p>
      </div>
    `;
  }

  function openTermsModal({ mandatory = false, user = null } = {}) {
    let backdrop = document.getElementById('sms-terms-gate-modal');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'sms-terms-gate-modal';
      backdrop.className = 'terms-modal-backdrop';
      document.body.appendChild(backdrop);
    }

    const acceptedDate = user?.termsAcceptedAt
      ? String(user.termsAcceptedAt).slice(0, 16)
      : '';

    backdrop.innerHTML = `
      <div class="terms-modal-card" role="dialog" aria-modal="true" aria-labelledby="sms-terms-modal-title">
        <div class="terms-modal-head">
          <h2 class="terms-modal-title" id="sms-terms-modal-title">${
            mandatory ? 'Welcome — Review &amp; Accept Terms &amp; Conditions' : 'Terms &amp; Conditions'
          }</h2>
          <div class="terms-modal-sub">${
            mandatory
              ? 'First-time dashboard visit: please read and accept the School Management System Terms &amp; Conditions to continue.'
              : acceptedDate
              ? `Version 2026.1 — Accepted on ${esc(acceptedDate)}`
              : 'School Management System — Acceptable Use, Privacy &amp; Portal Policy (v2026.1)'
          }</div>
        </div>
        <div class="terms-scroll-body">
          ${buildTermsClausesHtml()}
        </div>
        <div class="terms-modal-foot">
          ${
            mandatory
              ? `
                <label class="terms-modal-check" for="sms-terms-gate-checkbox">
                  <input type="checkbox" id="sms-terms-gate-checkbox">
                  <span>I have read, understood, and agree to the Terms &amp; Conditions.</span>
                </label>
                <div class="terms-modal-actions">
                  <button type="button" class="btn btn-secondary btn-sm" id="sms-terms-decline-btn">Sign Out</button>
                  <button type="button" class="btn btn-primary btn-sm" id="sms-terms-accept-btn" disabled>Accept &amp; Continue</button>
                </div>
              `
              : `
                <div class="terms-modal-actions">
                  <button type="button" class="btn btn-primary btn-sm" id="sms-terms-close-btn">Close</button>
                </div>
              `
          }
        </div>
      </div>
    `;

    backdrop.classList.add('open');

    if (mandatory) {
      const chk = document.getElementById('sms-terms-gate-checkbox');
      const acceptBtn = document.getElementById('sms-terms-accept-btn');
      const declineBtn = document.getElementById('sms-terms-decline-btn');

      chk?.addEventListener('change', () => {
        if (acceptBtn) acceptBtn.disabled = !chk.checked;
      });

      acceptBtn?.addEventListener('click', async () => {
        if (!chk?.checked) return;
        acceptBtn.disabled = true;
        acceptBtn.textContent = 'Saving...';
        try {
          const res = await api('/api/auth/terms/accept', {
            method: 'POST',
            body: { accept: true },
          });
          if (res.user) currentUser = res.user;
          backdrop.classList.remove('open');
          toast('Terms & Conditions accepted. Welcome to your dashboard.', 'success');
        } catch (err) {
          toast(err.message, 'error');
          acceptBtn.disabled = false;
          acceptBtn.textContent = 'Accept & Continue';
        }
      });

      declineBtn?.addEventListener('click', () => {
        logout();
      });
    } else {
      const closeBtn = document.getElementById('sms-terms-close-btn');
      closeBtn?.addEventListener('click', () => backdrop.classList.remove('open'));
      backdrop.onclick = (e) => {
        if (e.target === backdrop) backdrop.classList.remove('open');
      };
    }
  }

  function ensureFirstVisitTermsGate(user) {
    if (!user || user.termsAccepted) return;
    openTermsModal({ mandatory: true, user });
  }

  function installBackButtonGuard() {
    if (!window.location.pathname.startsWith('/dashboard/')) return;
    window.addEventListener('pageshow', async (event) => {
      if (event.persisted) {
        try {
          const check = await api('/api/auth/session');
          if (!check.authenticated) {
            window.location.replace('/login');
          }
        } catch (_) {
          window.location.replace('/login');
        }
      }
    });
  }

  function enhancePasswordInputs(root = document) {
    root.querySelectorAll('input[type="password"]').forEach((inp) => {
      if (inp.dataset.pwEnhanced === '1') return;
      inp.dataset.pwEnhanced = '1';
      inp.setAttribute('spellcheck', 'false');
      inp.setAttribute('autocapitalize', 'off');

      const wrap = document.createElement('div');
      wrap.className = 'password-field-wrap';
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pw-toggle-btn';
      toggle.textContent = 'Show';
      toggle.setAttribute('aria-label', 'Toggle password visibility');
      toggle.addEventListener('click', () => {
        const showing = inp.type === 'text';
        inp.type = showing ? 'password' : 'text';
        toggle.textContent = showing ? 'Show' : 'Hide';
      });
      wrap.appendChild(toggle);
    });
  }

  window.addEventListener('message', async (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.type === 'SMS_GOOGLE_AUTH_DONE') {
      const targetUrl = String(event.data.targetUrl || '/login');
      const handoffToken = String(event.data.handoffToken || '').trim();

      if (handoffToken) {
        try {
          const res = await fetch('/api/auth/google/handoff', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ handoffToken }),
          });
          const data = await res.json();
          if (data && data.ok && data.redirectTo) {
            navigateAuthenticated(data.redirectTo, data.sessionToken);
            return;
          }
        } catch (_) {
          // Fall back to targetUrl below
        }
      }

      if (targetUrl.startsWith('/') && !targetUrl.startsWith('//')) {
        navigateAuthenticated(targetUrl);
      }
    }
  });

  function startGoogleAuth(baseUrl = '/auth/google') {
    const resolvedBaseUrl = baseUrl.includes('mode=link') ? withNavSession(baseUrl) : baseUrl;
    const inIframe = (() => {
      try {
        return window.self !== window.top;
      } catch (_) {
        return true;
      }
    })();

    // Only open a top-level popup when redirecting to external accounts.google.com (which sends X-Frame-Options: DENY).
    // In interactive sandbox mode, navigate directly inside the current frame so there is zero cross-window split.
    if (inIframe && googleAuthMode === 'live') {
      const sep = resolvedBaseUrl.includes('?') ? '&' : '?';
      const popupUrl = `${resolvedBaseUrl}${sep}popup=1`;
      const w = 520;
      const h = 640;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
      const popup = window.open(
        popupUrl,
        'sms_google_oauth',
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );
      if (popup) {
        popup.focus();
        return;
      }
    }
    window.location.href = resolvedBaseUrl;
  }

  function configureGoogleLinkButton(btnId = 'google-link-btn') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('linked') === 'google') {
      toast('Google Sign-In linked to your account.', 'success');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('oauth_error')) {
      const reason = params.get('oauth_error');
      const msg =
        reason === 'google_already_linked'
          ? 'That Google account is already linked to another school user.'
          : 'Could not link Google account.';
      toast(msg, 'error');
      window.history.replaceState({}, '', window.location.pathname);
    }

    const gBtn = document.getElementById(btnId);
    if (!gBtn) return;

    if (currentUser && currentUser.googleLinked) {
      gBtn.classList.remove('hidden');
      gBtn.textContent = 'Google Linked';
      gBtn.href = '#';
      gBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!confirm('Unlink Google Sign-In from your school account?')) return;
        try {
          await api('/api/auth/google/unlink', { method: 'POST' });
          toast('Google Sign-In unlinked.', 'success');
          navigateAuthenticated(window.location.pathname);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      return;
    }

    if (!googleAuthEnabled) {
      gBtn.classList.add('hidden');
    } else {
      gBtn.classList.remove('hidden');
      gBtn.addEventListener('click', (e) => {
        e.preventDefault();
        startGoogleAuth('/auth/google?mode=link');
      });
    }
  }

  function initPrivacyToggle(btnId = 'privacy-toggle-btn') {
    const btn = document.getElementById(btnId);
    const saved = sessionStorage.getItem('sms_privacy_masked') === '1';
    if (saved) {
      document.body.classList.add('privacy-masked');
    }
    if (!btn) return;
    const syncLabel = () => {
      const masked = document.body.classList.contains('privacy-masked');
      btn.textContent = masked ? 'Show Figures' : 'Hide Figures';
    };
    syncLabel();
    btn.addEventListener('click', () => {
      document.body.classList.toggle('privacy-masked');
      const masked = document.body.classList.contains('privacy-masked');
      sessionStorage.setItem('sms_privacy_masked', masked ? '1' : '0');
      syncLabel();
    });
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (_) {
      // proceed to login regardless
    }
    setSessionToken('');
    try {
      sessionStorage.clear();
    } catch (_) {
      // ignore
    }
    window.location.replace('/login');
  }

  function syncSidebarToggleLabel() {
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!mobileBtn || !sidebar) return;

    const isMobile = window.innerWidth <= 900;
    const isVisible = isMobile
      ? sidebar.classList.contains('open')
      : !document.body.classList.contains('sidebar-collapsed');

    if (backdrop) {
      backdrop.classList.toggle('open', isMobile && isVisible);
    }

    const labelSpan = mobileBtn.querySelector('.menu-btn-text');
    const labelText = isVisible ? 'Hide Menu' : 'Show Menu';
    if (labelSpan) {
      labelSpan.dataset.i18nOrig = labelText;
      labelSpan.textContent = translateText(labelText, activeLangPref);
    } else {
      mobileBtn.textContent = translateText(labelText, activeLangPref);
    }
    mobileBtn.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
    mobileBtn.setAttribute('title', isVisible ? 'Hide sidebar menu' : 'Show sidebar menu');
  }

  function activateSection(sec, onSectionChange) {
    const navBtns = document.querySelectorAll('.nav-btn[data-section]');
    const sidebar = document.getElementById('sidebar');
    navBtns.forEach((b) => b.classList.toggle('active', b.dataset.section === sec));
    const activeBtn = document.querySelector(`.nav-btn[data-section="${sec}"]`);
    const titleEl = document.getElementById('topbar-title');
    const subtitleEl = document.getElementById('topbar-subtitle');
    if (titleEl && activeBtn) {
      const labelEl = activeBtn.querySelector('.nav-item-label');
      const rawTitle =
        activeBtn.dataset.title ||
        labelEl?.dataset.i18nOrig ||
        activeBtn.dataset.i18nOrig ||
        (labelEl ? labelEl.textContent.trim() : activeBtn.textContent.trim());
      titleEl.dataset.i18nOrig = rawTitle;
      titleEl.textContent = translateText(rawTitle, activeLangPref);
    }
    if (subtitleEl && activeBtn) {
      subtitleEl.textContent = activeBtn.dataset.subtitle || '';
      subtitleEl.classList.toggle('hidden', !activeBtn.dataset.subtitle);
    }
    if (sidebar && window.innerWidth <= 900) {
      sidebar.classList.remove('open');
      syncSidebarToggleLabel();
    }
    document.querySelectorAll('.module-panel').forEach((p) => {
      p.classList.toggle('hidden', p.id !== `sec-${sec}`);
    });
    if (onSectionChange) onSectionChange(sec);
  }

  function initNavigation(onSectionChange) {
    const navBtns = document.querySelectorAll('.nav-btn[data-section]');
    const sidebar = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');

    if (sidebar && !document.getElementById('sidebar-backdrop')) {
      const backdrop = document.createElement('div');
      backdrop.id = 'sidebar-backdrop';
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
      backdrop.addEventListener('click', () => {
        sidebar.classList.remove('open');
        syncSidebarToggleLabel();
      });
    }

    try {
      if (window.innerWidth > 900 && window.sessionStorage.getItem('sms_sidebar_collapsed') === '1') {
        document.body.classList.add('sidebar-collapsed');
      }
    } catch (_e) {
      // ignore storage errors
    }

    if (mobileBtn && sidebar) {
      mobileBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>' +
        '<span class="menu-btn-text">Hide Menu</span>';

      mobileBtn.addEventListener('click', () => {
        if (window.innerWidth <= 900) {
          sidebar.classList.toggle('open');
        } else {
          const collapsed = document.body.classList.toggle('sidebar-collapsed');
          try {
            window.sessionStorage.setItem('sms_sidebar_collapsed', collapsed ? '1' : '0');
          } catch (_e) {
            // ignore storage errors
          }
        }
        syncSidebarToggleLabel();
      });

      window.addEventListener('resize', syncSidebarToggleLabel);
      syncSidebarToggleLabel();
    }

    const topbar = document.querySelector('.topbar');
    if (topbar && !topbar.querySelector('.topbar-date-chip')) {
      const chip = document.createElement('div');
      chip.className = 'topbar-date-chip';
      const formattedDate = new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date());
      chip.innerHTML = `<span class="topbar-live-dot" aria-hidden="true"></span><span>${esc(formattedDate)}</span>`;
      topbar.appendChild(chip);
    }

    initUniversalSearch();
    initTopbarSearch(onSectionChange);
    initThemeAndLanguageControls();
    initScrollGlassEffect();

    const termsBtn = document.getElementById('open-terms-btn');
    if (termsBtn && !termsBtn.dataset.boundTerms) {
      termsBtn.dataset.boundTerms = '1';
      termsBtn.addEventListener('click', () => {
        openTermsModal({ mandatory: false, user: currentUser });
      });
    }

    navBtns.forEach((btn) => {
      btn.addEventListener('click', () => activateSection(btn.dataset.section, onSectionChange));
    });

    document.addEventListener('click', (e) => {
      const jumpTile = e.target.closest('[data-nav-jump]');
      if (!jumpTile) return;
      const targetSec = jumpTile.dataset.navJump;
      const matchingNav = document.querySelector(`.nav-btn[data-section="${targetSec}"]`);
      if (matchingNav) {
        matchingNav.click();
      } else {
        activateSection(targetSec, onSectionChange);
      }
    });
  }

  function applySearchBar(bar) {
    if (!bar) return { matched: 0, total: 0 };
    const input = bar.querySelector('.search-bar-input');
    const clearBtn = bar.querySelector('[data-search-clear]');
    const rawQ = String(input?.value || '').trim();
    const q = rawQ.toLowerCase();
    if (clearBtn) clearBtn.classList.toggle('hidden', !q);

    const tbodyId = bar.dataset.searchTbody;
    const listId = bar.dataset.searchList;
    const matrixId = bar.dataset.searchMatrix;

    if (tbodyId) {
      const tbody = document.getElementById(tbodyId);
      if (!tbody) return { matched: 0, total: 0 };
      bar._applying = true;
      try {
        tbody.querySelectorAll('tr.search-no-match-row').forEach((r) => r.remove());
        const dataRows = Array.from(tbody.querySelectorAll('tr')).filter(
          (r) => !r.querySelector('.empty-state') && !r.classList.contains('search-no-match-row')
        );
        let matched = 0;
        for (const row of dataRows) {
          const ok = !q || row.textContent.toLowerCase().includes(q);
          row.classList.toggle('hidden', !ok);
          if (ok) matched += 1;
        }
        if (q && dataRows.length > 0 && matched === 0) {
          const noRow = document.createElement('tr');
          noRow.className = 'search-no-match-row';
          noRow.innerHTML = `<td colspan="12" class="empty-state">No matching records for "${esc(rawQ)}".</td>`;
          tbody.appendChild(noRow);
        }
        return { matched, total: dataRows.length };
      } finally {
        bar._applying = false;
      }
    }

    if (listId) {
      const listEl = document.getElementById(listId);
      if (!listEl) return { matched: 0, total: 0 };
      bar._applying = true;
      try {
        listEl.querySelectorAll('.search-no-match-box').forEach((n) => n.remove());
        const items = Array.from(listEl.children).filter(
          (c) => !c.classList.contains('empty-state') && !c.classList.contains('search-no-match-box')
        );
        let matched = 0;
        for (const item of items) {
          const ok = !q || item.textContent.toLowerCase().includes(q);
          item.classList.toggle('hidden', !ok);
          if (ok) matched += 1;
        }
        if (q && items.length > 0 && matched === 0) {
          const box = document.createElement('div');
          box.className = 'empty-state search-no-match-box';
          box.textContent = `No matching items for "${rawQ}".`;
          listEl.appendChild(box);
        }
        return { matched, total: items.length };
      } finally {
        bar._applying = false;
      }
    }

    if (matrixId) {
      const matrixEl = document.getElementById(matrixId);
      if (!matrixEl) return { matched: 0, total: 0 };
      bar._applying = true;
      try {
        matrixEl.querySelectorAll('.search-no-match-box').forEach((n) => n.remove());
        const slotCards = Array.from(matrixEl.querySelectorAll('.tt-slot-card'));
        let matched = 0;
        for (const card of slotCards) {
          const ok = !q || card.textContent.toLowerCase().includes(q);
          card.classList.toggle('hidden', !ok);
          if (ok) matched += 1;
        }
        if (q && slotCards.length > 0 && matched === 0) {
          const box = document.createElement('div');
          box.className = 'empty-state search-no-match-box';
          box.style.marginBottom = '10px';
          box.textContent = `No timetable lessons matching "${rawQ}".`;
          matrixEl.prepend(box);
        }
        return { matched, total: slotCards.length };
      } finally {
        bar._applying = false;
      }
    }

    return { matched: 0, total: 0 };
  }

  function initUniversalSearch(root = document) {
    root.querySelectorAll('.search-bar').forEach((bar) => {
      if (bar.dataset.searchBound === '1') return;
      bar.dataset.searchBound = '1';

      const input = bar.querySelector('.search-bar-input');
      const btn = bar.querySelector('[data-search-btn]');
      const clearBtn = bar.querySelector('[data-search-clear]');

      if (btn) {
        btn.addEventListener('click', () => {
          applySearchBar(bar);
        });
      }
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (btn) btn.click();
            else applySearchBar(bar);
          }
        });
        input.addEventListener('search', () => {
          if (!input.value.trim()) {
            if (clearBtn && !clearBtn.classList.contains('hidden')) clearBtn.click();
            else applySearchBar(bar);
          }
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          if (input) input.value = '';
          applySearchBar(bar);
        });
      }

      const targetId =
        bar.dataset.searchTbody || bar.dataset.searchList || bar.dataset.searchMatrix;
      const targetEl = targetId ? document.getElementById(targetId) : null;
      if (targetEl && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => {
          if (bar._applying) return;
          if (input && input.value.trim()) {
            applySearchBar(bar);
          }
        });
        observer.observe(targetEl, { childList: true });
      }
    });
  }

  function initTopbarSearch(onSectionChange) {
    const form = document.getElementById('topbar-search-form');
    const input = document.getElementById('topbar-search-input');
    const clearBtn = document.getElementById('topbar-search-clear-btn');
    if (!form || !input) return;

    function runTopbarSearch(rawQuery) {
      const q = String(rawQuery || '').trim();
      if (clearBtn) clearBtn.classList.toggle('hidden', !q);

      const activePanel = document.querySelector('.module-panel:not(.hidden)');
      let ranInPanel = false;
      let matchedTotal = 0;

      if (activePanel) {
        const visibleSubPane = activePanel.querySelector('.subtab-pane:not(.hidden)');
        const scope = visibleSubPane || activePanel;

        scope.querySelectorAll('.search-bar').forEach((bar) => {
          const inp = bar.querySelector('.search-bar-input');
          if (inp) {
            inp.value = q;
            const res = applySearchBar(bar);
            matchedTotal += res.matched;
            ranInPanel = true;
          }
        });

        scope.querySelectorAll('[data-server-search-input]').forEach((srvInput) => {
          srvInput.value = q;
          const btnId = srvInput.dataset.serverSearchBtn;
          const srvBtn = btnId ? document.getElementById(btnId) : null;
          if (srvBtn) {
            srvBtn.click();
            ranInPanel = true;
          }
        });
      }

      if (q && (!ranInPanel || matchedTotal === 0)) {
        const qLower = q.toLowerCase();
        const navMatch = Array.from(document.querySelectorAll('.nav-btn[data-section]')).find(
          (b) => {
            const label = (b.dataset.title || b.textContent || '').trim().toLowerCase();
            return label.includes(qLower) || String(b.dataset.section || '').includes(qLower);
          }
        );
        if (navMatch && !navMatch.classList.contains('active')) {
          activateSection(navMatch.dataset.section, onSectionChange);
          toast(
            `Opened ${navMatch.dataset.title || navMatch.textContent.trim()}`,
            'info'
          );
          return;
        }
      }

      if (q && !ranInPanel) {
        toast(`No searchable list on this screen for "${q}".`, 'info');
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      runTopbarSearch(input.value);
    });

    input.addEventListener('search', () => {
      if (!input.value.trim()) runTopbarSearch('');
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        runTopbarSearch('');
      });
    }
  }

  async function savePreferencesRemote(partial) {
    if (!currentUser) return;
    try {
      const res = await api('/api/auth/preferences', {
        method: 'PATCH',
        body: partial,
      });
      if (res.user) currentUser = res.user;
    } catch (_) {
      // keep local preference even if offline
    }
  }

  function initThemeAndLanguageControls() {
    const themeSel = document.getElementById('sb-theme-select');
    if (themeSel && themeSel.dataset.prefBound !== '1') {
      themeSel.dataset.prefBound = '1';
      themeSel.value = activeThemePref;
      themeSel.addEventListener('change', () => {
        applyTheme(themeSel.value, { persistLocal: true });
        savePreferencesRemote({ theme: themeSel.value });
      });
    }

    const langSel = document.getElementById('sb-lang-select');
    if (langSel && langSel.dataset.prefBound !== '1') {
      langSel.dataset.prefBound = '1';
      langSel.value = activeLangPref;
      langSel.addEventListener('change', () => {
        applyLanguage(langSel.value, { persistLocal: true });
        savePreferencesRemote({ language: langSel.value });
      });
    }

    applyTheme(activeThemePref, { persistLocal: false });
    applyLanguage(activeLangPref, { persistLocal: false });
  }

  function initScrollGlassEffect() {
    if (window.__smsScrollGlassBound) return;
    window.__smsScrollGlassBound = true;
    const onScroll = () => {
      document.body?.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  const KPI_ICONS = {
    layers:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    users:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    graduation:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg>',
    wallet:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
    book:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    clipboard:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>',
    trending:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    alert:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };

  function kpiCard({ label, value, sub = '', icon = 'layers', tone = 'blue', valueStyle = '' }) {
    const svg = KPI_ICONS[icon] || KPI_ICONS.layers;
    return `<div class="kpi-card kpi-tone-${esc(tone)}">
      <div class="kpi-head">
        <div class="kpi-label">${label}</div>
        <span class="kpi-icon-box" aria-hidden="true">${svg}</span>
      </div>
      <div class="kpi-value"${valueStyle ? ` style="${valueStyle}"` : ''}>${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : '<div class="kpi-sub kpi-sub-spacer">&nbsp;</div>'}
    </div>`;
  }

  function renderTimetableMatrix(targetOrId, items = [], options = {}) {
    const container =
      typeof targetOrId === 'string' ? document.getElementById(targetOrId) : targetOrId;
    if (!container) return;

    const {
      showClass = true,
      showTeacher = true,
      deleteAttr = '',
      emptyMessage = 'No timetable lessons scheduled yet.',
    } = options;

    const list = Array.isArray(items) ? items : [];
    const hasSaturday = list.some(
      (r) => String(r.day_of_week || '').toLowerCase() === 'saturday'
    );
    const days = hasSaturday
      ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    const headHtml = `
      <thead>
        <tr>
          <th class="tt-time-col">Time</th>
          ${days.map((d) => `<th>${esc(d)}</th>`).join('')}
        </tr>
      </thead>
    `;

    if (!list.length) {
      container.innerHTML = `
        <div class="timetable-matrix-wrap">
          <table class="timetable-matrix">
            ${headHtml}
            <tbody>
              <tr>
                <td colspan="${days.length + 1}" class="empty-state">${esc(emptyMessage)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
      return;
    }

    const slotMap = new Map();
    for (const row of list) {
      const start = String(row.start_time || '').slice(0, 5);
      const end = String(row.end_time || '').slice(0, 5);
      const key = `${start}|${end}`;
      if (!slotMap.has(key)) {
        slotMap.set(key, { start, end, byDay: {} });
      }
      const dayKey = String(row.day_of_week || '').trim();
      const entry = slotMap.get(key);
      if (!entry.byDay[dayKey]) entry.byDay[dayKey] = [];
      entry.byDay[dayKey].push(row);
    }

    const sortedBands = Array.from(slotMap.values()).sort((a, b) => {
      if (a.start !== b.start) return a.start.localeCompare(b.start);
      return a.end.localeCompare(b.end);
    });

    const bodyRows = sortedBands
      .map((band) => {
        const dayCells = days
          .map((day) => {
            const matches = band.byDay[day] || [];
            if (!matches.length) {
              return '<td><div class="tt-empty-slot">-</div></td>';
            }
            const cards = matches
              .map((m) => {
                const metaLines = [];
                if (showClass && m.class_name) {
                  metaLines.push(`<strong>${esc(m.class_name)}</strong>`);
                }
                if (showTeacher && m.teacher_name) {
                  metaLines.push(`Teacher: ${esc(m.teacher_name)}`);
                }
                if (m.room) {
                  metaLines.push(`Room: ${esc(m.room)}`);
                }
                return `
                  <div class="tt-slot-card">
                    ${m.subject_code ? `<span class="tt-slot-code">${esc(m.subject_code)}</span>` : ''}
                    <div class="tt-slot-subj">${esc(m.subject_name || '-')}</div>
                    ${metaLines.length ? `<div class="tt-slot-meta">${metaLines.join('<br>')}</div>` : ''}
                    ${
                      deleteAttr && m.id
                        ? `<div class="tt-slot-actions"><button type="button" class="btn btn-danger btn-sm" ${deleteAttr}="${m.id}">Remove</button></div>`
                        : ''
                    }
                  </div>
                `;
              })
              .join('');
            return `<td>${cards}</td>`;
          })
          .join('');

        return `
          <tr>
            <td class="tt-time-cell">${esc(band.start)} - ${esc(band.end)}</td>
            ${dayCells}
          </tr>
        `;
      })
      .join('');

    container.innerHTML = `
      <div class="timetable-matrix-wrap">
        <table class="timetable-matrix">
          ${headHtml}
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;
  }

  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    if (
      [
        'active',
        'paid',
        'present',
        'published',
        'approved',
        'balanced',
        'verified',
        'completed',
        'enrolled',
        'success',
      ].includes(s)
    ) {
      return `<span class="badge badge-success">${esc(status)}</span>`;
    }
    if (['partial', 'late', 'pending', 'important', 'excused'].includes(s)) {
      return `<span class="badge badge-warning">${esc(status)}</span>`;
    }
    if (
      [
        'unpaid',
        'absent',
        'inactive',
        'suspended',
        'locked',
        'rejected',
        'discrepancy',
        'urgent',
        'failed',
        'abandoned',
        'reversed',
      ].includes(s)
    ) {
      return `<span class="badge badge-danger">${esc(status)}</span>`;
    }
    return `<span class="badge badge-neutral">${esc(status || 'N/A')}</span>`;
  }

  function exportCsv(filename, headers, rows) {
    const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.map(csvCell).join(','),
      ...rows.map((row) => row.map(csvCell).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function bindCurrencySelect(selectId, endpoint, onChanged) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.addEventListener('change', async () => {
      try {
        const res = await api(endpoint, {
          method: 'PATCH',
          body: { currencyCode: sel.value },
        });
        setCurrency(res.currency.code, res.currency.symbol);
        toast(`Active currency updated to ${res.currency.code} (${res.currency.symbol})`, 'success');
        if (onChanged) await onChanged();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function populateCurrencyOptions(selectId, currencies = [], activeCode = 'GHS') {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = currencies
      .map(
        (c) =>
          `<option value="${esc(c.code)}" ${c.code === activeCode ? 'selected' : ''}>${esc(c.symbol)} - ${esc(c.code)}</option>`
      )
      .join('');
  }

  function openPaystackCheckout(tx, { verifyEndpoint, abandonEndpoint, onSuccess } = {}) {
    if (tx.gatewayMode !== 'sandbox' && tx.authorizationUrl) {
      window.location.href = tx.authorizationUrl;
      return;
    }

    let modal = document.getElementById('paystack-checkout-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'paystack-checkout-modal';
      modal.className = 'modal-backdrop';
      document.body.appendChild(modal);
    }

    let activeChannel = tx.channel || 'mobile_money';
    const channels = [
      { id: 'mobile_money', label: 'Mobile Money' },
      { id: 'card', label: 'Card' },
      { id: 'bank_transfer', label: 'Bank' },
      { id: 'ussd', label: 'USSD' },
    ];

    function renderChannelDetails(ch) {
      if (ch === 'mobile_money') {
        return `
          <div class="form-group">
            <label>Mobile Money Network</label>
            <select id="psk-sim-provider">
              <option>MTN Mobile Money</option>
              <option>Telecel Cash</option>
              <option>AirtelTigo Money</option>
            </select>
          </div>
          <div class="form-group">
            <label>Subscriber Mobile Number</label>
            <input type="text" placeholder="Enter mobile wallet number" autocomplete="off">
          </div>`;
      }
      if (ch === 'card') {
        return `
          <div class="form-group">
            <label>Card Number</label>
            <input type="password" value="0000000000004081" autocomplete="off" aria-label="Masked card">
          </div>
          <div class="form-grid">
            <div class="form-group"><label>Expiry</label><input type="text" placeholder="MM/YY" autocomplete="off"></div>
            <div class="form-group"><label>CVV</label><input type="password" value="000" autocomplete="off"></div>
          </div>`;
      }
      if (ch === 'bank_transfer') {
        return `<div class="alert alert-info" style="margin:6px 0;">Authorize Paystack bank settlement for reference <strong>${esc(tx.reference)}</strong>.</div>`;
      }
      return `<div class="alert alert-info" style="margin:6px 0;">Authorize Paystack USSD prompt for reference <strong>${esc(tx.reference)}</strong>.</div>`;
    }

    function renderModal() {
      modal.innerHTML = `
        <div class="paystack-modal-box">
          <div class="paystack-top">
            <div class="paystack-brand">
              <span class="paystack-bars"><span></span><span></span><span></span></span>
              <span>paystack</span>
            </div>
            <div style="text-align:right;font-size:12px;">
              <div style="color:#94a3b8;">${esc(tx.payerEmail)}</div>
              <div style="font-weight:800;font-size:15px;color:#38bdf8;">${esc(moneyPlain(tx.amount, tx.currencySymbol))}</div>
            </div>
          </div>
          <div class="paystack-body">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
              Student: <strong>${esc(tx.student?.name || '')}</strong> (${esc(tx.student?.admissionNumber || '')})<br>
              Reference: <code>${esc(tx.reference)}</code>
            </div>
            <div class="paystack-channels">
              ${channels
                .map(
                  (c) =>
                    `<button type="button" class="paystack-ch-btn ${activeChannel === c.id ? 'active' : ''}" data-psk-ch="${c.id}">${esc(c.label)}</button>`
                )
                .join('')}
            </div>
            <div id="psk-ch-fields">${renderChannelDetails(activeChannel)}</div>
            <div style="display:flex;gap:8px;margin-top:16px;">
              <button type="button" class="btn btn-paystack" style="flex:1;" id="psk-authorize-btn">
                Pay ${esc(moneyPlain(tx.amount, tx.currencySymbol))}
              </button>
              <button type="button" class="btn btn-secondary" id="psk-cancel-btn">Cancel</button>
            </div>
          </div>
        </div>
      `;

      modal.querySelectorAll('[data-psk-ch]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeChannel = btn.dataset.pskCh;
          renderModal();
        });
      });

      modal.querySelector('#psk-authorize-btn').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Verifying with Paystack...';
        try {
          const verified = await api(verifyEndpoint, {
            method: 'POST',
            body: { reference: tx.reference, channel: activeChannel },
          });
          modal.classList.remove('open');
          toast(`Paystack payment verified - Receipt ${verified.receiptNumber}`, 'success');
          if (onSuccess) await onSuccess(verified);
        } catch (err) {
          toast(err.message, 'error');
          e.target.disabled = false;
          e.target.textContent = `Pay ${moneyPlain(tx.amount, tx.currencySymbol)}`;
        }
      });

      modal.querySelector('#psk-cancel-btn').addEventListener('click', async () => {
        modal.classList.remove('open');
        if (abandonEndpoint) {
          try {
            await api(abandonEndpoint, { method: 'POST', body: { reference: tx.reference } });
          } catch (_) {
            // ignore
          }
        }
      });
    }

    renderModal();
    modal.classList.add('open');
  }

  function formatBytes(bytes) {
    const num = Number(bytes || 0);
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
  }

  function renderMediaAttachments(attachments = [], options = {}) {
    if (!Array.isArray(attachments) || !attachments.length) return '';
    const compact = Boolean(options.compact);

    if (compact) {
      return `<div class="subject-badges-wrap">${attachments
        .map((att) => {
          const viewUrl = esc(withNavSession(att.url));
          const dlUrl = esc(withNavSession(att.downloadUrl || `${att.url}?download=1`));
          const kindLabel = String(att.mediaKind || 'file').toUpperCase();
          const targetHref = att.mediaKind === 'document' ? dlUrl : viewUrl;
          return `<a href="${targetHref}" target="_blank" rel="noopener" class="subject-badge-tag" style="text-decoration:none;"><strong>${esc(kindLabel)}</strong> &middot; ${esc(att.originalName)}</a>`;
        })
        .join('')}</div>`;
    }

    return `<div class="media-gallery">${attachments
      .map((att) => {
        const viewUrl = esc(withNavSession(att.url));
        const dlUrl = esc(withNavSession(att.downloadUrl || `${att.url}?download=1`));
        const sizeLabel = esc(formatBytes(att.sizeBytes));
        const kind = String(att.mediaKind || 'document').toLowerCase();

        if (kind === 'image') {
          return `<div class="media-item-card">
            <a href="${viewUrl}" target="_blank" rel="noopener">
              <img src="${viewUrl}" alt="${esc(att.originalName)}" class="media-thumb-img" loading="lazy">
            </a>
            <div class="media-item-meta">
              <span class="media-item-name" title="${esc(att.originalName)}">${esc(att.originalName)}</span>
              <span class="media-item-sub">Image &middot; ${sizeLabel} &middot; <a href="${dlUrl}">Download</a></span>
            </div>
          </div>`;
        }

        if (kind === 'video') {
          return `<div class="media-item-card media-item-video">
            <video controls preload="metadata" src="${viewUrl}" class="media-video-player"></video>
            <div class="media-item-meta">
              <span class="media-item-name" title="${esc(att.originalName)}">${esc(att.originalName)}</span>
              <span class="media-item-sub">Video &middot; ${sizeLabel} &middot; <a href="${dlUrl}">Download</a></span>
            </div>
          </div>`;
        }

        if (kind === 'pdf') {
          return `<div class="media-item-card media-item-doc">
            <div class="media-doc-badge">PDF</div>
            <div class="media-item-meta">
              <span class="media-item-name" title="${esc(att.originalName)}">${esc(att.originalName)}</span>
              <span class="media-item-sub">${sizeLabel} &middot; <a href="${viewUrl}" target="_blank" rel="noopener">Open PDF</a> &middot; <a href="${dlUrl}">Download</a></span>
            </div>
          </div>`;
        }

        return `<div class="media-item-card media-item-doc">
          <div class="media-doc-badge">DOC</div>
          <div class="media-item-meta">
            <span class="media-item-name" title="${esc(att.originalName)}">${esc(att.originalName)}</span>
            <span class="media-item-sub">${sizeLabel} &middot; <a href="${dlUrl}">Download File</a></span>
          </div>
        </div>`;
      })
      .join('')}</div>`;
  }

  /* ---------------- OVERVIEW CALENDAR (All Four Dashboards) ---------------- */
  const CAL_EVENT_CACHE = new Map();
  const CAL_STATE = { year: null, month: null, selected: null, events: [], loading: false };
  let calMountEl = null;
  let calAgendaEl = null;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function calLang() {
    return activeLangPref && activeLangPref !== 'system' ? activeLangPref : 'en';
  }

  function monthTitle(year, month) {
    try {
      const fmt = new Intl.DateTimeFormat(calLang(), { month: 'long', year: 'numeric' });
      return fmt.format(new Date(year, month, 1));
    } catch (_) {
      const names = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      return `${names[month]} ${year}`;
    }
  }

  function weekdayNames() {
    const fallback = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    try {
      const fmt = new Intl.DateTimeFormat(calLang(), { weekday: 'short' });
      return fallback.map((fb, i) => {
        try {
          return fmt.format(new Date(2024, 8, 1 + i));
        } catch (_) {
          return fb;
        }
      });
    } catch (_) {
      return fallback;
    }
  }

  function formatDayLong(dateKeyStr) {
    try {
      const fmt = new Intl.DateTimeFormat(calLang(), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      const [y, m, d] = dateKeyStr.split('-').map(Number);
      return fmt.format(new Date(y, m - 1, d));
    } catch (_) {
      return dateKeyStr;
    }
  }

  function calGridRange(year, month) {
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 41);
    const key = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    return { from: key(start), to: key(end), start };
  }

  async function loadCalendarEvents(year, month) {
    const range = calGridRange(year, month);
    const cacheKey = `${range.from}_${range.to}`;
    const cached = CAL_EVENT_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < 45000) {
      CAL_STATE.events = cached.events;
      return;
    }
    CAL_STATE.loading = true;
    try {
      const data = await api(`/api/calendar/events?from=${range.from}&to=${range.to}`);
      const events = Array.isArray(data.events) ? data.events : [];
      CAL_EVENT_CACHE.set(cacheKey, { at: Date.now(), events });
      CAL_STATE.events = events;
    } catch (_) {
      CAL_STATE.events = (cached && cached.events) || [];
    } finally {
      CAL_STATE.loading = false;
    }
  }

  function eventsByDate() {
    const map = new Map();
    CAL_STATE.events.forEach((ev) => {
      const key = String(ev.date || '').slice(0, 10);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    });
    return map;
  }

  function renderCalendar() {
    if (!calMountEl) return;
    const { year, month } = CAL_STATE;
    const range = calGridRange(year, month);
    const byDate = eventsByDate();
    const today = todayKey();
    const dow = weekdayNames();

    const dowHtml = dow
      .map((d) => `<div class="cal-dow" aria-hidden="true">${esc(d)}</div>`)
      .join('');

    let cells = '';
    const cursor = new Date(range.start);
    for (let i = 0; i < 42; i += 1) {
      const key = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`;
      const outside = cursor.getMonth() !== month;
      const dayEvents = byDate.get(key) || [];
      const tones = Array.from(new Set(dayEvents.map((e) => e.tone || e.kind))).slice(0, 3);
      const dots = tones
        .map((t) => `<span class="cal-dot cal-dot-${esc(t)}"></span>`)
        .join('');
      cells += `<button type="button" class="cal-day${outside ? ' is-outside' : ''}${
        key === today ? ' is-today' : ''
      }${CAL_STATE.selected === key ? ' is-selected' : ''}" data-cal-date="${key}" aria-label="${key}${
        dayEvents.length ? `, ${dayEvents.length} item(s)` : ''
      }">
        <span class="cal-day-num">${cursor.getDate()}</span>
        <span class="cal-dots">${dots}</span>
      </button>`;
      cursor.setDate(cursor.getDate() + 1);
    }

    calMountEl.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav-btn" id="cal-prev-btn" aria-label="Previous month">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="cal-title" id="cal-month-label">${esc(monthTitle(year, month))}</div>
        <div class="cal-head-actions">
          <button type="button" class="cal-today-btn" id="cal-today-btn">Today</button>
          <button type="button" class="cal-nav-btn" id="cal-next-btn" aria-label="Next month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
      <div class="cal-grid" role="grid" aria-label="${esc(monthTitle(year, month))}">
        ${dowHtml}
        ${cells}
      </div>
      <div class="cal-legend">
        <span class="cal-legend-item"><span class="cal-dot cal-dot-coursework"></span>Classwork &amp; Exams</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-announcement"></span>Announcements</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-fee"></span>Fees Due</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-payment"></span>Payments</span>
      </div>
    `;

    calMountEl.querySelector('#cal-prev-btn')?.addEventListener('click', () => shiftCalendarMonth(-1));
    calMountEl.querySelector('#cal-next-btn')?.addEventListener('click', () => shiftCalendarMonth(1));
    calMountEl.querySelector('#cal-today-btn')?.addEventListener('click', () => jumpCalendarToToday());
    calMountEl.querySelectorAll('.cal-day').forEach((btn) => {
      btn.addEventListener('click', () => {
        CAL_STATE.selected = btn.dataset.calDate;
        renderCalendar();
        renderCalendarAgenda();
      });
    });
  }

  function renderCalendarAgenda() {
    if (!calAgendaEl) return;
    const selected = CAL_STATE.selected || todayKey();
    const byDate = eventsByDate();
    const dayEvents = byDate.get(selected) || [];
    const today = todayKey();

    const upcoming = CAL_STATE.events
      .filter((ev) => String(ev.date).slice(0, 10) >= today)
      .sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1))
      .slice(0, 4);

    const itemHtml = (ev) => `
      <div class="cal-agenda-item">
        <span class="cal-dot cal-dot-${esc(ev.tone || ev.kind)}"></span>
        <div class="cal-agenda-copy">
          <div class="cal-agenda-title">${esc(ev.title)}</div>
          <div class="cal-agenda-meta">${esc(ev.date)} &middot; ${esc(ev.meta || ev.kindLabel || '')}</div>
        </div>
      </div>`;

    calAgendaEl.innerHTML = `
      <div class="cal-agenda-head">
        <span class="cal-agenda-label">Selected Day</span>
        <span class="cal-agenda-date">${esc(formatDayLong(selected))}</span>
      </div>
      <div class="cal-agenda-list">
        ${
          dayEvents.length
            ? dayEvents.map(itemHtml).join('')
            : '<div class="empty-state-sm">No items scheduled on this day.</div>'
        }
      </div>
      <div class="cal-agenda-head cal-agenda-head-spaced">
        <span class="cal-agenda-label">Upcoming</span>
      </div>
      <div class="cal-agenda-list">
        ${
          upcoming.length
            ? upcoming.map(itemHtml).join('')
            : '<div class="empty-state-sm">Nothing upcoming in this period.</div>'
        }
      </div>
    `;
  }

  async function shiftCalendarMonth(delta) {
    const next = new Date(CAL_STATE.year, CAL_STATE.month + delta, 1);
    CAL_STATE.year = next.getFullYear();
    CAL_STATE.month = next.getMonth();
    CAL_STATE.selected = `${CAL_STATE.year}-${pad2(CAL_STATE.month + 1)}-01`;
    renderCalendar();
    renderCalendarAgenda();
    await loadCalendarEvents(CAL_STATE.year, CAL_STATE.month);
    renderCalendar();
    renderCalendarAgenda();
  }

  async function jumpCalendarToToday() {
    const now = new Date();
    CAL_STATE.year = now.getFullYear();
    CAL_STATE.month = now.getMonth();
    CAL_STATE.selected = todayKey();
    renderCalendar();
    renderCalendarAgenda();
    await loadCalendarEvents(CAL_STATE.year, CAL_STATE.month);
    renderCalendar();
    renderCalendarAgenda();
  }

  async function initOverviewCalendar(options = {}) {
    const mountId = options.mountId || 'ov-calendar';
    const agendaId = options.agendaId || 'ov-calendar-agenda';
    calMountEl = document.getElementById(mountId);
    calAgendaEl = document.getElementById(agendaId);
    if (!calMountEl) return;

    const now = new Date();
    CAL_STATE.year = now.getFullYear();
    CAL_STATE.month = now.getMonth();
    CAL_STATE.selected = todayKey();

    renderCalendar();
    renderCalendarAgenda();
    await loadCalendarEvents(CAL_STATE.year, CAL_STATE.month);
    renderCalendar();
    renderCalendarAgenda();

    if (!window.__smsCalLangBound) {
      window.__smsCalLangBound = true;
      window.addEventListener('sms:languagechange', () => {
        if (!calMountEl) return;
        renderCalendar();
        renderCalendarAgenda();
      });
    }
  }

  function clearCalendarCache() {
    CAL_EVENT_CACHE.clear();
  }

  return {
    esc,
    money,
    moneyPlain,
    setCurrency,
    getCurrency,
    toast,
    api,
    initSession,
    enhancePasswordInputs,
    startGoogleAuth,
    configureGoogleLinkButton,
    initPrivacyToggle,
    logout,
    activateSection,
    initNavigation,
    applySearchBar,
    initUniversalSearch,
    applyTheme,
    applyLanguage,
    openTermsModal,
    buildTermsClausesHtml,
    kpiCard,
    renderTimetableMatrix,
    formatBytes,
    renderMediaAttachments,
    statusBadge,
    exportCsv,
    bindCurrencySelect,
    populateCurrencyOptions,
    openPaystackCheckout,
    withNavSession,
    navigateAuthenticated,
    initOverviewCalendar,
    clearCalendarCache,
    setSessionToken,
    getSessionToken,
    getUser: () => currentUser,
    isGoogleAuthEnabled: () => googleAuthEnabled,
  };
})();
