// Pure, DOM-free logic: routes, navigation lifecycle, escaping, evidence statuses and the rules of
// the illustrative assessment. Unit-tested with `node --test web/js/core.test.mjs`.

export const ROUTES = [
  { id: 'home', path: '/', nav: 'Overview', title: 'Every requirement, backed by evidence', scene: 'wave', caption: 'Matching requirements' },
  { id: 'assessment', path: '/assessment', nav: 'Assessment', title: 'New assessment', scene: 'stamp', caption: 'Checking each requirement' },
  { id: 'ask', path: '/ask', nav: 'Evidence search', title: 'Search the regulations', scene: 'search', caption: 'Finding the clause' },
  { id: 'sources', path: '/sources', nav: 'Knowledge base', title: 'Knowledge base', scene: 'shelf', caption: 'Opening the knowledge base' },
];
export const NOT_FOUND = { id: 'notfound', path: null, nav: null, title: 'Page not found', scene: 'shrug', caption: 'Looking around' };
// Paths from earlier versions of the UI that still resolve.
export const ALIASES = { '/dossier': '/assessment', '/knowledge': '/sources', '/search': '/ask' };

/** Split a location hash such as "#/ask?q=fees" into a path and its parameters. */
export function parseLocation(hash = '') {
  const raw = String(hash).replace(/^#/, '') || '/';
  const [pathPart, query = ''] = raw.split('?');
  const path = '/' + pathPart.replace(/^\/+|\/+$/g, '');
  return { path: ALIASES[path] || path, params: new URLSearchParams(query) };
}

/** Resolve a hash to a route record; unknown paths resolve to NOT_FOUND (never silently to home). */
export function resolveRoute(hash) {
  const { path, params } = parseLocation(hash);
  const route = ROUTES.find((r) => r.path === path) || NOT_FOUND;
  return { route, path, params };
}

export function hrefFor(routeId, params) {
  const route = ROUTES.find((r) => r.id === routeId);
  const query = params && [...new URLSearchParams(params)].length ? `?${new URLSearchParams(params)}` : '';
  return `#${route ? route.path : '/'}${query}`;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Only absolute http(s) URLs are rendered as links; anything else is dropped. */
export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Latest-request-wins navigation. `cover`, `commit`, `reveal` and `cleanup` are injected so the
 * lifecycle can be tested without a DOM. A newer navigation supersedes an older one at any phase;
 * an older one never commits after a newer one started, and only the latest cleans up.
 */
export function createNavigator({ cover, commit, reveal, cleanup }) {
  let generation = 0;
  return async function go(target, reducedMotion = false) {
    const mine = ++generation;
    const current = () => mine === generation;
    try {
      if (!reducedMotion) {
        try {
          await cover(target, current);
        } catch {
          // A failed or cancelled cover animation must not block the destination.
        }
        if (!current()) return false;
      }
      commit(target);
      if (!reducedMotion) {
        try {
          await reveal(target, current);
        } catch {
          // Same: the content is already committed.
        }
      }
      return current();
    } finally {
      if (current()) cleanup(target);
    }
  };
}

/** Run `promise` but give up after `ms` (a stuck animation must not hold the cover). */
export function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Evidence statuses (MUTABIQ vocabulary). A status describes evidence, never compliance.

export const STATUSES = [
  { id: 'supported', label: 'Supported', mark: '✓', help: 'The evidence covers the requirement for this exact product.' },
  { id: 'missing', label: 'Missing evidence', mark: '○', help: 'A required document or value is absent. A gap, not a violation.' },
  { id: 'conflict', label: 'Conflict', mark: '≠', help: 'Documents disagree on a value that matters, such as the model.' },
  { id: 'verify', label: 'Needs verification', mark: '?', help: 'Uncertain or entered by hand: a person confirms it before use.' },
  { id: 'not_applicable', label: 'Not applicable', mark: '–', help: 'The requirement does not apply; the rationale is recorded.' },
];
export const statusById = (id) => STATUSES.find((s) => s.id === id);

export const RELATION_LABELS = {
  retrieved: 'Retrieved',
  definition: 'Definition used',
  sibling_part: 'Other part of this article',
  cross_reference: 'Referenced article',
};

export function relationLabel(item) {
  if (item.relation === 'retrieved' && item.signal?.exact_reference) return 'Exact reference';
  return RELATION_LABELS[item.relation] || item.relation;
}

export function pageLabel(start, end) {
  if (!start) return '';
  return end && end !== start ? `pp. ${start}–${end}` : `p. ${start}`;
}

/** "Art. 12" / "Paragraph 4" label for a citation. */
export function articleLabel(citation) {
  const n = citation.article_number;
  if (!n) return null;
  if (citation.language === 'en') return `Paragraph ${n}`;
  return `Art. ${n}`;
}

// ---------------------------------------------------------------------------------------------
// Illustrative assessment (deck slide 7): fictional DemoTel DEMO-X1 smartphone, trial scope TRC.
// Requirements are placeholders for the trial scope. The TRC instructions are not in this
// prototype's knowledge base, so no finding cites a real clause.

export const MODEL = 'DEMO-X1';
export const EIRP_RANGE = { min: -10, max: 60 }; // plausibility bounds for a hand-entered dBm value

export const COMPANY = {
  name: 'Sample Trading Co.',
  fields: [
    ['Registered name', 'Sample Trading Co.'],
    ['Registration no.', 'SAMPLE-0001'],
    ['Address & contacts', 'Amman (sample)'],
    ['Authorised representative', 'A. Sample'],
  ],
};

/** Extracted product data with provenance; EIRP comes from the applicant when no file states it. */
export function extractedData(state) {
  const eirp = parseEirp(state.eirp);
  return [
    { field: 'Brand', value: 'DemoTel', source: 'Datasheet, p.1', confirmed: true },
    { field: 'Model', value: MODEL, source: 'DoC', confirmed: true },
    { field: 'Manufacturer', value: 'DemoTel Devices Ltd.', source: 'DoC', confirmed: true },
    { field: 'Frequency range (Tx/Rx)', value: 'Bands listed', source: 'Datasheet, p.2', confirmed: true },
    { field: 'Bandwidth', value: '20 MHz', source: 'Datasheet, p.2', confirmed: true },
    eirp.ok
      ? { field: 'RF output power (EIRP)', value: `${eirp.value} dBm`, source: 'Entered by applicant', confirmed: false }
      : { field: 'RF output power (EIRP)', value: null, source: '—', confirmed: false, missing: true },
  ];
}

/** Parse a hand-entered EIRP value. Returns {ok, value} or {ok:false, error} (empty is not an error). */
export function parseEirp(raw) {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (!text) return { ok: false, error: null };
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, error: 'Enter a number in dBm, for example 23.' };
  const value = Number(text);
  if (value < EIRP_RANGE.min || value > EIRP_RANGE.max) {
    return { ok: false, error: `Expected a value between ${EIRP_RANGE.min} and ${EIRP_RANGE.max} dBm.` };
  }
  return { ok: true, value, error: null };
}

export const TEST_REPORT_OPTIONS = [
  { id: 'none', label: 'No test report yet' },
  { id: 'match', label: 'Test report covering DEMO-X1' },
  { id: 'mismatch', label: 'Test report naming DEMO-X0' },
];

export function evidenceFiles(state) {
  const files = ['DoC_DEMO-X1.pdf', 'Datasheet.pdf'];
  if (state.testReport === 'match') files.push('RF_test_report_DEMO-X1.pdf');
  if (state.testReport === 'mismatch') files.push('RF_test_report_DEMO-X0.pdf');
  return files;
}

const SOURCE = 'TRC type approval, trial scope (illustrative; not yet in the knowledge base)';

/** Findings for the illustrative assessment, derived only from the demo state. */
export function assessmentFindings(state) {
  const eirp = parseEirp(state.eirp);
  const findings = [
    {
      id: 'doc',
      requirement: 'Declaration of Conformity for the exact model',
      applies: 'Yes',
      status: 'supported',
      evidence: `DoC_DEMO-X1.pdf names ${MODEL}.`,
      next: 'None.',
      owner: 'Applicant',
    },
    {
      id: 'specs',
      requirement: 'Technical specifications: frequency bands and bandwidth',
      applies: 'Yes',
      status: 'supported',
      evidence: 'Datasheet, p.2 lists the bands and a 20 MHz bandwidth.',
      next: 'None.',
      owner: 'Applicant',
    },
  ];
  if (state.testReport === 'match') {
    findings.push({
      id: 'report',
      requirement: 'RF test report for the exact model',
      applies: 'Yes',
      status: 'supported',
      evidence: `RF_test_report_DEMO-X1.pdf names ${MODEL}, matching the DoC.`,
      next: 'None.',
      owner: 'Applicant',
    });
  } else if (state.testReport === 'mismatch') {
    findings.push({
      id: 'report',
      requirement: 'RF test report for the exact model',
      applies: 'Yes',
      status: 'conflict',
      evidence: `The test report names DEMO-X0; the DoC and datasheet name ${MODEL}.`,
      next: `Ask the manufacturer for a report covering ${MODEL}, or an expert-reviewed model-family explanation.`,
      owner: 'Manufacturer, via the applicant',
    });
  } else {
    findings.push({
      id: 'report',
      requirement: 'RF test report for the exact model',
      applies: 'Yes',
      status: 'missing',
      evidence: 'No test report among the uploaded files.',
      next: `Request the RF test report for ${MODEL} from the manufacturer.`,
      owner: 'Applicant',
    });
  }
  findings.push(
    eirp.ok
      ? {
          id: 'eirp',
          requirement: 'RF output power (EIRP) declared',
          applies: 'Yes',
          status: 'verify',
          evidence: `${eirp.value} dBm, entered by the applicant; no uploaded document states it.`,
          next: 'Confirm the value against the RF test report before submission.',
          owner: 'Applicant',
        }
      : {
          id: 'eirp',
          requirement: 'RF output power (EIRP) declared',
          applies: 'Yes',
          status: 'missing',
          evidence: 'Not found in the DoC or the datasheet.',
          next: 'Enter the value from the RF test report, or ask the manufacturer.',
          owner: 'Applicant',
        },
    {
      id: 'fixed',
      requirement: 'Requirements for wired (fixed-line) terminal equipment',
      applies: 'No',
      status: 'not_applicable',
      evidence: 'The product is a mobile handset with no fixed-line interface.',
      next: 'None. The rationale is kept with the file.',
      owner: '—',
    },
  );
  return findings.map((f) => ({ ...f, source: SOURCE }));
}

/** Readiness for applicant review: no open gap or conflict. "Needs verification" stays visible. */
export function readiness(findings) {
  const blocking = findings.filter((f) => f.status === 'missing' || f.status === 'conflict');
  const toVerify = findings.filter((f) => f.status === 'verify');
  return { ready: blocking.length === 0, blocking, toVerify };
}
