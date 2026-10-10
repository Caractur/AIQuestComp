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

// ---------------------------------------------------------------------------------------------
// Stage 1: Persistent Company Profile (Official TRC Sections 2 & 3: Applicant & Certificate Holder)
export const DEFAULT_COMPANY = {
  name: 'شركة الاستيراد والتجارة التقنية (ذ.م.م)',
  nameEn: 'Technical Import & Trading Co. LLC',
  nationalId: '200198452',
  vocationalLicense: 'VOC-2025-08912',
  address: 'عمان - شارع الملك عبد الله الثاني - مجمع 45',
  addressEn: 'Amman - King Abdullah II St., Bldg 45',
  phone: '+962 6 580 1234',
  fax: '+962 6 580 1235',
  poBox: 'ص.ب 9214 عمان 11192',
  poBoxEn: 'P.O. Box 9214 Amman 11192',
  email: 'compliance@example.com', // fictional sample contact
  liaisonOfficer: 'أحمد العوضي (مدير الامتثال)',
  liaisonOfficerEn: 'Ahmad Al-Awadi (Compliance Officer)',
  importCard: 'IMP-2025-4421',
};

const COMPANY_KEY = 'mutabiq.ui.v1.company';

export function getCompanyProfile() {
  try {
    const raw = window.localStorage.getItem(COMPANY_KEY);
    if (raw) return { ...DEFAULT_COMPANY, ...JSON.parse(raw) };
  } catch {
    // fallback if storage restricted or in Node test runner
  }
  return { ...DEFAULT_COMPANY };
}

export function saveCompanyProfile(profile) {
  try {
    window.localStorage.setItem(COMPANY_KEY, JSON.stringify(profile));
  } catch {
    // storage restricted
  }
}

// Backwards-compatible COMPANY constant for existing templates
export const COMPANY = {
  get name() {
    return getCompanyProfile().name;
  },
  get fields() {
    const c = getCompanyProfile();
    return [
      ['اسم المنشأة المسجل', c.name],
      ['الرقم الوطني للمنشأة', c.nationalId],
      ['رخصة المهن', c.vocationalLicense],
      ['العنوان وبيانات الاتصال', `${c.address} · ${c.phone}`],
      ['ضابط الارتباط / المفوض', c.liaisonOfficer],
    ];
  },
};

// ---------------------------------------------------------------------------------------------
// Stage 2: Product Technical Information & Presets (Official TRC Sections 4 & 5)
export const PRODUCT_PRESETS = [
  {
    id: 'phone-x1',
    name: 'DemoTel DEMO-X1 (5G Smartphone)',
    nameAr: 'هاتف ذكي DemoTel DEMO-X1 (يدعم 5G)',
    category: 'telecom_terminal',
    link: 'https://catalog.example.com/smartphones/demo-x1',
    brand: 'DemoTel',
    model: 'DEMO-X1',
    type: 'Smartphone',
    marketingName: 'DemoTel X1 Pro 5G',
    manufacturer: 'DemoTel Devices Ltd.',
    manufacturerAddress: 'Shenzhen, Hi-Tech Industrial Park, Bldg 7',
    frequencyRange: '700–2600 MHz (4G/5G), 2400–2483.5 MHz (Wi-Fi/BT), 5150–5850 MHz (Wi-Fi)',
    bandwidth: '20 MHz / 40 MHz / 80 MHz',
    defaultEirp: '23',
    battery: '4500 mAh Li-ion (IEC/EN 62133-2)',
    docFile: 'DoC_DEMO-X1.pdf',
    datasheetFile: 'Datasheet_DEMO-X1.pdf',
    testReportFile: 'RF_test_report_DEMO-X1.pdf',
    isExempt: false,
    standards: [
      { code: 'RF EN 300 328', title: '2.4 GHz Wideband Data Transmission (Wi-Fi & Bluetooth)' },
      { code: 'RF EN 301 893', title: '5 GHz RLAN / Broadband Access' },
      { code: 'RF EN 301 908-13', title: 'IMT Cellular Networks (E-UTRA / 4G LTE)' },
      { code: 'EMC EN 55032', title: 'Electromagnetic Compatibility - Emission Requirements' },
      { code: 'EMC EN 301 489-1', title: 'Common EMC Requirements for Radio Equipment' },
      { code: 'EMC EN 301 489-17', title: 'Specific EMC for Broadband Data Transmission' },
      { code: 'EMC EN 301 489-52', title: 'Specific EMC for Cellular Mobile Equipment' },
      { code: 'Safety EN 62368-1', title: 'Audio/Video & ICT Equipment Electrical Safety' },
      { code: 'Health EN 50360', title: 'SAR Human Exposure to Electromagnetic Fields (Next to Ear)' },
    ],
    fees: { application: 25, approval: 50, total: 75, currency: 'JOD' },
  },
  {
    id: 'iot-gw300',
    name: 'SmartNet GW-300 (Wireless IoT Gateway)',
    nameAr: 'بوابة اتصالات إنترنت الأشياء SmartNet GW-300',
    category: 'telecom_terminal',
    link: 'https://catalog.example.com/networking/smartnet-gw300',
    brand: 'SmartNet',
    model: 'GW-300',
    type: 'Wireless Gateway',
    marketingName: 'SmartNet IoT Hub Pro',
    manufacturer: 'SmartNet Technologies Inc.',
    manufacturerAddress: 'Industrial Zone, Tech Park 12',
    frequencyRange: '2400–2483.5 MHz (Wi-Fi/ZigBee), 5150–5725 MHz (Wi-Fi)',
    bandwidth: '20 MHz / 40 MHz',
    defaultEirp: '19',
    battery: '12V DC Mains Powered (Adapter EN 50563)',
    docFile: 'DoC_GW300.pdf',
    datasheetFile: 'Datasheet_GW300.pdf',
    testReportFile: 'RF_test_report_GW300.pdf',
    isExempt: false,
    standards: [
      { code: 'RF EN 300 328', title: '2.4 GHz Wideband Transmission' },
      { code: 'RF EN 301 893', title: '5 GHz RLAN Systems' },
      { code: 'EMC EN 55032', title: 'EMC Emissions of Multimedia Equipment' },
      { code: 'EMC EN 301 489-17', title: 'Specific EMC for Broadband Systems' },
      { code: 'Safety EN 62368-1', title: 'ICT Equipment Electrical Safety' },
    ],
    fees: { application: 25, approval: 50, total: 75, currency: 'JOD' },
  },
  {
    id: 'mouse-wm10',
    name: 'LogiTech WM-10 (Wireless Bluetooth Mouse - EXEMPT)',
    nameAr: 'فأرة لاسلكية بلوتوث LogiTech WM-10 (معفاة بموجب الملحق 3)',
    category: 'telecom_terminal',
    link: 'https://catalog.example.com/accessories/wm10',
    brand: 'LogiTech',
    model: 'WM-10',
    type: 'Wireless Mouse',
    marketingName: 'LogiTech Silent Click WM-10',
    manufacturer: 'LogiTech Hardware Group',
    manufacturerAddress: 'Electronics Hub, Sector 4',
    frequencyRange: '2402–2480 MHz (Bluetooth Low Energy)',
    bandwidth: '2 MHz',
    defaultEirp: '2.5',
    battery: '1x AA Alkaline Battery (1.5V)',
    docFile: 'DoC_WM10.pdf',
    datasheetFile: 'Datasheet_WM10.pdf',
    testReportFile: 'Exempted_Doc.pdf',
    isExempt: true,
    exemptionClause: 'TRC Instructions No. 2 of 2025, Annex 3 (Exemptions), Item (و): Wireless Mouse is explicitly exempt from type approval and import fees.',
    standards: [
      { code: 'RF EN 300 440', title: 'Short Range Devices (SRD) 1 GHz to 40 GHz' },
      { code: 'EMC EN 301 489-3', title: 'Specific EMC for Short-Range Devices' },
    ],
    fees: { application: 0, approval: 0, total: 0, currency: 'JOD' },
  },
];

export function getProductPreset(id) {
  return PRODUCT_PRESETS.find((p) => p.id === id) || PRODUCT_PRESETS[0];
}


/** Extracted product data with provenance; EIRP comes from the applicant when no file states it. */
export function extractedData(state) {
  const preset = getProductPreset(state?.productPreset);
  const rawEirp = state?.eirp !== undefined && state?.eirp !== '' ? state.eirp : preset.defaultEirp;
  const eirp = parseEirp(rawEirp);

  return [
    { field: 'Brand', value: preset.brand, source: `${preset.datasheetFile}, p.1`, confirmed: true },
    { field: 'Model', value: preset.model, source: preset.docFile, confirmed: true },
    { field: 'Device Description', value: preset.marketingName, source: `${preset.datasheetFile}, p.1`, confirmed: true },
    { field: 'Manufacturer', value: preset.manufacturer, source: preset.docFile, confirmed: true },
    { field: 'Frequency range (Tx/Rx)', value: preset.frequencyRange, source: `${preset.datasheetFile}, p.2`, confirmed: true },
    { field: 'Bandwidth', value: preset.bandwidth, source: `${preset.datasheetFile}, p.2`, confirmed: true },
    { field: 'Battery / Power supply', value: preset.battery, source: `${preset.datasheetFile}, p.3`, confirmed: true },
    !eirp.ok
      ? { field: 'RF output power (EIRP)', value: null, source: '—', confirmed: false, missing: true }
      : enteredByHand(state, preset)
        ? { field: 'RF output power (EIRP)', value: `${eirp.value} dBm`, source: 'Entered by applicant', confirmed: false }
        : { field: 'RF output power (EIRP)', value: `${eirp.value} dBm`, source: `${preset.datasheetFile}, p.2`, confirmed: true },
  ];
}

/** True when the applicant typed an EIRP value different from the one the sample datasheet states. */
function enteredByHand(state, preset) {
  return state?.eirp !== undefined && state.eirp !== '' && String(state.eirp).trim() !== String(preset.defaultEirp);
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
  { id: 'match', label: 'Accredited test report covering model (Full compliance)' },
  { id: 'mismatch', label: 'Test report naming different model (Conflict)' },
  { id: 'none', label: 'No test report uploaded yet (Missing evidence)' },
];

export function evidenceFiles(state) {
  const preset = getProductPreset(state?.productPreset);
  const files = [preset.docFile, preset.datasheetFile];
  if (preset.isExempt) {
    files.push('TRC_Annex3_Exemption_Certificate.pdf');
    return files;
  }
  if (state?.testReport === 'match') files.push(preset.testReportFile);
  if (state?.testReport === 'mismatch') files.push('RF_test_report_DEMO-X0.pdf');
  return files;
}


/**
 * Findings for the sample products. Requirement citations point to TRC Instructions No. 2/2025, its
 * annexes and the TRC technical standards list (checked against the source PDFs); the products,
 * documents and values are fictional sample data.
 */
export function assessmentFindings(state) {
  const preset = getProductPreset(state?.productPreset);
  const rawEirp = state?.eirp !== undefined && state?.eirp !== '' ? state.eirp : preset.defaultEirp;
  const eirp = parseEirp(rawEirp);

  // If the product is explicitly exempt under TRC Annex 3
  if (preset.isExempt) {
    return [
      {
        id: 'exemption',
        requirement: 'TRC Type Approval Applicability (Annex 3 Exemption Check)',
        applies: 'Exempt',
        status: 'not_applicable',
        evidence: `${preset.brand} ${preset.model} is a wireless mouse, listed in TRC Annex 3, Item (و). The exemption applies provided the device conforms to TRC's basic approved technical specifications.`,
        next: 'No type approval application. Keep the DoC showing conformity with the basic specifications.',
        owner: 'Applicant',
        source: 'TRC Instructions No. 2/2025, Annex 3 (Exemptions), Item (و)',
      },
      {
        id: 'fees_exemption',
        requirement: 'Type approval fees (Annex 2)',
        applies: 'No',
        status: 'not_applicable',
        evidence: 'No type approval application is made for an exempted device, so the 25 JOD application fee and 50 JOD approval fee in Annex 2 do not arise.',
        next: 'Proceed to customs clearance with standard commercial invoice.',
        owner: 'Jordan Customs / Applicant',
        source: 'TRC Instructions No. 2/2025, Annex 2 & Annex 3',
      },
      {
        id: 'safety_srd',
        requirement: 'SRD Radio Standards (EN 300 440 & EN 301 489-3)',
        applies: 'Yes',
        status: 'supported',
        evidence: `${preset.docFile} confirms compliance with European harmonized standard EN 300 440.`,
        next: 'Retain technical datasheet in company archive.',
        owner: 'Applicant',
        source: 'TRC Technical Standards, p. 22',
      },
    ];
  }

  const findings = [
    {
      id: 'doc',
      requirement: 'Declaration of Conformity (DoC) from manufacturer (Article 5.b.3)',
      applies: 'Yes',
      status: 'supported',
      evidence: `${preset.docFile} names ${preset.model} by ${preset.manufacturer}, issued by accredited quality office.`,
      next: 'None. Certified copy ready for dossier.',
      owner: 'Applicant',
      source: 'TRC Instructions No. 2/2025, Article 5, Para (b), Clause 3',
    },
    {
      id: 'specs',
      requirement: 'Technical specifications declared (frequency bands, bandwidth)',
      applies: 'Yes',
      status: 'supported',
      evidence: `${preset.datasheetFile} specifies ${preset.frequencyRange} and bandwidth ${preset.bandwidth}.`,
      next: 'None. Frequency allocations are not checked automatically in this prototype.',
      owner: 'Applicant',
      source: 'Sample datasheet; standards matched against the TRC Technical Standards list',
    },
    {
      id: 'standards_rf',
      requirement: 'Harmonized Radio Spectrum Standards (EN 300 328 & EN 301 893)',
      applies: 'Yes',
      status: 'supported',
      evidence: `Conformity with EN 300 328 (2.4 GHz) and EN 301 893 (5 GHz) verified against TRC Technical Specifications (151-page schedule).`,
      next: 'None.',
      owner: 'Manufacturer / Testing Lab',
      source: 'TRC Technical Standards & Specifications, pp. 9, 32',
    },
    {
      id: 'standards_emc_safety',
      requirement: 'EMC & Health/Safety Standards (EN 55032 & EN 62368-1)',
      applies: 'Yes',
      status: 'supported',
      evidence: `EMC compliance (EN 55032, EN 301 489) and electrical safety (EN 62368-1) cited in ${preset.docFile}.`,
      next: 'None.',
      owner: 'Testing Lab',
      source: 'TRC Technical Standards & Specifications, pp. 53, 142',
    },
  ];

  // Test report check (ILAC accredited)
  if (state?.testReport === 'match') {
    findings.push({
      id: 'report',
      requirement: 'Accredited Lab Test Report (Article 5.e)',
      applies: 'Yes',
      status: 'supported',
      evidence: `${preset.testReportFile} from ILAC-accredited lab covers exact model ${preset.model}.`,
      next: 'None.',
      owner: 'Applicant',
      source: 'TRC Instructions No. 2/2025, Article 5, Para (e)',
    });
  } else if (state?.testReport === 'mismatch') {
    findings.push({
      id: 'report',
      requirement: 'Accredited Lab Test Report (Article 5.e)',
      applies: 'Yes',
      status: 'conflict',
      evidence: `Uploaded report names ${preset.model.replace('-X1', '-X0')}, while DoC names ${preset.model}.`,
      next: `Request an updated test report or model-family coverage certificate naming ${preset.model}.`,
      owner: 'Manufacturer, via Applicant',
      source: 'TRC Instructions No. 2/2025, Article 5, Para (e)',
    });
  } else {
    findings.push({
      id: 'report',
      requirement: 'Accredited Lab Test Report (Article 5.e)',
      applies: 'Yes',
      status: 'missing',
      evidence: `No accredited lab test report found in uploaded package for ${preset.model}.`,
      next: `Request ILAC-accredited laboratory test report from manufacturer before formal filing.`,
      owner: 'Applicant',
      source: 'TRC Instructions No. 2/2025, Article 5, Para (e)',
    });
  }

  // EIRP Transmission Power check
  findings.push(
    eirp.ok
      ? {
          id: 'eirp',
          requirement: 'Declared transmission power (EIRP)',
          applies: 'Yes',
          status: 'verify',
          evidence: `Declared EIRP ${eirp.value} dBm (${Math.round(Math.pow(10, eirp.value / 10))} mW), ${
            enteredByHand(state, preset) ? 'entered by the applicant' : `from ${preset.datasheetFile}`
          }. ${state?.testReport === 'match' ? 'Compare it with the accredited test report.' : 'No matching test report confirms it yet.'} No TRC power limit is checked in this prototype.`,
          next: 'Confirm the final EIRP value against the test report before signing.',
          owner: 'Applicant',
          source: 'Sample datasheet / applicant entry',
        }
      : {
          id: 'eirp',
          requirement: 'Declared Transmission Power (EIRP)',
          applies: 'Yes',
          status: 'missing',
          evidence: 'Missing declared EIRP value.',
          next: 'Enter transmission power in dBm from test report.',
          owner: 'Applicant',
          source: 'Sample datasheet / applicant entry',
        },
  );

  // Cellular devices require IMEI registration check
  if (preset.id === 'phone-x1') {
    findings.push({
      id: 'imei',
      requirement: 'IMEI registration (GSMA) and IMEI on the data label',
      applies: 'Yes',
      status: 'verify',
      evidence: 'No uploaded file shows whether the IMEI/TAC is in the GSMA database. Article 5(b)(5) requires a GSMA IMEI registration certificate only if it is not; Article 11 requires the IMEI on the data label of cellular devices.',
      next: 'Confirm the TAC is in the GSMA database, or attach the GSMA IMEI registration certificate.',
      owner: 'Applicant / manufacturer',
      source: 'TRC Instructions No. 2/2025, Article 5(b)(5) and Article 11',
    });
  }

  // Fees check (Annex 2)
  findings.push({
    id: 'fees',
    requirement: 'Type approval fees due (Annex 2)',
    applies: 'Yes',
    status: 'verify',
    evidence: `Payable fees: ${preset.fees.application} JOD application review + ${preset.fees.approval} JOD approval certificate (Total: ${preset.fees.total} JOD).`,
    next: 'Issue official payment receipt to TRC accounts upon dossier submission.',
    owner: 'Applicant',
    source: 'TRC Instructions No. 2/2025, Annex 2 (Fees Schedule)',
  });

  return findings;
}

/** Readiness for applicant review: no open gap or conflict. "Needs verification" stays visible. */
export function readiness(findings) {
  const blocking = findings.filter((f) => f.status === 'missing' || f.status === 'conflict');
  const toVerify = findings.filter((f) => f.status === 'verify');
  return { ready: blocking.length === 0, blocking, toVerify };
}

