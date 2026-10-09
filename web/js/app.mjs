// MUTABIQ UI: persistent shell, hash router with covered transitions, and the views.
import {
  COMPANY,
  MODEL,
  NOT_FOUND,
  STATUSES,
  TEST_REPORT_OPTIONS,
  articleLabel,
  assessmentFindings,
  createNavigator,
  escapeHtml as esc,
  evidenceFiles,
  extractedData,
  hrefFor,
  pageLabel,
  parseEirp,
  readiness,
  relationLabel,
  resolveRoute,
  safeUrl,
  statusById,
  withTimeout,
} from './core.mjs';
import { guide, mark } from './character.mjs';
import { icon } from './icons.mjs';
import {
  EXAMPLE_QUERIES,
  EXTRACTION_LABELS,
  NOT_COVERED,
  QUESTIONS,
  REGISTRY_FALLBACK,
  REGULATORS,
  SAFEGUARDS,
  SHORT_NAMES,
  STEPS,
} from './data.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const main = $('#main');
const cover = $('.cover');
const nav = $('#site-nav');
const menuButton = $('.menu-button');
const motionToggle = $('.motion-toggle');

// ------------------------------------------------------------------------------------------ motion
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const MOTION_KEY = 'mutabiq.ui.v1.motion-paused';
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

// ------------------------------------------------------------------------------------------ state
const ui = {
  assessment: { tab: 0, eirp: '', testReport: 'none', ran: false },
  ask: { history: false, expand: true, doc: '' },
};
const shortName = (id) => SHORT_NAMES[id] || id;

function statusTag(id, { count } = {}) {
  const s = statusById(id);
  return `<span class="status status-${s.id}"><span class="mark" aria-hidden="true">${s.mark}</span>${esc(s.label)}${
    count !== undefined ? ` <span class="mono">${count}</span>` : ''
  }</span>`;
}

/** Hero illustration: requirements (grey bars) matched to evidence (teal links), row by row. */
function matchingLines() {
  const widths = [150, 190, 210, 160, 230, 180, 200, 150, 220, 170, 190, 140];
  const rows = widths
    .map((w, i) => {
      const indent = [2, 1, 0][i % 3] * 40;
      const y = 26 + i * 46;
      const x = 24 + indent;
      const linkEnd = x + 22 + Math.round(w * 0.85);
      const len = Math.round(linkEnd - (x - 8) + 14);
      const gold = i % 4 === 3;
      return `<circle class="m-dot${gold ? ' gold' : ''}" cx="${x}" cy="${y}" r="5"/>
        <rect class="m-bar" x="${x + 16}" y="${y - 5}" width="${w}" height="10" rx="5"/>
        <path class="m-link" style="--len:${len};--delay:${(i * 0.42).toFixed(2)}s" d="M${x - 8} ${y + 11}Q${x - 8} ${y + 22} ${x + 4} ${y + 22}H${linkEnd}"/>
        ${i % 4 === 3 ? `<line class="m-sep" x1="${x + 30}" y1="${y + 34}" x2="350" y2="${y + 34}"/>` : ''}`;
    })
    .join('');
  return `<svg class="matching" viewBox="0 0 380 570" aria-hidden="true" focusable="false">${rows}</svg>`;
}

function readinessCard(items, { pct, left, right, title = 'Application readiness' }) {
  return `<div class="readiness-card">
    <div class="rc-head">${mark('brand-mark small')}${esc(title)}</div>
    <ul class="readiness-list">${items
      .map(
        ([label, done]) => `<li><span class="bullet" aria-hidden="true"></span><span>${esc(label)}</span>
          <span class="tick${done ? '' : ' open'}">${done ? '✓<span class="visually-hidden"> done</span>' : '…<span class="visually-hidden"> open</span>'}</span></li>`,
      )
      .join('')}</ul>
    <div class="progress" role="img" aria-label="${pct}% complete"><span style="width:${pct}%"></span></div>
    <div class="readiness-foot"><span>${esc(left)}</span><strong>${esc(right)}</strong></div>
  </div>`;
}

// ------------------------------------------------------------------------------------------ views
const VIEWS = {
  home: () => ({
    html: `
    <section class="band-dark on-dark hero" aria-labelledby="page-title">
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <div class="chips"><span class="chip chip-dark-teal">Team ZAA</span><span class="chip chip-dark-gold">AI Quest 2026</span></div>
          <h1 id="page-title" tabindex="-1">Every requirement, <span class="accent-text">backed by evidence.</span></h1>
          <p class="tagline-ar" lang="ar" dir="rtl">كل متطلب، له دليل.</p>
          <p class="lede">AI-powered regulatory compliance and application preparation for products entering the Jordanian market.</p>
          <div class="actions">
            <a class="button button-primary" href="#/assessment" data-route-link>Start an assessment ${icon('arrow')}</a>
            <a class="button button-secondary" href="#/ask" data-route-link>Search the regulations</a>
          </div>
        </div>
        ${matchingLines()}
      </div>
    </section>

    <div class="wrap">
      <section class="section problem" aria-labelledby="problem">
        <div>
          <p class="eyebrow">The problem</p>
          <h2 id="problem" style="font-size:var(--step-3);margin-top:.6rem">One product. Several regulators. Scattered requirements.</h2>
          <p class="lede" style="margin-top:1rem">Before a regulated product reaches the Jordanian market, someone in the importing company has to answer, mostly by hand:</p>
          <ol class="plain-list questions">${QUESTIONS.map((q, i) => `<li><span class="num" aria-hidden="true">${i + 1}</span>${esc(q)}</li>`).join('')}</ol>
        </div>
        <div class="hub" role="group" aria-label="Regulators a product may need to satisfy">
          <svg class="hub-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line x1="50" y1="50" x2="17" y2="14"/><line x1="50" y1="50" x2="83" y2="14"/><line x1="50" y1="50" x2="17" y2="50"/>
            <line x1="50" y1="50" x2="83" y2="50"/><line x1="50" y1="50" x2="17" y2="86"/><line x1="50" y1="50" x2="83" y2="86"/>
          </svg>
          ${regulatorCard(REGULATORS[0])}<span aria-hidden="true"></span>${regulatorCard(REGULATORS[1])}
          ${regulatorCard(REGULATORS[2])}
          <div class="hub-center">${icon('box')}<span>Your product</span></div>
          ${regulatorCard(REGULATORS[3])}
          ${regulatorCard(REGULATORS[4])}<span aria-hidden="true"></span>
          <div class="card dashed"><p>…and others, depending on the product</p></div>
        </div>
      </section>

      <section class="section" aria-labelledby="solution">
        <div class="section-head">
          <p class="eyebrow">The solution</p>
          <h2 id="solution">MUTABIQ: a compliance co-pilot for any imported product</h2>
        </div>
        <ol class="plain-list steps">${STEPS.map(
          (s, i) => `<li class="card step${i === STEPS.length - 1 ? ' is-final' : ''}">
            <div class="step-top"><span class="icon-tile">${icon(s.icon)}</span><span class="n">${s.n}</span></div>
            <h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`,
        ).join('')}</ol>
        <p class="engine-note">${icon('layers')} A new product category means adding its regulations to the knowledge base. The engine stays the same.</p>
        <div class="handoff">
          <div class="card card-dark on-dark">
            <h3 class="card-title">${mark('brand-mark small')} MUTABIQ: before submission</h3>
            <div class="chips">${['Regulation-based findings', 'Evidence gaps', 'Draft application', 'Organised package'].map((c) => `<span class="chip chip-navy">${c}</span>`).join('')}</div>
          </div>
          <div class="handoff-middle">${icon('sign')}<span>Applicant reviews<br>&amp; signs</span></div>
          <div class="card">
            <h3 class="card-title">${icon('bank')} The authority: official decision</h3>
            <div class="chips">${['Reviews the application', 'Approves or rejects', 'Issues the certificate'].map((c) => `<span class="chip">${c}</span>`).join('')}</div>
          </div>
        </div>
      </section>

      <section class="section" aria-labelledby="usage">
        <div class="section-head"><p class="eyebrow">How it is used</p><h2 id="usage">Two inputs, two outputs</h2></div>
        <div class="io">
          <div class="io-col">
            <div class="card"><div class="card-head"><h3>${icon('building')} Company profile</h3><span class="chip chip-teal">Entered once</span></div>
              <div class="chips">${['Registered name', 'Registration no.', 'Address & contacts', 'Authorised representative', 'Licences'].map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>
            <div class="card"><div class="card-head"><h3>${icon('box')} Product</h3><span class="chip chip-gold">Per product</span></div>
              <div class="chips">${['Product link or name', 'Category', 'Key specifications', 'Any evidence you already have'].map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
              <p class="small-note">No documents yet? MUTABIQ still lists exactly which evidence you will need.</p></div>
          </div>
          <div class="io-engine"><span class="arrow" aria-hidden="true">→</span>${guide({ pose: 'wave' })}<span class="arrow" aria-hidden="true">→</span></div>
          <div class="io-col">
            <div class="card card-teal-edge"><div class="card-head"><h3>${icon('list')} Compliance findings</h3></div>
              <p>Each requirement: source · applies? · evidence · status · next step</p>
              <div class="chips">${STATUSES.map((s) => statusTag(s.id)).join('')}</div></div>
            <div class="card card-teal-edge"><div class="card-head"><h3>${icon('folder')} Application package</h3></div>
              <div class="chips">${['Pre-filled official form', 'Evidence checklist', 'Next steps'].map((c) => `<span class="chip">${c}</span>`).join('')}</div>
              <p class="small-note">Unconfirmed fields are flagged, never guessed. Declarations and signatures stay with the applicant.</p></div>
          </div>
        </div>
      </section>

      <section class="section" aria-labelledby="trust">
        <div class="section-head"><p class="eyebrow">Responsible AI</p><h2 id="trust">Trust by design: AI that shows its work</h2>
          <p class="muted">A missing document is reported as missing evidence, never as proof that the product is non-compliant.</p></div>
        <ul class="plain-list trust">${SAFEGUARDS.map(
          (s) => `<li class="card"><h3 class="card-title"><span class="icon-tile dark">${icon(s.icon)}</span>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`,
        ).join('')}</ul>
      </section>

      <section class="section" aria-labelledby="prototype">
        <div class="section-head"><p class="eyebrow">This prototype</p><h2 id="prototype">What works today, and what is illustrated</h2></div>
        <div class="status-board">
          <div class="card"><h3 class="card-title"><span class="chip chip-teal">Working</span> Evidence from official texts</h3>
            <ul><li>Four Jordanian instruments parsed into articles, definitions and amendment notes.</li>
              <li>Search in Arabic or English, with article, page and version for every result.</li>
              <li>Uncertainty labelled: unverified legal status, recovered text, superseded wording.</li></ul>
            <div class="actions" style="margin-top:1rem"><a class="button button-secondary" href="#/ask" data-route-link>Open evidence search</a></div></div>
          <div class="card"><h3 class="card-title"><span class="chip chip-gold">Illustrative</span> The assessment flow</h3>
            <ul><li>The DEMO-X1 smartphone walkthrough runs on fictional sample data.</li>
              <li>The TRC trial texts are not in the knowledge base yet, so its findings cite no real clause.</li>
              <li>LLM reasoning over retrieved text is planned, not built.</li></ul>
            <div class="actions" style="margin-top:1rem"><a class="button button-secondary" href="#/sources" data-route-link>See the knowledge base</a></div></div>
        </div>
      </section>
    </div>

    <section class="band-dark on-dark closing" aria-labelledby="closing">
      <div class="wrap closing-grid">
        <div class="hero-copy">
          <p class="eyebrow">Team ZAA · AI Quest 2026</p>
          <h2 id="closing">Every requirement, <span class="accent-text">backed by evidence.</span></h2>
          <p class="tagline-ar" lang="ar" dir="rtl">كل متطلب، له دليل.</p>
          <p class="lede">MUTABIQ prepares the file. The authority makes the decision. Jordanian businesses reach the market with fewer avoidable delays.</p>
        </div>
        ${readinessCard(
          [
            ['Applicable rules found', true],
            ['Evidence matched to each requirement', true],
            ['Gaps flagged before submission', true],
            ['Every finding linked to its source', true],
            ['Official form pre-filled', true],
          ],
          { pct: 100, left: 'Ready for applicant review', right: 'Decision: the authority' },
        )}
      </div>
    </section>`,
  }),

  assessment: () => ({
    html: `
    <section class="band-dark on-dark page-band" aria-labelledby="page-title">
      <div class="wrap page-band-grid">
        <div>
          <div class="chips"><span class="chip chip-dark-teal">Live demo</span><span class="chip chip-dark-gold">Trial scope: telecom devices · TRC</span></div>
          <h1 id="page-title" tabindex="-1">Technical trial: <span class="accent-text">one case, end to end</span></h1>
          <p class="lede">Type approval for a smartphone, from inputs to findings to a draft application. Change the evidence and watch every finding follow.</p>
        </div>
        ${guide({ pose: 'stamp' })}
      </div>
    </section>
    <div class="wrap lift">
      <p class="notice-bar" role="note"><strong>Illustrative screen · sample data.</strong> The device, company and values are fictional. The requirements are placeholders for the trial scope: TRC texts are not in this prototype’s knowledge base yet, so no finding cites a real clause.</p>
      <div class="assess" style="margin-top:1rem">
        <aside class="card flow" aria-label="Demo flow">
          <p class="eyebrow">Demo flow</p>
          <ol></ol>
        </aside>
        <section class="card app-frame" aria-labelledby="assessment-title">
          <div class="app-bar">
            <h2 id="assessment-title">${mark('brand-mark')} New assessment</h2>
            <div class="tabs" role="tablist" aria-label="Assessment steps">
              ${['1 · Inputs', '2 · Findings', '3 · Application'].map((t, i) => `<button class="tab" role="tab" id="tab-${i}" aria-controls="panel" data-tab="${i}">${t}</button>`).join('')}
            </div>
            <span class="sample">Sample data</span>
          </div>
          <div id="panel" class="tab-panel" role="tabpanel" tabindex="0"></div>
        </section>
      </div>
      <section class="section" aria-labelledby="statuses">
        <div class="section-head"><p class="eyebrow">Statuses</p><h2 id="statuses">Evidence status, never a compliance verdict</h2>
          <p class="muted">Every finding uses one of five statuses. None of them means “compliant”: the authority decides that.</p></div>
        <ul class="plain-list grid">${STATUSES.map((s) => `<li class="card">${statusTag(s.id)}<p style="margin-top:.6rem">${esc(s.help)}</p></li>`).join('')}</ul>
      </section>
    </div>`,
    mount(root) {
      const panel = $('#panel', root);
      const tabs = $$('[role="tab"]', root);
      const flow = $('.flow ol', root);
      const draw = ({ focus } = {}) => {
        const state = ui.assessment;
        tabs.forEach((tab, i) => {
          const selected = i === state.tab;
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;
        });
        panel.setAttribute('aria-labelledby', `tab-${state.tab}`);
        panel.innerHTML = renderAssessmentPanel(state.tab);
        flow.innerHTML = renderFlow(state);
        if (focus) $(focus, panel)?.focus();
      };
      const select = (tab) => {
        ui.assessment.tab = tab;
        if (tab > 0) ui.assessment.ran = true;
        draw();
      };
      tabs.forEach((tab) => tab.addEventListener('click', () => select(Number(tab.dataset.tab))));
      $('[role="tablist"]', root).addEventListener('keydown', (event) => {
        const keys = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
        if (!(event.key in keys)) return;
        event.preventDefault();
        const step = keys[event.key];
        const next = Number.isFinite(step) ? (ui.assessment.tab + step + tabs.length) % tabs.length : step < 0 ? 0 : tabs.length - 1;
        select(next);
        tabs[next].focus();
      });
      // Text input re-renders only on commit (change), so typing is never interrupted.
      panel.addEventListener('change', (event) => {
        const input = event.target;
        if (input.name === 'eirp') ui.assessment.eirp = input.value;
        else if (input.name === 'test-report') ui.assessment.testReport = input.value;
        else return;
        draw({ focus: `[name="${input.name}"]` });
      });
      panel.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.name === 'eirp') {
          event.preventDefault();
          event.target.blur(); // commits the value through the change event
        }
      });
      panel.addEventListener('click', (event) => {
        const go = event.target.closest('[data-goto-tab]');
        if (!go) return;
        const eirpInput = $('[name="eirp"]', panel);
        if (eirpInput) ui.assessment.eirp = eirpInput.value; // a typed but uncommitted value still counts
        select(Number(go.dataset.gotoTab));
        tabs[ui.assessment.tab].focus();
      });
      draw();
    },
  }),

  ask: ({ params }) => ({
    html: `
    <div class="wrap">
      <section class="page-head" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">Evidence search</p>
          <h1 id="page-title" tabindex="-1">Search the regulations</h1>
          <p class="lede">Find the exact article behind a requirement. Results come from the official texts in the knowledge base, in Arabic or English, with their source. Nothing is generated.</p>
        </div>
        ${guide({ pose: 'search' })}
      </section>
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
            <label>Instrument <select name="doc"><option value="">All in the knowledge base</option>${REGISTRY_FALLBACK.map(
              (d) => `<option value="${esc(d.id)}">${esc(shortName(d.id))}</option>`,
            ).join('')}</select></label>
            <label><input type="checkbox" name="expand" checked> Add definitions and referenced articles</label>
            <label><input type="checkbox" name="history"> Include amendment notes (may quote superseded text)</label>
          </div>
        </details>
        <p class="service-status" data-state="checking" role="status">Checking the search service…</p>
      </form>
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

      const health = new AbortController();
      api('/api/health', { timeout: 8000, signal: health.signal })
        .then((h) => {
          status.dataset.state = 'live';
          status.textContent = `Search service ready: ${h.documents} instruments, ${h.chunks} passages, ${h.embedding_model}${h.reranker_model ? ' + reranker' : ''}.`;
        })
        .catch((error) => {
          if (error.kind === 'cancelled') return;
          status.dataset.state = 'offline';
          status.textContent = 'Search service offline. Start it with: uv run import-compliance-rag serve';
        });

      async function run(query) {
        controller?.abort();
        controller = new AbortController();
        const mine = controller;
        ui.ask = { history: form.elements.history.checked, expand: form.elements.expand.checked, doc: form.elements.doc.value };
        const params = new URLSearchParams({ q: query, top_k: '8', expand: ui.ask.expand ? '1' : '0', history: ui.ask.history ? '1' : '0' });
        if (ui.ask.doc) params.append('doc', ui.ask.doc);
        // Keep the URL shareable without triggering navigation.
        const hash = hrefFor('ask', { q: query });
        history.replaceState(history.state, '', hash);
        router.renderedHash = hash;

        const submit = $('button[type="submit"]', form);
        submit.disabled = true;
        results.setAttribute('aria-busy', 'true');
        results.innerHTML = `<div class="searching">${guide({ pose: 'search', className: 'is-quiet' })}<p>Searching the knowledge base…</p></div>`;
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
      return () => {
        controller?.abort();
        health.abort();
      };
    },
  }),

  sources: () => ({
    html: `
    <div class="wrap">
      <section class="page-head" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">Knowledge base</p>
          <h1 id="page-title" tabindex="-1">Official texts, clearly bounded</h1>
          <p class="lede">Every finding must point to a text in here. A new product category means adding its regulations; the engine stays the same. None of these texts has been verified as current yet, so every result says so.</p>
          <p class="service-status" data-state="checking" role="status" style="margin-top:.8rem">Loading the source register…</p>
        </div>
        ${guide({ pose: 'shelf' })}
      </section>
      <section class="section" aria-labelledby="indexed" style="margin-top:2rem">
        <h2 id="indexed" class="visually-hidden">Indexed instruments</h2>
        <ul class="source-list"></ul>
      </section>
      <section class="section" aria-labelledby="pipeline">
        <div class="section-head"><p class="eyebrow">How it works</p><h2 id="pipeline">Retrieval grounded in official texts</h2></div>
        <div class="pipeline">
          <div class="card"><h3 class="card-title">${icon('layers')} Knowledge base</h3>
            <p>Built once, updated when a regulation changes.</p>
            <ol>
              <li>Official regulations, from the publishing authority <span class="chip chip-teal">Built</span></li>
              <li>Parsed into articles, definitions and amendment notes <span class="chip chip-teal">Built</span></li>
              <li>Indexed with article IDs and file versions <span class="chip chip-teal">Built</span></li>
            </ol></div>
          <div class="card"><h3 class="card-title">${icon('search')} Each assessment</h3>
            <p>Runs per product. Today only retrieval is connected to real texts.</p>
            <ol>
              <li>Retrieve the relevant articles <span class="chip chip-teal">Built</span></li>
              <li>AI extraction into a product profile <span class="chip chip-gold">Demo only</span></li>
              <li>LLM reasoning over retrieved text only <span class="chip">Planned</span></li>
              <li>Deterministic rule checks and findings <span class="chip chip-gold">Demo only</span></li>
            </ol></div>
        </div>
      </section>
      <section class="section" aria-labelledby="uncovered">
        <div class="section-head"><p class="eyebrow">Not indexed yet</p>
          <h2 id="uncovered">Texts this prototype cannot cite</h2>
          <p class="muted">Search may still return the closest provisions from the indexed instruments; they do not answer questions on these topics.</p></div>
        <ul class="uncovered">${NOT_COVERED.map(
          (n) => `<li class="card${n.trial ? ' trial' : ''}">${n.trial ? '<span class="chip chip-gold">Trial scope</span>' : ''}<h3 style="margin-top:${n.trial ? '.5rem' : '0'}">${esc(n.title)}</h3><p class="muted">${esc(n.why)}</p></li>`,
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
          status.textContent = `Live from the database: ${rows.length} instruments, with active versions and passage counts.`;
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
        <div>
          <p class="eyebrow">Unknown page</p>
          <h1 id="page-title" tabindex="-1">No evidence for this page.</h1>
          <p class="lede">Nothing lives at <code>${esc(path)}</code>. Pick up from the overview or start an assessment.</p>
          <div class="actions"><a class="button button-primary" href="#/" data-route-link>Back to the overview</a>
            <a class="button button-secondary" href="#/assessment" data-route-link>Start an assessment</a></div>
        </div>
        ${guide({ pose: 'shrug' })}
      </section>
    </div>`,
  }),
};

function regulatorCard(r) {
  return `<div class="card"><h3>${esc(r.name)}</h3><p>${esc(r.area)}</p></div>`;
}

// ------------------------------------------------------------------------------------------ assessment
function renderFlow(state) {
  const current = state.tab === 0 ? 1 : state.tab === 1 ? 3 : 5;
  const steps = ['Enter the inputs', 'Run the assessment', 'Review the findings', 'Open the regulatory source', 'Generate the application draft'];
  return steps
    .map((s, i) => {
      const n = i + 1;
      const cls = n === current ? 'is-current' : n < current ? 'is-done' : '';
      return `<li class="${cls}"${n === current ? ' aria-current="step"' : ''}><span class="num" aria-hidden="true">${n}</span>${esc(s)}</li>`;
    })
    .join('');
}

function renderAssessmentPanel(tab) {
  const state = ui.assessment;
  const data = extractedData(state);
  const findings = assessmentFindings(state);
  const eirp = parseEirp(state.eirp);
  const next = (n, label) => `<button type="button" class="button button-primary" data-goto-tab="${n}">${label} ${icon('arrow')}</button>`;

  if (tab === 0) {
    const files = evidenceFiles(state);
    return `<div class="inputs">
      <div>
        <p class="eyebrow" style="color:var(--muted)">Company</p>
        <div class="saved-company"><span>${icon('building')} ${esc(COMPANY.name)}</span><span class="status status-supported"><span class="mark" aria-hidden="true">✓</span>Saved</span></div>
        <p class="eyebrow" style="color:var(--muted);margin-top:1.3rem">Product</p>
        <div class="field"><label for="category">Category</label>
          <select id="category" disabled><option>Telecom device: smartphone (TRC)</option></select></div>
        <div class="field"><label for="product-link">Product link</label>
          <input id="product-link" value="demo-phone.example/x1" readonly></div>
        <div class="field"><span class="label" id="evidence-label">${icon('upload')} Evidence (optional)</span>
          <div class="dropzone" aria-labelledby="evidence-label">
            <div class="chips">${files.map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>
            <label class="field" style="margin:0"><span class="label">Sample test report</span>
              <select name="test-report">${TEST_REPORT_OPTIONS.map((o) => `<option value="${o.id}"${o.id === state.testReport ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
          </div></div>
      </div>
      <div>
        <p class="eyebrow" style="color:var(--muted)">Extracted product data</p>
        <table class="data-table"><caption class="visually-hidden">Extracted product data with sources</caption>
          <thead class="visually-hidden"><tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">Source</th><th scope="col">State</th></tr></thead>
          <tbody>${data
            .map((d) =>
              d.missing || d.field.startsWith('RF output')
                ? `<tr><th scope="row"><label for="eirp">${esc(d.field)}</label></th>
                    <td class="value"><input id="eirp" name="eirp" inputmode="decimal" autocomplete="off" placeholder="Not found: please enter"
                      value="${esc(state.eirp)}" aria-describedby="eirp-help"${eirp.error ? ' aria-invalid="true"' : ''}>
                      <span id="eirp-help" class="${eirp.error ? 'field-error' : 'small-note'}">${esc(eirp.error || (eirp.ok ? 'dBm, entered by you: flagged for verification.' : 'In dBm. Not found in the DoC or the datasheet.'))}</span></td>
                    <td class="src">${esc(d.source)}</td><td><span class="open-dot" aria-label="needs attention">○</span></td></tr>`
                : `<tr><th scope="row">${esc(d.field)}</th><td class="value">${esc(d.value)}</td><td class="src">${esc(d.source)}</td>
                    <td><span class="ok-dot" aria-label="found in a document">✓</span></td></tr>`,
            )
            .join('')}</tbody></table>
        <div class="panel-foot"><span class="small-note">Values come from the uploaded files. Nothing is guessed.</span>${next(1, 'Run assessment')}</div>
      </div>
    </div>`;
  }

  if (tab === 1) {
    const counts = STATUSES.map((s) => [s.id, findings.filter((f) => f.status === s.id).length]).filter(([, n]) => n);
    return `<div>
      <div class="summary-chips" aria-label="Findings by status">${counts.map(([id, n]) => statusTag(id, { count: n })).join('')}</div>
      <ul class="plain-list findings">${findings
        .map(
          (f) => `<li class="finding"><div class="finding-head"><h3>${esc(f.requirement)}</h3>${statusTag(f.status)}</div>
            <dl><dt>Source</dt><dd class="src">${esc(f.source)}</dd><dt>Applies?</dt><dd>${esc(f.applies)}</dd>
              <dt>Evidence</dt><dd>${esc(f.evidence)}</dd><dt>Next step</dt><dd>${esc(f.next)}</dd><dt>Owner</dt><dd>${esc(f.owner)}</dd></dl></li>`,
        )
        .join('')}</ul>
      <div class="panel-foot"><button type="button" class="button button-secondary" data-goto-tab="0">Edit inputs</button>${next(2, 'Generate application draft')}</div>
    </div>`;
  }

  const r = readiness(findings);
  const clear = findings.filter((f) => f.status !== 'missing' && f.status !== 'conflict').length;
  const pct = Math.round((clear / findings.length) * 100);
  const rows = [
    ['Applicant', COMPANY.name, 'Company profile'],
    ...data.map((d) => [d.field, d.value, d.source, d]),
    ['Declarations and signature', null, 'Applicant'],
  ];
  return `<div class="app-columns">
    <div>
      <h3>Pre-filled form (illustrative)</h3>
      <table class="data-table form-preview"><caption class="visually-hidden">Draft application fields with provenance</caption>
        <thead><tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">From</th></tr></thead>
        <tbody>${rows
          .map(([field, value, source, d]) => {
            const shown =
              field === 'Declarations and signature'
                ? '<span class="flag">Left for the applicant</span>'
                : value
                  ? `${esc(value)}${d && !d.confirmed ? ' <span class="flag">Unconfirmed</span>' : ''}`
                  : '<span class="flag">Missing: not filled</span>';
            return `<tr><th scope="row">${esc(field)}</th><td class="value">${shown}</td><td class="src">${esc(source)}</td></tr>`;
          })
          .join('')}</tbody></table>
    </div>
    <div>
      <h3>Evidence checklist</h3>
      <ul class="checklist">${findings.map((f) => `<li><span>${esc(f.requirement)}</span>${statusTag(f.status)}</li>`).join('')}</ul>
      <h3 style="margin-top:1.2rem">Next steps</h3>
      <ul class="checklist">${
        [...r.blocking, ...r.toVerify].map((f) => `<li><span>${esc(f.next)}</span><span class="small-note">${esc(f.owner)}</span></li>`).join('') ||
        '<li><span>No open steps. The applicant reviews and signs.</span></li>'
      }</ul>
      <div class="app-readiness on-dark">${readinessCard(
        [
          ['Applicable rules listed (illustrative)', true],
          ['Evidence matched to each requirement', r.blocking.length === 0],
          ['Gaps flagged before submission', true],
          ['Uncertain values marked for verification', true],
          ['Form pre-filled, unconfirmed fields flagged', true],
        ],
        {
          pct,
          left: r.ready ? 'Ready for applicant review' : `${r.blocking.length} open item${r.blocking.length === 1 ? '' : 's'} before review`,
          right: 'Decision: the authority',
        },
      )}</div>
      <p class="small-note" style="margin-top:.8rem">MUTABIQ prepares the file and never submits it. The applicant confirms every field and signs; the authority decides.</p>
    </div>
  </div>
  <div class="panel-foot"><button type="button" class="button button-secondary" data-goto-tab="1">Back to findings</button></div>`;
}

// ------------------------------------------------------------------------------------------ search renderers
function renderSearchError(error) {
  if (error.kind === 'offline') {
    return `<div class="card notice">${guide({ pose: 'shrug', className: 'is-quiet' })}<div>
      <h2>The search service is not running.</h2>
      <p>This page needs the local service. In the project folder run <code>uv run import-compliance-rag serve</code>, then open <code>http://127.0.0.1:8765/</code>.</p></div></div>`;
  }
  return `<div class="card notice">${guide({ pose: 'shrug', className: 'is-quiet' })}<div>
    <h2>That search did not finish.</h2><p>${esc(error.message)}</p></div></div>`;
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
    ${shared.size ? `<details class="caveats card" open><summary>Applies to every result</summary><ul>${[...shared].map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
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
      <div class="chips">
        <span class="chip ${context ? '' : 'chip-teal'}">${esc(relationLabel(item))}${parent ? ` · for result ${parent}` : ''}</span>
        ${item.chunk_type === 'amendment_history' ? '<span class="chip chip-gold">Amendment note</span>' : ''}
        ${c.page_start ? `<span class="chip mono">${esc(pageLabel(c.page_start, c.page_end))}</span>` : ''}
      </div>
    </div>
    <p class="evidence-text${long ? ' is-clamped' : ''}" lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">${esc(item.text_original)}</p>
    ${long ? '<button type="button" class="link-button" data-more aria-expanded="false">Show full text</button>' : ''}
    <div class="evidence-meta">
      <span>${esc(c.document_type)} · ${esc(c.binding_nature)}</span>
      <span class="mono">${esc(c.version_label)}</span>
      <span>${esc(EXTRACTION_LABELS[c.extraction_method] || c.extraction_method)}</span>
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Official PDF<span class="visually-hidden"> (opens in a new tab)</span> ↗</a>` : ''}
    </div>
    ${own.length ? `<details class="caveats"><summary>${own.length} caveat${own.length > 1 ? 's' : ''} for this passage</summary><ul>${own.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
  </li>`;
}

function renderSource(d, live) {
  const url = safeUrl(d.official_url);
  return `<li class="card source">
    <p class="ar-title" ${d.original_language === 'ar' ? 'lang="ar" dir="rtl"' : 'lang="en"'}>${esc(d.title_original)}</p>
    ${d.title_en && d.original_language === 'ar' ? `<p class="en-title">${esc(d.title_en)}</p>` : ''}
    <div class="chips"><span class="chip">${esc(d.document_type)}</span><span class="chip">${esc(d.binding_nature)}</span>
      <span class="status status-verify"><span class="mark" aria-hidden="true">?</span>Legal status: ${d.legal_status === 'unknown' ? 'not verified' : esc(d.legal_status)}</span></div>
    <dl>
      <dt>Issued by</dt><dd>${esc(d.issuing_authority)}</dd>
      ${d.gazette_reference ? `<dt>Gazette</dt><dd>${esc(d.gazette_reference)}</dd>` : ''}
      ${d.amendment_info ? `<dt>Amendments</dt><dd>${esc(d.amendment_info)}</dd>` : ''}
      ${live && d.extraction_method ? `<dt>Text</dt><dd>${esc(EXTRACTION_LABELS[d.extraction_method] || d.extraction_method)}</dd>` : ''}
      ${live && d.version_label ? `<dt>Version</dt><dd class="mono">${esc(d.version_label)} · ${esc(d.page_count)} pages · ${esc(d.chunks)} passages</dd>` : ''}
    </dl>
    <div class="card-foot">${url ? `<a class="button button-secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Official PDF<span class="visually-hidden"> (opens in a new tab)</span> ↗</a>` : ''}
      <a class="button button-secondary" href="${esc(hrefFor('ask'))}" data-route-link>Search it</a></div>
  </li>`;
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
  if (motionAllowed()) $('.hero-copy, .page-head > div, .page-band-grid > div', main)?.classList.add('enter');
  router.teardown = view.mount?.(main) || null;

  document.title = target.route === NOT_FOUND ? 'Page not found · MUTABIQ' : `${target.route.title} · MUTABIQ`;
  $$('[data-route]', nav).forEach((link) => {
    if (link.dataset.route === target.route.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (target.push && location.hash !== target.hash) history.pushState(null, '', target.hash);
  else if (!target.push && location.hash && location.hash !== target.hash) history.replaceState(null, '', target.hash);
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
        animate(back, [{ transform: start[0] }, { transform: 'translateY(0) rotate(-1.2deg)' }], { duration: 220 }),
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
        animate(back, [{ transform: 'translateY(0) rotate(-1.2deg)' }, { transform: 'translateY(-105%) rotate(-2.5deg)' }], { duration: 260, delay: 60 }),
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
