/* Private portfolio: unlock, then the same behaviour as pavelkroupa.com.
   Nothing here can read the content without the password: the key is derived
   from it, and the page and every image and file are AES-GCM sealed. */
(function () {
  'use strict';

  var D = document.documentElement;
  var VAULT = window.VAULT;
  var SESSION_KEY = 'pf-pw';
  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cryptoKey = null;
  var route = null;

  /* ---------- crypto ---------- */
  function fromBase64(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function deriveKey(password) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (material) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: fromBase64(VAULT.salt), iterations: VAULT.iterations, hash: 'SHA-256' },
          material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      });
  }
  // Rejects on a wrong password: GCM authentication fails before anything decodes.
  function unseal(key, sealed) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12) }, key, sealed.slice(12))
      .then(function (plain) { return new Uint8Array(plain); });
  }

  /* ---------- language: one page, Czech and English side by side ---------- */
  function lang() { return D.lang === 'en' ? 'en' : 'cs'; }
  function labelAria() {
    document.querySelectorAll('[data-aria-cs]').forEach(function (el) {
      el.setAttribute('aria-label', el.getAttribute('data-aria-' + lang()));
    });
  }
  function storeLang(L) {
    D.lang = L;
    try { localStorage.setItem('pf-lang', L); } catch (e) { /* private mode */ }
    labelAria();
    themeLabels();
    renderMessage();
  }
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('[data-lang-toggle]')) return;
    ev.preventDefault();
    storeLang(lang() === 'cs' ? 'en' : 'cs');
    if (route) route(true);
  });

  /* ---------- theme: follows the system until the visitor picks; the button flips light / dark, as on pavelkroupa.com ---------- */
  var DQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applied() { var a = D.getAttribute('data-theme'); return a === 'light' || a === 'dark' ? a : (DQ && DQ.matches ? 'dark' : 'light'); }
  function themeLabels() {
    var dark = applied() === 'dark', cs = D.lang === 'cs';
    var t = dark ? (cs ? 'Přepnout na světlý vzhled' : 'Switch to light mode') : (cs ? 'Přepnout na tmavý vzhled' : 'Switch to dark mode');
    document.querySelectorAll('[data-theme-toggle], #theme').forEach(function (b) { b.setAttribute('aria-label', t); });
  }
  function play(b) { var g = b.querySelector('.tg'); if (!g) return; g.classList.remove('tg-go'); void g.getBoundingClientRect(); g.classList.add('tg-go'); }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-theme-toggle], #theme');
    if (!b) return;
    var m = applied() === 'dark' ? 'light' : 'dark';
    D.setAttribute('data-theme', m);
    try { localStorage.setItem('pf-theme', m); } catch (e) { /* private mode */ }
    themeLabels(); play(b);
  });
  if (DQ && DQ.addEventListener) DQ.addEventListener('change', themeLabels);
  themeLabels();

  /* ---------- lock screen ---------- */
  var gate = document.getElementById('gate');
  var form = document.getElementById('gate-form');
  var input = document.getElementById('password');
  var submit = document.getElementById('gate-submit');
  var messageEl = document.getElementById('gate-message');
  var MESSAGES = {
    busy: { cs: 'Odemykám…', en: 'Unlocking…' },
    wrong: { cs: 'Tohle heslo nesedí. Zkuste to znovu.', en: 'That password is not right. Try again.' }
  };
  var message = null;
  var SPIN = '<span class="pk-spin" aria-hidden="true"><svg viewBox="0 0 64 32" aria-hidden="true"><path class="pk-spin-l" pathLength="1" d="M3 22C1 8 17 4 17 14C17 24 4 24 6 13C8 4 22 7 20 17C18 26 9 22 12 15C14 10 19 13 21 18C23 22 27 21 39 21"/><g class="pk-spin-n"><rect x="43" y="9" width="17" height="17" rx="1.2"/><path class="pk-spin-c" pathLength="1" d="M47 17.5L50.3 21L56 13.5"/></g></svg></span>';
  function setMessage(key) { message = key; renderMessage(); }
  function renderMessage() {
    if (!messageEl) return;
    messageEl.textContent = message ? MESSAGES[message][lang()] : '';
    // While unlocking, the brand spinner (site.css, .pk-spin) sits before the text
    if (message === 'busy') messageEl.insertAdjacentHTML('afterbegin', SPIN);
    messageEl.classList.toggle('pf-info', message === 'busy');
  }

  function unlock(password, silent) {
    if (!silent) { submit.disabled = true; setMessage('busy'); }
    var key;
    return deriveKey(password)
      .then(function (k) { key = k; return unseal(k, fromBase64(VAULT.payload)); })
      .then(function (plain) {
        cryptoKey = key;
        try { sessionStorage.setItem(SESSION_KEY, password); } catch (e) { /* private mode */ }
        mount(new TextDecoder().decode(plain));
        return true;
      }, function () {
        submit.disabled = false;
        if (silent) {
          try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* private mode */ }
          setMessage(null);
          return false;
        }
        setMessage('wrong');
        form.classList.remove('pf-wrong');
        void form.offsetWidth; // restart the shake
        form.classList.add('pf-wrong');
        input.select();
        return false;
      });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (input.value) unlock(input.value, false);
    else input.focus();
  });
  input.addEventListener('input', function () {
    form.classList.remove('pf-wrong');
    if (message === 'wrong') setMessage(null);
  });

  // The eye shows or hides the password. A click or tap sends you back to typing, with the
  // caret where it was. A keyboard press stays on the eye, so you can press it again.
  var eye = document.getElementById('gate-eye');
  eye.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
  eye.addEventListener('click', function (ev) {
    var show = input.type === 'password';
    var from = input.selectionStart, to = input.selectionEnd;
    input.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', show ? 'true' : 'false');
    if (ev.detail > 0) {
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(from, to); } catch (e) { /* not selectable */ }
    }
  });

  /* ---------- the site, once decrypted ---------- */
  function mount(html) {
    var app = document.getElementById('app');
    app.innerHTML = html;
    gate.remove();
    app.hidden = false;
    storeLang(lang());
    themeLabels();
    initReveal();
    initIll();
    initMedia();
    initRouter();
    initDraw();
  }

  /* ---------- encrypted images and files ---------- */
  var blobs = new Map(); // asset id -> promise of a blob URL
  function assetUrl(id, type) {
    if (!blobs.has(id)) {
      blobs.set(id, fetch('a/' + id + '.enc')
        .then(function (res) { if (!res.ok) throw new Error('asset ' + id + ': ' + res.status); return res.arrayBuffer(); })
        .then(function (buf) { return unseal(cryptoKey, new Uint8Array(buf)); })
        .then(function (plain) { return URL.createObjectURL(new Blob([plain], { type: type || 'application/octet-stream' })); })
        .catch(function (err) { blobs.delete(id); throw err; }));
    }
    return blobs.get(id);
  }
  function show(el) {
    assetUrl(el.getAttribute('data-asset'), el.getAttribute('data-type')).then(function (url) {
      if (el instanceof SVGElement) el.setAttribute('href', url); else el.src = url;
    }, function () { /* leave the space empty */ });
  }
  function initMedia() {
    var media = document.querySelectorAll('#app [data-asset]:not([data-file])');
    // Images decrypt only when they are about to be seen. The hero portrait is
    // an SVG <image>, which loads straight away.
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); show(e.target); } });
    }, { rootMargin: '1200px 0px' }) : null;
    media.forEach(function (el) {
      if (io && el.tagName === 'IMG') io.observe(el); else show(el);
    });
  }
  // CV downloads: decrypted on click, saved under their real file name.
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('[data-file][data-asset]');
    if (!a) return;
    ev.preventDefault();
    if (a.getAttribute('aria-busy') === 'true') return;
    a.setAttribute('aria-busy', 'true');
    assetUrl(a.getAttribute('data-asset'), a.getAttribute('data-type')).then(function (url) {
      var link = document.createElement('a');
      link.href = url;
      link.download = a.getAttribute('data-name') || 'download';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }).catch(function () { /* nothing to save */ }).then(function () { a.removeAttribute('aria-busy'); });
  });

  /* ---------- routing: #/heirloom, #/cv, #/en/coinmate … ---------- */
  function initRouter() {
    var main = document.querySelector('main[data-titles]');
    var TITLES = JSON.parse(main.getAttribute('data-titles'));
    var SECTIONS = { projekty: 1, proces: 1, reference: 1 }; // anchors on the home view
    var views = [].slice.call(document.querySelectorAll("main > [id^='v-']"));
    var CASES = views.map(function (v) { return v.id.slice(2); })
      .filter(function (x) { return x !== 'home' && x !== 'cv'; });
    var cur = null, curView = null;

    // keep = true after a language switch: stay put, rewrite the address.
    route = function (keep) {
      var parts = (location.hash || '').replace(/^#\/?/, '').split('/');
      if (parts[0] === 'cs' || parts[0] === 'en') {
        var L = parts.shift();
        if (!keep && L !== lang()) storeLang(L); // the address wins on arrival, the switch wins after
      }
      var h = parts[0] || 'home';
      if (!TITLES.cs[h]) h = 'home';
      var view = SECTIONS[h] ? 'home' : h;
      if (view !== curView) views.forEach(function (v) { v.hidden = v.id !== 'v-' + view; });
      var on = SECTIONS[h] ? h : (CASES.indexOf(h) >= 0 ? 'projekty' : h);
      document.querySelectorAll('.top a.lnk').forEach(function (a) {
        a.classList.toggle('on', a.getAttribute('data-nav') === on);
      });
      document.title = TITLES[lang()][h];
      if (keep) {
        history.replaceState(null, '', '#/' + lang() + (h === 'home' ? '' : '/' + h));
      } else if (SECTIONS[h]) {
        var el = document.getElementById('pf-' + h);
        if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.pageYOffset - 72);
      } else if (view !== curView || h !== cur) {
        window.scrollTo(0, 0);
      }
      cur = h; curView = view;
      arm();
    };

    // A link to the page you are on still scrolls to its section.
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest('a[href^="#/"]');
      if (a && a.getAttribute('href') === location.hash) { ev.preventDefault(); route(false); }
    });
    window.addEventListener('hashchange', function () { route(false); });
    route(false);
  }

  /* ---------- scroll reveal, as on pavelkroupa.com ---------- */
  var io = null;
  /* ---------- diagrams (.ill): draw step by step once they are half in view, as on pavelkroupa.com ---------- */
  function initIll() {
    var ills = [].slice.call(document.querySelectorAll('.ill'));
    if (!ills.length) return;
    if (!('IntersectionObserver' in window) || reduceMotion) { ills.forEach(function (s) { s.classList.add('on'); }); return; }
    var o = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('on'); o.unobserve(e.target); } });
    }, { threshold: 0, rootMargin: '0px 0px -20% 0px' }); // tall phone diagrams never fit a fixed share of the screen
    ills.forEach(function (s) { o.observe(s); });
  }
  function initReveal() {
    if (!('IntersectionObserver' in window) || reduceMotion) return;
    D.classList.add('js');
    var sel = [
      'section > .wrap > .eyebrow', 'section > .wrap > h1', 'section > .wrap > h2',
      'section > .wrap > .lede', 'section > .wrap > .row', 'section > .wrap > .pf-sub',
      // portfolio blocks
      '.pf-jumps > a', '.case-cards > .card', '.pf-steps > li', '.pf-fact', '.pf-logos-band',
      '.pf-roles > li', '.pf-lead-list > li', '.pf-refs > .ref', '.tl-i', '.tl-facts > div', '.case-cta',
      '.pf-lead', '.pf-dg', '.pf-q', '.pf-tried', '.pf-shot', '.pf-cv-job'
    ].join(',');
    document.querySelectorAll(sel).forEach(function (el) {
      if (!el.hasAttribute('data-rv')) el.setAttribute('data-rv', '');
    });
    io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target, sibs = el.parentElement ? el.parentElement.children : [el];
        var i = Array.prototype.indexOf.call(sibs, el);
        el.style.transitionDelay = Math.min(i, 6) * 55 + 'ms';
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  }
  // Only visible elements are watched; hidden views and the other language
  // are picked up when a route or language switch shows them.
  function arm() {
    if (!io) return;
    document.querySelectorAll('[data-rv]:not(.in)').forEach(function (el) {
      if (el.offsetParent !== null || el.getClientRects().length) io.observe(el);
    });
  }

  /* ---------- drawing with the red marker in the hero, as on pavelkroupa.com.
     Mouse on a computer only; strokes fade after a moment. ---------- */
  function initDraw() {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var sec = document.querySelector('.hero2');
    if (!sec || sec.querySelector('.hx-pen')) return;
    var cv = document.createElement('canvas'); cv.className = 'hx-pen'; cv.setAttribute('aria-hidden', 'true'); sec.appendChild(cv);
    var ctx = cv.getContext('2d'), st = [], cur = null, raf = 0, dpr = Math.max(1, window.devicePixelRatio || 1), HOLD = 2600,
        FADE = reduceMotion ? 1 : 1200;
    function size() { var r = sec.getBoundingClientRect(); cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; kick(); }
    function pos(ev) { var r = sec.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
    function inkColor() { return (getComputedStyle(D).getPropertyValue('--marker') || '#E0241B').trim(); }
    function paint() {
      raf = 0; var now = performance.now(), col = inkColor();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = col;
      st = st.filter(function (s) { return s === cur || now - s.end < HOLD + FADE; });
      st.forEach(function (s) {
        var a = (s === cur) ? 1 : Math.min(1, 1 - (now - s.end - HOLD) / FADE); if (a <= 0) return; ctx.globalAlpha = a;
        var p = s.p; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
        if (p.length < 3) { ctx.lineTo(p[p.length - 1][0] + 0.01, p[p.length - 1][1]); }
        else { for (var i = 1; i < p.length - 1; i++) { var mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my); } ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]); }
        ctx.stroke();
      });
      ctx.globalAlpha = 1; if (st.length) kick();
    }
    function kick() { if (!raf) raf = requestAnimationFrame(paint); }
    sec.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 || ev.pointerType !== 'mouse' || ev.target.closest('a,button,input,label,summary,details')) return;
      ev.preventDefault(); cur = { p: [pos(ev)], end: 0 }; st.push(cur); sec.classList.add('drawing', 'drew'); kick();
    });
    window.addEventListener('pointermove', function (ev) { if (!cur) return; var q = pos(ev), l = cur.p[cur.p.length - 1]; if (Math.abs(q[0] - l[0]) + Math.abs(q[1] - l[1]) > 1.5) { cur.p.push(q); kick(); } });
    window.addEventListener('pointerup', function () { if (!cur) return; cur.end = performance.now(); cur = null; sec.classList.remove('drawing'); kick(); });
    if (window.ResizeObserver) new ResizeObserver(size).observe(sec); size();
  }

  /* ---------- boot: a reload in the same tab skips the password ---------- */
  labelAria();
  renderMessage();
  var remembered = null;
  try { remembered = sessionStorage.getItem(SESSION_KEY); } catch (e) { /* private mode */ }
  if (remembered) {
    unlock(remembered, true).then(function (ok) { if (!ok) input.focus({ preventScroll: true }); });
  } else {
    input.focus({ preventScroll: true });
  }
})();
