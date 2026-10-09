import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNavigator,
  dossierFindings,
  escapeHtml,
  hrefFor,
  packetReadiness,
  parseLocation,
  relationLabel,
  resolveRoute,
  safeUrl,
  withTimeout,
} from './core.mjs';
import { guide, POSE_NAMES } from './character.mjs';

test('deep links, query parameters and unknown routes resolve safely', () => {
  assert.equal(resolveRoute('#/ask?q=fees').route.id, 'ask');
  assert.equal(resolveRoute('#/ask?q=fees').params.get('q'), 'fees');
  assert.equal(resolveRoute('').route.id, 'home');
  assert.equal(resolveRoute('#/').route.id, 'home');
  assert.equal(resolveRoute('#/sources/').route.id, 'sources');
  assert.equal(resolveRoute('#/missing').route.id, 'notfound');
  assert.equal(parseLocation('#//dossier').path, '/dossier');
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
  assert.deepEqual(cleaned, []); // A must not clear B's busy state
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

test('synthetic dossier: mismatched report conflicts; unknown wireless blocks routing', () => {
  const findings = dossierFindings({ correctedReport: false, wireless: 'unknown' });
  assert.deepEqual(findings.map((f) => f.status), ['conflicting', 'missing']);
  assert.match(findings[0].detail, /KT-100/);
  const readiness = packetReadiness(findings);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.open.length, 2);
});

test('synthetic dossier: corrected report and no wireless gives a packet ready for review', () => {
  const findings = dossierFindings({ correctedReport: true, wireless: 'no' });
  assert.deepEqual(findings.map((f) => f.status), ['supplied', 'not_applicable']);
  assert.equal(packetReadiness(findings).ready, true);
  const wireless = dossierFindings({ correctedReport: true, wireless: 'yes' });
  assert.equal(wireless[1].status, 'expert_review');
  assert.equal(packetReadiness(wireless).ready, false);
});

test('every pose renders an SVG; decorative by default, named when labelled', () => {
  for (const pose of POSE_NAMES) {
    const svg = guide({ pose });
    assert.match(svg, /^<svg class="guide pose-/);
    assert.match(svg, /aria-hidden="true"/);
    assert.doesNotMatch(svg, /\sid="/); // no ids that could collide across instances
  }
  assert.match(guide({ pose: 'wave', label: 'Guide waving' }), /role="img" aria-label="Guide waving"/);
});
