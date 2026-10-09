// ImportReady UI: persistent shell, hash router with covered transitions, and four views.
import {
  EVIDENCE_STATUSES,
  NOT_FOUND,

  articleLabel,
  createNavigator,
  dossierDocuments,
  dossierFindings,
  escapeHtml as esc,
  hrefFor,
  packetReadiness,
  pageLabel,
  relationLabel,
  resolveRoute,
  safeUrl,
  statusById,
  withTimeout,
} from './core.mjs';
import { guide } from './character.mjs';
import { EXAMPLE_QUERIES, EXTRACTION_LABELS, NOT_COVERED, REGISTRY_FALLBACK, SHORT_NAMES } from './data.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const main = $('#main');
const cover = $('.cover');
const nav = $('#site-nav');
const menuButton = $('.menu-button');
const motionToggle = $('.motion-toggle');

// ------------------------------------------------------------------------------------------ motion
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const MOTION_KEY = 'importready.ui.v1.motion-paused';
let motionPaused = readPaused();

function readPaused() {
  try {
    return window.localStorage.getItem(MOTION_KEY) === '1';
  } catch {
    return false;
  }
}
// Read the preference at use time: it can change while the page is open.
const motionAllowed = () => !reducedMotion.matches && !motionPaused;
function applyMotion() {
  document.documentElement.classList.toggle('motion-on', motionAllowed());
  motionToggle.setAttribute('aria-pressed', String(motionPaused));
  $('.motion-label', motionToggle).textContent = motionPaused ? 'Resume motion' : 'Pause motion';
  motionToggle.hidden = reducedMotion.matches; // nothing to pause when the system already reduces motion
}
motionToggle.addEventListener('click', () => {
  motionPaused = !motionPaused;
  try {
    window.localStorage.setItem(MOTION_KEY, motionPaused ? '1' : '0');
  } catch {
    // Storage may be blocked; the choice still applies for this visit.
  }
  applyMotion();
});
reducedMotion.addEventListener('change', applyMotion);

// ------------------------------------------------------------------------------------------ menu
function setMenu(open, { restoreFocus = false } = {}) {
  menuButton.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('is-open', open);
  if (!open && restoreFocus) menuButton.focus();
}
menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && nav.classList.contains('is-open')) setMenu(false, { restoreFocus: true });
});

// ------------------------------------------------------------------------------------------ api
async function api(path, { signal, timeout = 90000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  try {
    const response = await fetch(path, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const type = response.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await response.json() : null;
    if (!body) throw Object.assign(new Error('The search service is not running.'), { kind: 'offline' });
    if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status}).`), { kind: 'http' });
    return body;
  } catch (error) {
    if (error.kind) throw error;
    if (signal?.aborted) throw Object.assign(new Error('Cancelled.'), { kind: 'cancelled' });
    if (controller.signal.aborted) throw Object.assign(new Error('The search took too long.'), { kind: 'timeout' });
    throw Object.assign(new Error('The search service is not running.'), { kind: 'offline' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

// ------------------------------------------------------------------------------------------ views
const ui = {
  dossier: { tab: 0, correctedReport: false, wireless: 'unknown' },
  ask: { lastQuery: '', history: false, expand: true, doc: '' },
};

const shortName = (id) => SHORT_NAMES[id] || id;

const VIEWS = {
  home: () => ({
    html: `
    <div class="wrap">
      <section class="hero" aria-labelledby="page-title">
        <div class="hero-copy">
          <p class="label">Jordan import preparation</p>
          <h1 id="page-title" tabindex="-1">Making import preparation <em>easier.</em></h1>
          <p class="lede">Find the provision that applies to your shipment, see exactly which article and page it comes from, and know what is still uncertain, in Arabic or English.</p>
          <div class="actions">
            <a class="button button-primary" href="#/ask" data-route-link>Ask the regulations</a>
            <a class="button button-quiet" href="#/dossier" data-route-link>Walk a sample dossier</a>
          </div>
          <p class="honest"><span>Official sources only</span><span>Every result cited</span><span>Uncertainty stays visible</span></p>
        </div>
        <div class="hero-art">
          <div class="back-sheet"></div>
          ${guide({ pose: 'wave' })}
          <div class="note-sheet" aria-hidden="true"><p>A clearer<br><em>next step.</em></p><small>Less searching. Less repetition.</small></div>
        </div>
      </section>

      <section class="section" aria-labelledby="today">
        <div class="section-head">
          <p class="label">Working today</p>
          <h2 id="today">Evidence, <em>not</em> paraphrase.</h2>
          <p>The prototype searches four official instruments. It never writes an answer for you: it shows the provisions themselves and says how sure it can be about them.</p>
        </div>
        <div class="grid">
          <article class="sheet card"><span class="chip chip-accent">Built</span><h3>Ask in either language</h3>
            <p>An English question finds the Arabic article that answers it, and the reverse. Naming an article, such as “المادة 9 من قانون الاستيراد والتصدير”, opens that exact provision.</p></article>
          <article class="sheet card"><span class="chip chip-accent">Built</span><h3>Cited down to the page</h3>
            <p>Each result carries its instrument, article, page, file version and a link to the official PDF, plus the definitions and articles it relies on.</p></article>
          <article class="sheet card"><span class="chip chip-accent">Built</span><h3>Doubt is labelled</h3>
            <p>Unverified legal status, text recovered from damaged PDFs and superseded amendment wording are flagged, never silently mixed in.</p></article>
        </div>
      </section>

      <section class="section" aria-labelledby="next">
        <div class="section-head">
          <p class="label">Where it is going</p>
          <h2 id="next">A dossier becomes a <em>review packet.</em></h2>
          <p>The proposed workflow. Try it with an invented kettle shipment on the Dossier page.</p>
        </div>
        <ol class="workflow" role="list">
          ${[
            ['i.', 'Upload', 'Supplier files and shipment context.'],
            ['ii.', 'Confirm', 'Extracted product facts, each with its source page.'],
            ['iii.', 'Check', 'Reviewed requirements and conflicts in the evidence.'],
            ['iv.', 'Prepare', 'Draft fields, open tasks and an attachment index.'],
          ]
            .map(([n, t, p]) => `<li class="sheet card"><span class="ordinal" aria-hidden="true">${n}</span><h3>${t}</h3><p>${p}</p></li>`)
            .join('')}
        </ol>
      </section>

      <section class="closing" aria-labelledby="closing">
        <div><h2 id="closing">One dossier. <em>Less effort.</em></h2>
          <p>People keep every decision. Importers and brokers review the packet and submit through the official channels.</p></div>
        <a class="button button-primary" href="#/ask" data-route-link>Start with a question</a>
      </section>
    </div>`,
  }),

  ask: ({ params }) => ({
    html: `
    <div class="wrap">
      <section class="page-head ask-layout" aria-labelledby="page-title">
        <div class="enter-group">
          <p class="label">Evidence search</p>
          <h1 id="page-title" tabindex="-1">Ask the <em>regulations.</em></h1>
          <p class="lede">Search four official Jordanian instruments in Arabic or English. You get the provisions themselves, with citations. Nothing is generated.</p>
          <form class="search-form" role="search" novalidate>
            <label for="q">Your question</label>
            <div class="search-box">
              <textarea id="q" name="q" rows="2" maxlength="500" dir="auto" placeholder="e.g. ما هي رسوم اصدار رخصة الاستيراد؟ or: Who issues import licences for farm inputs?"></textarea>
              <button class="button button-primary" type="submit">Search evidence</button>
            </div>
            <div class="examples"><span>Try:</span>${EXAMPLE_QUERIES.map(
              (e) => `<button type="button" class="example" lang="${e.lang}" dir="auto" data-example="${esc(e.text)}">${esc(e.text)}</button>`,
            ).join('')}</div>
            <details class="options">
              <summary>Search options</summary>
              <div class="options-body">
                <label>Instrument <select name="doc"><option value="">All four</option>${REGISTRY_FALLBACK.map(
                  (d) => `<option value="${esc(d.id)}">${esc(shortName(d.id))}</option>`,
                ).join('')}</select></label>
                <label><input type="checkbox" name="expand" checked> Add definitions and referenced articles</label>
                <label><input type="checkbox" name="history"> Include amendment notes (may quote superseded text)</label>
              </div>
            </details>
            <p class="service-status" data-state="checking" role="status">Checking the search service…</p>
          </form>
        </div>
        ${guide({ pose: 'search' })}
      </section>
      <section class="results" aria-live="polite" aria-busy="false"></section>
    </div>`,
    mount(root) {
      const form = $('.search-form', root);
      const textarea = $('#q', root);
      const results = $('.results', root);
      const status = $('.service-status', root);
      let controller = null;

      form.elements.history.checked = ui.ask.history;
      form.elements.expand.checked = ui.ask.expand;
      form.elements.doc.value = ui.ask.doc;

      api('/api/health', { timeout: 8000 })
        .then((h) => {
          status.dataset.state = 'live';
          status.textContent = `Search service ready: ${h.documents} instruments, ${h.chunks} passages, ${h.embedding_model}${h.reranker_model ? ' + reranker' : ''}.`;
        })
        .catch(() => {
          status.dataset.state = 'offline';
          status.textContent = 'Search service offline. Start it with: uv run import-compliance-rag serve';
        });

      async function run(query) {
        controller?.abort();
        controller = new AbortController();
        const mine = controller;
        ui.ask = { lastQuery: query, history: form.elements.history.checked, expand: form.elements.expand.checked, doc: form.elements.doc.value };
        const params = new URLSearchParams({ q: query, top_k: '8', expand: ui.ask.expand ? '1' : '0', history: ui.ask.history ? '1' : '0' });
        if (ui.ask.doc) params.append('doc', ui.ask.doc);
        // Keep the URL shareable without triggering navigation.
        const hash = hrefFor('ask', { q: query });
        history.replaceState(history.state, '', hash);
        router.renderedHash = hash;

        const submit = $('button[type="submit"]', form);
        submit.disabled = true;
        results.setAttribute('aria-busy', 'true');
        results.innerHTML = `<div class="searching">${guide({ pose: 'search', className: 'is-quiet' })}<p>Searching the four instruments…</p></div>`;
        try {
          const pkg = await api(`/api/search?${params}`, { signal: mine.signal });
          if (mine !== controller) return;
          results.innerHTML = renderResults(pkg);
        } catch (error) {
          if (error.kind === 'cancelled' || mine !== controller) return;
          results.innerHTML = renderSearchError(error);
        } finally {
          if (mine === controller) {
            submit.disabled = false;
            results.setAttribute('aria-busy', 'false');
          }
        }
      }

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const query = textarea.value.trim();
        if (!query) {
          textarea.focus();
          results.innerHTML = `<p class="results-summary">Type a question first, in Arabic or English.</p>`;
          return;
        }
        run(query);
      });
      textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          form.requestSubmit();
        }
      });
      root.addEventListener('click', (event) => {
        const example = event.target.closest('[data-example]');
        if (example) {
          textarea.value = example.dataset.example;
          run(textarea.value);
          return;
        }
        const more = event.target.closest('[data-more]');
        if (more) {
          const text = more.previousElementSibling;
          const open = more.getAttribute('aria-expanded') !== 'true';
          text.classList.toggle('is-clamped', !open);
          more.setAttribute('aria-expanded', String(open));
          more.textContent = open ? 'Show less' : 'Show full text';
        }
      });

      const initial = params.get('q') || '';
      if (initial) {
        textarea.value = initial;
        run(initial);
      }
      return () => controller?.abort();
    },
  }),

  dossier: () => ({
    html: `
    <div class="wrap">
      <section class="page-head" aria-labelledby="page-title">
        <p class="label">Proposed workflow · synthetic example</p>
        <h1 id="page-title" tabindex="-1">A dossier becomes a <em>review packet.</em></h1>
        <p class="lede">Walk through the proposed workflow with an invented kettle shipment. Change the evidence and watch the findings follow.</p>
        <p class="demo-banner"><strong>Demonstration only.</strong> The documents, model numbers and findings below are synthetic. No real file is read and no real requirement is evaluated.</p>
      </section>
      <div class="tabs" role="tablist" aria-label="Dossier steps">
        ${['Upload', 'Confirm', 'Check', 'Prepare']
          .map(
            (t, i) => `<button class="tab" role="tab" id="tab-${i}" aria-controls="panel" data-tab="${i}"><span class="tab-n" aria-hidden="true">${['i.', 'ii.', 'iii.', 'iv.'][i]}</span>${t}</button>`,
          )
          .join('')}
      </div>
      <div class="dossier-layout">
        <section id="panel" class="tab-panel" role="tabpanel" tabindex="0"></section>
        ${guide({ pose: 'stamp' })}
      </div>
      <section class="section" aria-labelledby="statuses">
        <div class="section-head"><h2 id="statuses">Evidence status stays separate from <em>clearance.</em></h2>
          <p>Every finding uses one of five statuses. None of them means “compliant”: authorities decide that.</p></div>
        <ul class="legend" role="list">
          ${EVIDENCE_STATUSES.map((s) => `<li class="sheet">${statusTag(s.id)}<p>${esc(s.help)}</p></li>`).join('')}
        </ul>
      </section>
    </div>`,
    mount(root) {
      const panel = $('#panel', root);
      const tabs = $$('[role="tab"]', root);
      const draw = () => {
        tabs.forEach((tab, i) => {
          const selected = i === ui.dossier.tab;
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;
        });
        panel.setAttribute('aria-labelledby', `tab-${ui.dossier.tab}`);
        panel.innerHTML = renderDossierPanel(ui.dossier.tab);
      };
      tabs.forEach((tab) =>
        tab.addEventListener('click', () => {
          ui.dossier.tab = Number(tab.dataset.tab);
          draw();
        }),
      );
      $('[role="tablist"]', root).addEventListener('keydown', (event) => {
        const keys = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
        if (!(event.key in keys)) return;
        event.preventDefault();
        const step = keys[event.key];
        const next = Number.isFinite(step) ? (ui.dossier.tab + step + tabs.length) % tabs.length : step < 0 ? 0 : tabs.length - 1;
        ui.dossier.tab = next;
        draw();
        tabs[next].focus();
      });
      panel.addEventListener('change', (event) => {
        const input = event.target;
        if (input.name === 'corrected') ui.dossier.correctedReport = input.checked;
        if (input.name === 'wireless') ui.dossier.wireless = input.value;
        const focusName = input.name;
        const focusValue = input.value;
        draw();
        // Keep focus on the control the user just changed.
        const again = $(`[name="${focusName}"]${input.type === 'radio' ? `[value="${focusValue}"]` : ''}`, panel);
        again?.focus();
      });
      panel.addEventListener('click', (event) => {
        const go = event.target.closest('[data-goto-tab]');
        if (!go) return;
        ui.dossier.tab = Number(go.dataset.gotoTab);
        draw();
        tabs[ui.dossier.tab].focus();
      });
      draw();
    },
  }),

  sources: () => ({
    html: `
    <div class="wrap">
      <section class="page-head sources-layout" aria-labelledby="page-title">
        <div>
          <p class="label">The corpus</p>
          <h1 id="page-title" tabindex="-1">Four official instruments, <em>clearly bounded.</em></h1>
          <p class="lede">Everything the search can show you comes from these documents. None of them has been verified as current yet, so every result says so.</p>
          <p class="service-status" data-state="checking" role="status">Loading the source register…</p>
        </div>
        ${guide({ pose: 'shelf' })}
      </section>
      <ul class="source-list" role="list"></ul>
      <section class="section" aria-labelledby="uncovered">
        <div class="section-head"><p class="label">Not covered yet</p>
          <h2 id="uncovered">Questions these sources <em>cannot</em> answer.</h2>
          <p>Search may still return the closest provisions from the four instruments; they do not answer questions on these topics.</p></div>
        <ul class="uncovered" role="list">${NOT_COVERED.map(
          (n) => `<li class="sheet"><h3>${esc(n.title)}</h3><p>${esc(n.why)}</p></li>`,
        ).join('')}</ul>
      </section>
    </div>`,
    mount(root) {
      const list = $('.source-list', root);
      const status = $('.service-status', root);
      const controller = new AbortController();
      list.innerHTML = REGISTRY_FALLBACK.map((d) => renderSource(d, false)).join('');
      api('/api/sources', { signal: controller.signal, timeout: 10000 })
        .then((rows) => {
          list.innerHTML = rows.map((d) => renderSource(d, true)).join('');
          status.dataset.state = 'live';
          status.textContent = 'Live from the database: active versions and passage counts.';
        })
        .catch((error) => {
          if (error.kind === 'cancelled') return;
          status.dataset.state = 'offline';
          status.textContent = 'Showing the registry file. Start the search service for versions and passage counts.';
        });
      return () => controller.abort();
    },
  }),

  notfound: ({ path }) => ({
    html: `
    <div class="wrap">
      <section class="lost" aria-labelledby="page-title">
        <div class="page-head">
          <p class="label">Unknown page</p>
          <h1 id="page-title" tabindex="-1">This page is not <em>in the packet.</em></h1>
          <p class="lede">Nothing lives at <code>${esc(path)}</code>. Pick up from the overview or ask a question.</p>
          <div class="actions"><a class="button button-primary" href="#/" data-route-link>Back to the overview</a>
            <a class="button button-quiet" href="#/ask" data-route-link>Ask the regulations</a></div>
        </div>
        ${guide({ pose: 'shrug' })}
      </section>
    </div>`,
  }),
};

// ------------------------------------------------------------------------------------------ renderers
function statusTag(id) {
  const s = statusById(id);
  return `<span class="status status-${s.id}"><span class="mark" aria-hidden="true">${s.mark}</span>${esc(s.label)}</span>`;
}

function renderSearchError(error) {
  if (error.kind === 'offline') {
    return `<div class="sheet notice">${guide({ pose: 'shrug', className: 'is-quiet' })}<div>
      <h2>The search service is <em>not running.</em></h2>
      <p>This page needs the local service. In the project folder run <code>uv run import-compliance-rag serve</code>, then open <code>http://127.0.0.1:8765/</code>.</p></div></div>`;
  }
  return `<div class="sheet notice">${guide({ pose: 'shrug', className: 'is-quiet' })}<div>
    <h2>That search <em>did not finish.</em></h2><p>${esc(error.message)}</p></div></div>`;
}

function renderResults(pkg) {
  const items = pkg.items || [];
  const warnings = (pkg.warnings || []).map((w) => `<li>${esc(w)}</li>`).join('');
  if (!items.length) {
    return `<p class="results-summary">No evidence found for <strong dir="auto">${esc(pkg.query)}</strong>.</p>${warnings ? `<ul class="caveats">${warnings}</ul>` : ''}`;
  }
  // Caveats every item shares are stated once; each card lists only what is specific to it.
  const shared = items.map((i) => new Set(i.caveats)).reduce((a, b) => new Set([...a].filter((c) => b.has(c))));
  const retrieved = items.filter((i) => i.relation === 'retrieved');
  const ordered = [];
  for (const item of retrieved) {
    ordered.push(item);
    ordered.push(...items.filter((c) => c.relation !== 'retrieved' && c.related_to === item.chunk_id));
  }
  ordered.push(...items.filter((c) => !ordered.includes(c)));
  const number = new Map(retrieved.map((item, i) => [item.chunk_id, i + 1]));

  return `
    <p class="results-summary"><strong>${retrieved.length} provisions</strong> for <strong dir="auto">${esc(pkg.query)}</strong>${
      items.length > retrieved.length ? `, with ${items.length - retrieved.length} supporting passages` : ''
    }. Read them in full before relying on them.</p>
    ${shared.size ? `<details class="caveats sheet" open><summary>Applies to every result</summary><ul>${[...shared].map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
    ${warnings ? `<ul class="caveats">${warnings}</ul>` : ''}
    <ol class="evidence-list" role="list">${ordered.map((item) => renderEvidence(item, number, shared)).join('')}</ol>`;
}

function renderEvidence(item, number, shared) {
  const c = item.citation;
  const context = item.relation !== 'retrieved';
  const exact = !context && item.signal?.exact_reference;
  const where = articleLabel(c);
  const parent = context && number.get(item.related_to);
  const own = item.caveats.filter((x) => !shared.has(x));
  const url = safeUrl(c.source_url);
  const long = item.text_original.length > 520;
  const lang = c.language === 'en' ? 'en' : 'ar';
  return `<li class="evidence${context ? ' is-context' : ''}${exact ? ' is-exact' : ''}">
    <div class="evidence-head">
      <h3>${!context ? `<span class="visually-hidden">Result ${number.get(item.chunk_id)}: </span>` : ''}${esc(shortName(c.document_id))}${
        where ? `<span class="where">${esc(where)}</span>` : ''
      }</h3>
      <div class="evidence-chips">
        <span class="chip ${context ? 'chip-sage' : exact ? 'chip-accent' : ''}">${esc(relationLabel(item))}${parent ? ` · for result ${parent}` : ''}</span>
        ${item.chunk_type === 'definitions' && !context ? '<span class="chip">Definition</span>' : ''}
        ${item.chunk_type === 'amendment_history' ? '<span class="chip chip-warn">Amendment note</span>' : ''}
        ${c.page_start ? `<span class="chip">${esc(pageLabel(c.page_start, c.page_end))}</span>` : ''}
      </div>
    </div>
    <p class="evidence-text${long ? ' is-clamped' : ''}" lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">${esc(item.text_original)}</p>
    ${long ? '<button type="button" class="link-button" data-more aria-expanded="false">Show full text</button>' : ''}
    <div class="evidence-meta">
      <span>${esc(c.document_type)} · ${esc(c.binding_nature)}</span>
      <span>Version ${esc(c.version_label)}</span>
      <span>${esc(EXTRACTION_LABELS[c.extraction_method] || c.extraction_method)}</span>
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Official PDF<span class="visually-hidden"> (opens in a new tab)</span> ↗</a>` : ''}
    </div>
    ${own.length ? `<details class="caveats"><summary>${own.length} caveat${own.length > 1 ? 's' : ''} for this passage</summary><ul>${own.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
  </li>`;
}

function renderSource(d, live) {
  const url = safeUrl(d.official_url);
  return `<li class="sheet source">
    <p class="ar-title" ${d.original_language === 'ar' ? 'lang="ar" dir="rtl"' : 'lang="en"'}>${esc(d.title_original)}</p>
    ${d.title_en && d.original_language === 'ar' ? `<p class="en-title">${esc(d.title_en)}</p>` : ''}
    <div class="evidence-chips"><span class="chip">${esc(d.document_type)}</span><span class="chip">${esc(d.binding_nature)}</span>
      <span class="chip chip-warn">Legal status: ${d.legal_status === 'unknown' ? 'not verified' : esc(d.legal_status)}</span></div>
    <dl>
      <dt>Issued by</dt><dd>${esc(d.issuing_authority)}</dd>
      ${d.gazette_reference ? `<dt>Gazette</dt><dd>${esc(d.gazette_reference)}</dd>` : ''}
      ${d.amendment_info ? `<dt>Amendments</dt><dd>${esc(d.amendment_info)}</dd>` : ''}
      ${live && d.extraction_method ? `<dt>Text</dt><dd>${esc(EXTRACTION_LABELS[d.extraction_method] || d.extraction_method)}</dd>` : ''}
      ${live && d.version_label ? `<dt>Version</dt><dd>${esc(d.version_label)} · ${esc(d.page_count)} pages · ${esc(d.chunks)} passages</dd>` : ''}
    </dl>
    <div class="card-foot">${url ? `<a class="button button-quiet" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Official PDF<span class="visually-hidden"> (opens in a new tab)</span> ↗</a>` : ''}
      <a class="button button-quiet" href="${esc(hrefFor('ask'))}" data-route-link>Search it</a></div>
  </li>`;
}

function renderDossierPanel(tab) {
  const state = ui.dossier;
  const docs = dossierDocuments(state);
  const findings = dossierFindings(state);
  const readiness = packetReadiness(findings);
  const next = (n, label) => `<div class="actions"><button type="button" class="button button-quiet" data-goto-tab="${n}">${label} →</button></div>`;

  if (tab === 0) {
    return `<div class="packet">
      <h2 class="visually-hidden">Upload</h2>
      <p class="lede">Three supplier files arrive for one product: an electric kettle, model <strong>KT-200</strong>.</p>
      <ul class="docs" role="list">${docs
        .map(
          (d) => `<li class="doc${d.model !== 'KT-200' ? ' is-mismatch' : ''}"><span class="doc-label">${esc(d.label)}, page ${d.page}</span>
          <span class="model">${esc(d.model)}</span><span class="doc-label">${d.id === 'report' ? 'Report’s model' : 'Product model'}</span></li>`,
        )
        .join('')}</ul>
      <div class="toggle-row"><label><input type="checkbox" name="corrected" ${state.correctedReport ? 'checked' : ''}> Use the corrected test report from the supplier</label></div>
      ${next(1, 'Confirm the facts')}
    </div>`;
  }
  if (tab === 1) {
    const choice = (v, l) => `<label><input type="radio" name="wireless" value="${v}" ${state.wireless === v ? 'checked' : ''}> ${l}</label>`;
    return `<div class="packet">
      <h2 class="visually-hidden">Confirm</h2>
      <p class="lede">Extracted facts are confirmed by a person, each next to the page it came from. <em>A missing field stays unknown.</em></p>
      <div class="table-scroll" role="region" aria-label="Product facts" tabindex="0"><table class="facts">
        <thead><tr><th scope="col">Fact</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead>
        <tbody>
          <tr><th scope="row">Product model</th><td>KT-200</td><td>Invoice p. 1 · Specification p. 1</td></tr>
          <tr><th scope="row">Product</th><td>Electric kettle, household use</td><td>Specification p. 1</td></tr>
          <tr><th scope="row">Condition</th><td>New</td><td>Invoice p. 1</td></tr>
          <tr><th scope="row">Wireless functions</th><td><fieldset><legend class="visually-hidden">Wireless functions</legend>${choice('unknown', 'Unknown')}${choice('no', 'No')}${choice('yes', 'Yes')}</fieldset></td>
            <td>${state.wireless === 'unknown' ? 'Not stated in any file' : 'Confirmed by the import employee'}</td></tr>
        </tbody></table></div>
      ${next(2, 'Check the evidence')}
    </div>`;
  }
  if (tab === 2) {
    return `<div class="findings">
      <h2 class="visually-hidden">Check</h2>
      ${findings
        .map(
          (f) => `<article class="sheet finding">${statusTag(f.status)}<h3>${esc(f.title)}</h3><p>${esc(f.detail)}</p>
          <dl><dt>Evidence</dt><dd>${esc(f.evidence)}</dd><dt>Why it matters</dt><dd>${esc(f.why)}</dd>
          <dt>Next action</dt><dd>${esc(f.action)}</dd><dt>Responsible</dt><dd>${esc(f.owner)}</dd></dl></article>`,
        )
        .join('')}
      ${next(3, 'Prepare the packet')}
    </div>`;
  }
  return `<div class="sheet ${readiness.ready ? 'lime' : ''} packet">
    <h2 class="readiness">${readiness.ready ? 'Ready for <em>human review.</em>' : `Not ready: ${readiness.open.length} open task${readiness.open.length > 1 ? 's' : ''}.`}</h2>
    ${
      readiness.open.length
        ? `<ul>${readiness.open.map((f) => `<li><strong>${esc(f.action)}</strong> (${esc(f.owner)})</li>`).join('')}</ul>
           <p>Change the evidence in <button type="button" class="link-button" data-goto-tab="0">Upload</button> or the facts in <button type="button" class="link-button" data-goto-tab="1">Confirm</button> to resolve them.</p>`
        : '<p>No open findings remain in this synthetic dossier.</p>'
    }
    <div><h3>Attachment index</h3><ul>${docs.map((d) => `<li>${esc(d.label)}, page ${d.page}: ${esc(d.model)}</li>`).join('')}</ul></div>
    <p>The importer and the customs broker review the packet and submit through the official channels. ImportReady prepares; it does not submit, and authority decisions, inspection and testing keep their roles.</p>
  </div>`;
}

// ------------------------------------------------------------------------------------------ router
const router = { renderedHash: null, pendingHash: null, teardown: null, coverAnimations: [] };

const normalize = (hash) => {
  const { path, params } = resolveRoute(hash);
  const query = params.toString();
  return `#${path}${query ? `?${query}` : ''}`;
};

function commit(target, { focus = true } = {}) {
  router.teardown?.();
  router.teardown = null;
  const view = (VIEWS[target.route.id] || VIEWS.notfound)(target);
  main.innerHTML = view.html;
  if (motionAllowed()) $('.hero-copy, .page-head > div, .page-head', main)?.classList.add('enter');
  router.teardown = view.mount?.(main) || null;

  document.title = target.route === NOT_FOUND ? 'Page not found · ImportReady' : `${target.route.title} · ImportReady`;
  $$('[data-route]', nav).forEach((link) => {
    if (link.dataset.route === target.route.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (target.push && location.hash !== target.hash) history.pushState(null, '', target.hash);
  router.renderedHash = target.hash;
  setMenu(false);
  window.scrollTo(0, 0);
  // The new content is live as soon as it is committed (the cover above it is decorative and has
  // nothing focusable); inert content could not receive the heading focus.
  main.inert = false;
  if (focus) $('h1', main)?.focus({ preventScroll: true });
}

function animate(element, keyframes, options) {
  const animation = element.animate(keyframes, { fill: 'forwards', easing: 'cubic-bezier(.16,1,.3,1)', ...options });
  router.coverAnimations.push(animation);
  return animation.finished;
}

function stopCoverAnimations() {
  router.coverAnimations.forEach((a) => a.cancel());
  router.coverAnimations = [];
}

// Choreography: cover ~290ms, commit, reveal ~320ms (about 0.6s in total). Each phase is bounded by a
// timeout so a throttled or stuck animation can never hold the cover over the page.
const navigate = createNavigator({
  async cover(target) {
    const back = $('.cover-back', cover);
    const front = $('.cover-front', cover);
    const from = (el) => getComputedStyle(el).transform; // continue from wherever a superseded cover was
    const start = [from(back), from(front)];
    stopCoverAnimations();
    $('.cover-scene', cover).innerHTML = guide({ pose: target.route.scene });
    $('.cover-caption', cover).textContent = target.route.caption;
    cover.hidden = false;
    main.inert = true;
    await withTimeout(
      Promise.all([
        animate(back, [{ transform: start[0] }, { transform: 'translateY(0) rotate(-1.5deg)' }], { duration: 220 }),
        animate(front, [{ transform: start[1] }, { transform: 'translateY(0)' }], { duration: 260, delay: 30 }),
      ]),
      700,
    );
  },
  commit: (target) => commit(target, { focus: true }),
  async reveal() {
    const back = $('.cover-back', cover);
    const front = $('.cover-front', cover);
    await withTimeout(
      Promise.all([
        animate(front, [{ transform: 'translateY(0)' }, { transform: 'translateY(-105%)' }], { duration: 240, delay: 40 }),
        animate(back, [{ transform: 'translateY(0) rotate(-1.5deg)' }, { transform: 'translateY(-105%) rotate(-3deg)' }], { duration: 260, delay: 60 }),
      ]),
      700,
    );
  },
  cleanup() {
    stopCoverAnimations();
    cover.hidden = true;
    main.inert = false;
    router.pendingHash = null;
  },
});

function request(hash, { push = true } = {}) {
  const normalized = normalize(hash);
  const target = { ...resolveRoute(normalized), hash: normalized, push };
  if (normalized === router.pendingHash) return;
  if (!router.pendingHash && normalized === router.renderedHash) {
    setMenu(false);
    return;
  }
  router.pendingHash = normalized;
  // A hidden document does not advance animations; commit directly instead of waiting on timeouts.
  navigate(target, !motionAllowed() || document.hidden);
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#/"]');
  if (!link || event.defaultPrevented) return;
  // Let the browser handle new-tab and other modified clicks.
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  request(link.getAttribute('href'));
});

// Back/Forward and manual hash edits. Both events may fire for one change; the comparison dedupes.
const sync = () => {
  const hash = normalize(location.hash || '#/');
  if (hash !== (router.pendingHash ?? router.renderedHash)) request(hash, { push: false });
};
window.addEventListener('popstate', sync);
window.addEventListener('hashchange', sync);

// ------------------------------------------------------------------------------------------ boot
applyMotion();
const first = normalize(location.hash || '#/');
commit({ ...resolveRoute(first), hash: first, push: false }, { focus: false });
