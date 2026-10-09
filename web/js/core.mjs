// Pure, DOM-free logic: routes, navigation lifecycle, escaping, and the synthetic dossier rules.
// Kept separate so it can be unit-tested with `node --test web/js`.

export const ROUTES = [
  { id: 'home', path: '/', nav: 'Overview', title: 'Making import preparation easier', scene: 'wave', caption: 'A clearer next step' },
  { id: 'ask', path: '/ask', nav: 'Ask', title: 'Ask the regulations', scene: 'search', caption: 'Finding the provision' },
  { id: 'dossier', path: '/dossier', nav: 'Dossier', title: 'A dossier becomes a review packet', scene: 'stamp', caption: 'Checking the evidence' },
  { id: 'sources', path: '/sources', nav: 'Sources', title: 'Four official instruments', scene: 'shelf', caption: 'Opening the sources' },
];
export const NOT_FOUND = { id: 'notfound', path: null, nav: null, title: 'Page not found', scene: 'shrug', caption: 'Looking around' };

/** Split a location hash such as "#/ask?q=fees" into a path and its parameters. */
export function parseLocation(hash = '') {
  const raw = String(hash).replace(/^#/, '') || '/';
  const [pathPart, query = ''] = raw.split('?');
  const path = '/' + pathPart.replace(/^\/+|\/+$/g, '');
  return { path, params: new URLSearchParams(query) };
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
// Evidence vocabulary (shared by the live search page and the synthetic dossier).

export const EVIDENCE_STATUSES = [
  { id: 'supplied', label: 'Evidence supplied', mark: '✓', help: 'A file is present within the declared checklist coverage.' },
  { id: 'missing', label: 'Missing evidence', mark: '○', help: 'A required file or fact remains absent.' },
  { id: 'conflicting', label: 'Conflicting evidence', mark: '≠', help: 'Sources disagree on a relevant value.' },
  { id: 'not_applicable', label: 'Not applicable', mark: '–', help: 'A recorded rationale explains the exception.' },
  { id: 'expert_review', label: 'Expert review required', mark: '?', help: 'Applicability is unclear; a specialist decides.' },
];
export const statusById = (id) => EVIDENCE_STATUSES.find((s) => s.id === id);

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

/** "Art. 12" / "المادة 12" style label for a citation, in the citation's language. */
export function articleLabel(citation) {
  const n = citation.article_number;
  if (!n) return null;
  if (citation.language === 'en') return `Paragraph ${n}`;
  return `Art. ${n}`;
}

// ---------------------------------------------------------------------------------------------
// Synthetic kettle dossier (from the ImportReady proposal). This is a demonstration of the
// proposed workflow with invented documents; it evaluates no real requirement.

export const PRODUCT_MODEL = 'KT-200';

export function dossierDocuments(state) {
  return [
    { id: 'invoice', label: 'Invoice', page: 1, model: 'KT-200' },
    { id: 'specification', label: 'Specification', page: 1, model: 'KT-200' },
    { id: 'report', label: 'Test report', page: 1, model: state.correctedReport ? 'KT-200' : 'KT-100' },
  ];
}

/** Findings for the synthetic dossier, derived only from the demo state. */
export function dossierFindings(state) {
  const docs = dossierDocuments(state);
  const mismatched = docs.filter((d) => d.model !== PRODUCT_MODEL);
  const findings = [];
  if (mismatched.length) {
    findings.push({
      id: 'model',
      status: 'conflicting',
      title: 'The test report covers a different model',
      detail: `The report identifies ${mismatched.map((d) => d.model).join(', ')}. Your product is ${PRODUCT_MODEL}.`,
      evidence: docs.map((d) => `${d.label}, p. ${d.page}`).join(' · '),
      why: 'The report does not yet establish evidence for this model.',
      action: 'Request matching evidence or an expert-approved model-family explanation.',
      owner: 'Supplier, with the import employee',
    });
  } else {
    findings.push({
      id: 'model',
      status: 'supplied',
      title: 'All three files describe the same model',
      detail: `Invoice, specification and test report all identify ${PRODUCT_MODEL}.`,
      evidence: docs.map((d) => `${d.label}, p. ${d.page}`).join(' · '),
      why: 'The files agree on the value that matters for this check.',
      action: 'No action for this finding.',
      owner: 'Import employee',
    });
  }
  if (state.wireless === 'unknown') {
    findings.push({
      id: 'wireless',
      status: 'missing',
      title: 'Wireless functions are not confirmed',
      detail: 'No file states whether the kettle has wireless functions. A missing field stays unknown.',
      evidence: 'Specification, p. 1 (silent on wireless)',
      why: 'Wireless functions change the workflow, so routing waits for this fact.',
      action: 'Confirm this field before routing.',
      owner: 'Import employee',
    });
  } else if (state.wireless === 'yes') {
    findings.push({
      id: 'wireless',
      status: 'expert_review',
      title: 'Outside the first scope',
      detail: 'Wireless products change the workflow and sit outside the first route this prototype covers.',
      evidence: 'Confirmed by the import employee',
      why: 'The applicable requirements for wireless functions are not modelled here.',
      action: 'Route to a regulatory specialist.',
      owner: 'Regulatory specialist',
    });
  } else {
    findings.push({
      id: 'wireless',
      status: 'not_applicable',
      title: 'No wireless functions',
      detail: 'The product stays within the first scope: new, wired household electrical appliance.',
      evidence: 'Confirmed by the import employee',
      why: 'Recorded rationale: the confirmed fact excludes the wireless workflow.',
      action: 'No action for this finding.',
      owner: 'Import employee',
    });
  }
  return findings;
}

export function packetReadiness(findings) {
  const open = findings.filter((f) => f.status === 'conflicting' || f.status === 'missing' || f.status === 'expert_review');
  return { ready: open.length === 0, open };
}
