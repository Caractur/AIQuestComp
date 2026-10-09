import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUSES,
  assessmentFindings,
  createNavigator,
  escapeHtml,
  evidenceFiles,
  extractedData,
  hrefFor,
  parseEirp,
  parseLocation,
  readiness,
  relationLabel,
  resolveRoute,
  safeUrl,
  withTimeout,
} from './core.mjs';
import { guide, mark, POSE_NAMES } from './character.mjs';
import { ICON_NAMES, icon } from './icons.mjs';

test('deep links, aliases, query parameters and unknown routes resolve safely', () => {
  assert.equal(resolveRoute('#/ask?q=fees').route.id, 'ask');
  assert.equal(resolveRoute('#/ask?q=fees').params.get('q'), 'fees');
  assert.equal(resolveRoute('').route.id, 'home');
  assert.equal(resolveRoute('#/').route.id, 'home');
  assert.equal(resolveRoute('#/assessment').route.id, 'assessment');
  assert.equal(resolveRoute('#/sources/').route.id, 'sources');
  assert.equal(resolveRoute('#/dossier').route.id, 'assessment'); // link from the earlier UI
  assert.equal(resolveRoute('#/missing').route.id, 'notfound');
  assert.equal(parseLocation('#//assessment').path, '/assessment');
  assert.equal(hrefFor('ask', { q: 'رسوم' }), '#/ask?q=%D8%B1%D8%B3%D9%88%D9%85');
});

test('latest navigation wins even when an older cover finishes last', async () => {
  const gates = {};
  const commits = [];
  const go = createNavigator({
    cover: (r) => new Promise((resolve) => (gates[r] = resolve)),
    commit: (r) => commits.push(r),
    reveal: async () => {},
    cleanup: () => {},
  });
  const a = go('A');
  const b = go('B');
  gates.B();
  assert.equal(await b, true);
  gates.A();
  assert.equal(await a, false);
  assert.deepEqual(commits, ['B']);
});

test('only the latest navigation cleans up the transition layer', async () => {
  const gates = {};
  const cleaned = [];
  const go = createNavigator({
    cover: (r) => new Promise((resolve) => (gates[r] = resolve)),
    commit: () => {},
    reveal: async () => {},
    cleanup: (r) => cleaned.push(r),
  });
  const a = go('A');
  const b = go('B');
  gates.A();
  await a;
  assert.deepEqual(cleaned, []);
  gates.B();
  await b;
  assert.deepEqual(cleaned, ['B']);
});

test('reduced motion commits immediately and supersedes an in-flight transition', async () => {
  let finish;
  let covers = 0;
  const commits = [];
  const go = createNavigator({
    cover: () => {
      covers++;
      return new Promise((r) => (finish = r));
    },
    commit: (r) => commits.push(r),
    reveal: async () => {},
    cleanup: () => {},
  });
  const a = go('A');
  assert.equal(await go('B', true), true);
  finish();
  await a;
  assert.equal(covers, 1);
  assert.deepEqual(commits, ['B']);
});

test('failed animations still commit and release the layer', async () => {
  const commits = [];
  let cleans = 0;
  const go = createNavigator({
    cover: async () => {
      throw new Error('unavailable');
    },
    commit: (r) => commits.push(r),
    reveal: async () => {
      throw new Error('cancelled');
    },
    cleanup: () => cleans++,
  });
  assert.equal(await go('B'), true);
  assert.deepEqual(commits, ['B']);
  assert.equal(cleans, 1);
});

test('withTimeout releases a stuck animation', async () => {
  const start = Date.now();
  await withTimeout(new Promise(() => {}), 30);
  assert.ok(Date.now() - start < 500);
});

test('escaping and URL validation', () => {
  assert.equal(escapeHtml('<b a="1">&\'</b>'), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('not a url'), null);
  assert.ok(safeUrl('https://ustr.gov/a.pdf').startsWith('https://'));
});

test('relation labels mark exact references', () => {
  assert.equal(relationLabel({ relation: 'retrieved', signal: { exact_reference: true } }), 'Exact reference');
  assert.equal(relationLabel({ relation: 'definition', signal: null }), 'Definition used');
});

test('the five statuses follow the deck vocabulary and never say "compliant"', () => {
  assert.deepEqual(STATUSES.map((s) => s.label), ['Supported', 'Missing evidence', 'Conflict', 'Needs verification', 'Not applicable']);
  assert.ok(STATUSES.every((s) => !/\bcompliant\b/i.test(s.label)));
});

test('EIRP entry: empty is missing, invalid is an error, plausible numbers are accepted', () => {
  assert.deepEqual(parseEirp(''), { ok: false, error: null });
  assert.equal(parseEirp('abc').ok, false);
  assert.match(parseEirp('abc').error, /number/);
  assert.match(parseEirp('500').error, /between/);
  assert.deepEqual(parseEirp(' 23,5 '), { ok: true, value: 23.5, error: null });
});

test('default sample: report and EIRP are missing, so the file is not ready', () => {
  const findings = assessmentFindings({ eirp: '', testReport: 'none' });
  assert.deepEqual(findings.map((f) => f.status), ['supported', 'supported', 'missing', 'missing', 'not_applicable']);
  assert.ok(findings.every((f) => /illustrative/.test(f.source))); // no finding claims a real clause
  const r = readiness(findings);
  assert.equal(r.ready, false);
  assert.equal(r.blocking.length, 2);
});

test('a mismatched test report is a conflict; a hand-entered EIRP needs verification, never "supported"', () => {
  const findings = assessmentFindings({ eirp: '23', testReport: 'mismatch' });
  const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
  assert.equal(byId.report.status, 'conflict');
  assert.match(byId.report.evidence, /DEMO-X0/);
  assert.equal(byId.eirp.status, 'verify');
  assert.equal(readiness(findings).ready, false);
  assert.ok(evidenceFiles({ testReport: 'mismatch' }).includes('RF_test_report_DEMO-X0.pdf'));
});

test('matching report plus entered EIRP is ready for applicant review, with verification still flagged', () => {
  const state = { eirp: '23', testReport: 'match' };
  const r = readiness(assessmentFindings(state));
  assert.equal(r.ready, true);
  assert.equal(r.toVerify.length, 1);
  const eirpRow = extractedData(state).find((d) => d.field.startsWith('RF output'));
  assert.equal(eirpRow.confirmed, false);
  assert.equal(eirpRow.source, 'Entered by applicant');
});

test('every pose and icon renders decorative SVG without colliding ids', () => {
  for (const pose of POSE_NAMES) {
    const svg = guide({ pose });
    assert.match(svg, /^<svg class="guide pose-/);
    assert.match(svg, /aria-hidden="true"/);
    assert.doesNotMatch(svg, /\sid="/);
  }
  assert.match(guide({ pose: 'wave', label: 'Guide waving' }), /role="img" aria-label="Guide waving"/);
  assert.match(mark(), /aria-hidden="true"/);
  for (const name of ICON_NAMES) assert.match(icon(name), /<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"/);
});
