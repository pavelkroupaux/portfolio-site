// Unlock + render. Nothing here can read the content without the password:
// the key is derived from it, and every blob is AES-GCM sealed.

const VAULT = window.VAULT;
const SESSION_KEY = 'portfolio.pw';

const gate = document.getElementById('gate');
const form = document.getElementById('gate-form');
const input = document.getElementById('password');
const submit = document.getElementById('gate-submit');
const message = document.getElementById('gate-message');
const app = document.getElementById('app');

let cryptoKey = null;
let data = null;
const assetCache = new Map(); // asset id -> blob URL
let listScroll = 0;

/* ------------------------------------------------------------------ crypto */

const fromBase64 = (b64) =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function deriveKey(password) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(VAULT.salt),
      iterations: VAULT.iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

// Throws on a wrong password: GCM authentication fails before anything decodes.
async function unseal(key, sealed) {
  const iv = sealed.slice(0, 12);
  const cipher = sealed.slice(12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
}

/* ------------------------------------------------------------------ unlock */

async function unlock(password, { silent = false } = {}) {
  if (!silent) {
    submit.disabled = true;
    setMessage('Unlocking...');
  }

  let key;
  try {
    key = await deriveKey(password);
    const plain = await unseal(key, fromBase64(VAULT.payload));
    data = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    submit.disabled = false;
    if (silent) {
      sessionStorage.removeItem(SESSION_KEY);
      setMessage('');
      return false;
    }
    setMessage('That password does not match.', 'error');
    form.classList.remove('field--wrong');
    void form.offsetWidth; // restart the animation
    form.classList.add('field--wrong');
    input.select();
    return false;
  }

  cryptoKey = key;
  try { sessionStorage.setItem(SESSION_KEY, password); } catch { /* private mode */ }

  gate.hidden = true;
  app.hidden = false;
  document.title = data.profile.name || 'Portfolio';
  route();
  return true;
}

function setMessage(text, state) {
  message.textContent = text;
  if (state) message.dataset.state = state;
  else delete message.dataset.state;
}

function lock() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
  for (const url of assetCache.values()) URL.revokeObjectURL(url);
  location.reload();
}

/* ------------------------------------------------------------------ assets */

async function assetUrl(id, type) {
  if (assetCache.has(id)) return assetCache.get(id);
  const response = await fetch(`a/${id}.enc`, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`asset ${id}: ${response.status}`);
  const plain = await unseal(cryptoKey, new Uint8Array(await response.arrayBuffer()));
  const url = URL.createObjectURL(new Blob([plain], { type: type || 'application/octet-stream' }));
  assetCache.set(id, url);
  return url;
}

const watcher = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    watcher.unobserve(entry.target);
    loadAsset(entry.target);
  }
}, { rootMargin: '400px 0px' });

async function loadAsset(img) {
  try {
    img.src = await assetUrl(img.dataset.asset, img.dataset.type);
    img.dataset.loaded = 'true';
  } catch {
    img.dataset.failed = 'true';
  }
}

// Images decrypt only when they are about to be seen.
function hydrateAssets(root) {
  for (const img of root.querySelectorAll('img[data-asset]:not([src])')) watcher.observe(img);
}

/* ------------------------------------------------------------------ render */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ARROW_LEFT = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>`;

function header() {
  const { name, email } = data.profile;
  return `
    <header class="site-header" id="site-header">
      <div class="wrap site-header__inner">
        <button class="site-header__name" data-nav="#/">${esc(name)}</button>
        <div class="site-header__right">
          ${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}
          <button class="lock-button" data-lock>Lock</button>
        </div>
      </div>
    </header>`;
}

function footer() {
  const { name, links } = data.profile;
  const year = new Date().getFullYear();
  return `
    <footer class="site-footer wrap">
      <span>&copy; ${year} ${esc(name)}. Private. Please do not share.</span>
      <span>${links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`).join(' &nbsp; ')}</span>
    </footer>`;
}

function card(project) {
  const meta = [project.client, project.role].filter(Boolean).join(' &middot; ');
  const frame = project.cover
    ? `<img data-asset="${esc(project.cover.id)}" data-type="${esc(project.cover.type)}" alt="${esc(project.title)}">`
    : '';
  return `
    <button class="card" data-nav="#/work/${encodeURIComponent(project.slug)}">
      <div class="card__frame${project.cover ? '' : ' card__frame--empty'}" data-initial="${esc(project.title.charAt(0))}">${frame}</div>
      <div class="card__body">
        <div class="card__row">
          <h3 class="card__title">${esc(project.title)}</h3>
          ${project.year ? `<span class="card__year">${esc(project.year)}</span>` : ''}
        </div>
        ${meta ? `<p class="card__meta">${meta}</p>` : ''}
        ${project.summary ? `<p class="card__summary">${esc(project.summary)}</p>` : ''}
        ${project.tags.length ? `<ul class="tags">${project.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      </div>
    </button>`;
}

function renderIndex() {
  const { name, role, location, intro, links } = data.profile;
  const meta = [
    location ? `<span>${esc(location)}</span>` : '',
    ...links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`),
  ].filter(Boolean).join('');

  app.innerHTML = `
    ${header()}
    <main>
      <section class="wrap hero">
        <h1 class="hero__name">${esc(name)}</h1>
        ${role ? `<p class="hero__role">${esc(role)}</p>` : ''}
        ${intro ? `<div class="hero__intro">${intro}</div>` : ''}
        ${meta ? `<div class="hero__meta">${meta}</div>` : ''}
      </section>
      <div class="wrap">
        <div class="section-head"><span>Selected work</span><span>${data.projects.length}</span></div>
        ${data.projects.length
          ? `<div class="work">${data.projects.map(card).join('')}</div>`
          : `<p class="empty">No case studies yet. Drop markdown files into <code>content/work/</code> and they show up here.</p>`}
      </div>
    </main>
    ${footer()}`;

  window.scrollTo(0, listScroll);
  listScroll = 0;
}

function renderProject(project) {
  const facts = [
    ['Client', project.client],
    ['Role', project.role],
    ['Year', project.year],
    ['Focus', project.tags.join(', ')],
  ].filter(([, value]) => value);

  app.innerHTML = `
    ${header()}
    <main class="wrap project">
      <button class="back" data-nav="#/">${ARROW_LEFT} All work</button>
      <h1 class="project__title">${esc(project.title)}</h1>
      ${project.summary ? `<p class="project__summary">${esc(project.summary)}</p>` : ''}
      ${facts.length ? `<div class="project__facts">${facts.map(([label, value]) => `
        <div class="fact"><p class="fact__label">${label}</p><p class="fact__value">${esc(value)}</p></div>`).join('')}</div>` : ''}
      <article class="prose">${project.body}</article>
    </main>
    ${footer()}`;

  window.scrollTo(0, 0);
}

function renderMissing() {
  app.innerHTML = `
    ${header()}
    <main class="wrap project">
      <button class="back" data-nav="#/">${ARROW_LEFT} All work</button>
      <h1 class="project__title">Not found</h1>
      <p class="project__summary">That project does not exist.</p>
    </main>
    ${footer()}`;
}

/* ----------------------------------------------------------------- routing */

function route() {
  if (!data) return;
  const match = location.hash.match(/^#\/work\/(.+)$/);
  if (match) {
    const slug = decodeURIComponent(match[1]);
    const project = data.projects.find((p) => p.slug === slug);
    project ? renderProject(project) : renderMissing();
  } else {
    renderIndex();
  }
  hydrateAssets(app);
  trackHeader();
}

function trackHeader() {
  const el = document.getElementById('site-header');
  if (!el) return;
  const update = () => { el.dataset.stuck = String(window.scrollY > 8); };
  update();
  window.addEventListener('scroll', update, { passive: true });
}

app.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    if (!location.hash.startsWith('#/work/')) listScroll = window.scrollY;
    location.hash = nav.dataset.nav;
    return;
  }
  if (event.target.closest('[data-lock]')) lock();
});

window.addEventListener('hashchange', route);

/* -------------------------------------------------------------------- boot */

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (input.value) unlock(input.value);
});

input.addEventListener('input', () => {
  if (message.dataset.state === 'error') setMessage('');
});

(async function boot() {
  let remembered = null;
  try { remembered = sessionStorage.getItem(SESSION_KEY); } catch { /* private mode */ }
  if (remembered && await unlock(remembered, { silent: true })) return;
  input.focus({ preventScroll: true });
})();
