// MUTABIQ UI: persistent shell, hash router with covered transitions, bilingual i18n support, and the views.
import {
  COMPANY,
  DEFAULT_COMPANY,
  MODEL,
  NOT_FOUND,
  PRODUCT_PRESETS,
  STATUSES,
  TEST_REPORT_OPTIONS,
  articleLabel,
  assessmentFindings,
  createNavigator,
  escapeHtml as esc,
  evidenceFiles,
  extractedData,
  getCompanyProfile,
  getProductPreset,
  hrefFor,
  pageLabel,
  parseEirp,
  readiness,
  relationLabel,
  resolveRoute,
  safeUrl,
  saveCompanyProfile,
  statusById,
  withTimeout,
} from './core.mjs';
import { currentLang, setLanguage, t } from './i18n.mjs';
import { guide, mark } from './character.mjs';
import { icon } from './icons.mjs';
import {
  EXAMPLE_QUERIES,
  EXTRACTION_LABELS,
  NOT_COVERED,
  REGISTRY_FALLBACK,
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
const langToggle = $('.lang-toggle');

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
  const s = t();
  document.documentElement.classList.toggle('motion-on', motionAllowed());
  motionToggle.setAttribute('aria-pressed', String(motionPaused));
  $('.motion-label', motionToggle).textContent = motionPaused ? s.resumeMotion : s.pauseMotion;
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

// ------------------------------------------------------------------------------------------ language toggle
function applyLanguage() {
  const s = t();
  document.documentElement.lang = s.lang;
  document.documentElement.dir = s.dir;
  if (langToggle) {
    $('.lang-label', langToggle).textContent = s.langToggle;
    langToggle.setAttribute('aria-label', s.langToggleAria);
  }
  const skipLink = $('.skip-link');
  if (skipLink) skipLink.textContent = s.skipLink;
  const menuLabel = $('.menu-label', menuButton);
  if (menuLabel) menuLabel.textContent = s.menu;
  applyMotion();

  // update nav links
  $$('[data-route]', nav).forEach((link) => {
    const id = link.dataset.route;
    if (s.nav[id]) link.textContent = s.nav[id];
  });
  // brand text
  const wordmarkBrand = $('.wordmark-brand');
  const wordmarkSub = $('.wordmark-sub');
  if (wordmarkBrand) wordmarkBrand.textContent = s.brandName;
  if (wordmarkSub) wordmarkSub.textContent = s.brandSub;
  // footer
  const footerBrand = $('.footer-brand-text');
  const footerNote = $('.footer-note');
  if (footerBrand) footerBrand.textContent = s.footer.brand;
  if (footerNote) footerNote.textContent = s.footer.note;
}

if (langToggle) {
  langToggle.addEventListener('click', () => {
    setLanguage(currentLang === 'ar' ? 'en' : 'ar');
    applyLanguage();
    // Re-commit current view in new language
    const currentHash = router.renderedHash || location.hash || '#/';
    commit({ ...resolveRoute(currentHash), hash: currentHash, push: false });
  });
}

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

// ------------------------------------------------------------------------------------------ state & helpers
const ui = {
  assessment: {
    tab: 0,
    productPreset: 'phone-x1',
    editingCompany: false,
    productLink: 'https://catalog.example.com/smartphones/demo-x1',
    eirp: '',
    testReport: 'match',
    ran: false,
  },
  ask: { history: false, expand: true, doc: '' },
};

const shortName = (id) => t().shortNames[id] || SHORT_NAMES[id] || id;

function statusTag(id, { count } = {}) {
  const s = statusById(id);
  const loc = t().statuses[id] || s;
  return `<span class="status status-${s.id}"><span class="mark" aria-hidden="true">${s.mark}</span>${esc(loc.label)}${
    count !== undefined ? ` <span class="mono">${count}</span>` : ''
  }</span>`;
}

function getRelationLabel(item) {
  const key = item.relation === 'retrieved' && item.signal?.exact_reference ? 'exact_reference' : item.relation;
  return t().relations[key] || relationLabel(item);
}

function getPageLabel(start, end) {
  if (!start) return '';
  if (t().lang === 'ar') {
    return end && end !== start ? `ص. ${start}–${end}` : `ص. ${start}`;
  }
  return pageLabel(start, end);
}

function getArticleLabel(citation) {
  const n = citation.article_number;
  if (!n) return null;
  const isAr = t().lang === 'ar';
  if (citation.language === 'en') {
    return isAr ? `الفقرة ${n}` : `Paragraph ${n}`;
  }
  return isAr ? `المادة ${n}` : `Art. ${n}`;
}

function getExtractionLabel(method) {
  return t().extractionMethods[method] || EXTRACTION_LABELS[method] || method;
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

// ------------------------------------------------------------------------------------------ localized assessment data
function getLocalizedFindings(state) {
  const isAr = t().lang === 'ar';
  const findings = assessmentFindings(state);
  if (!isAr) return findings;

  const preset = getProductPreset(state?.productPreset);
  const rawEirp = state?.eirp !== undefined && state?.eirp !== '' ? state.eirp : preset.defaultEirp;
  const eirp = parseEirp(rawEirp);

  const AR_MAP = {
    exemption: {
      requirement: 'انطباق الموافقة النوعية (فحص الإعفاء بموجب الملحق 3)',
      applies: 'معفى',
      evidence: `يُصنف الجهاز ${preset.brand} ${preset.model} كفأرة حاسوب لاسلكية بموجب الملحق 3 البند (و).`,
      next: 'لا يشترط الحصول على موافقة نوعية؛ يُسمح بإدخاله مباشرة بموجب الإعفاء.',
      owner: 'مقدم الطلب',
      source: 'تعليمات رقم 2 لسنة 2025، الملحق رقم 3 (الأجهزة المعفاة)، البند (و)',
    },
    fees_exemption: {
      requirement: 'جدول الرسوم (رسوم الأجهزة المعفاة - الملحق 2)',
      applies: 'معفى',
      evidence: 'معفى من رسم دراسة الطلب (25 دينار) ورسم الموافقة النوعية (50 دينار) استناداً للملحق 3.',
      next: 'السير بإجراءات التخليص الجمركي بموجب الفاتورة والبيان الجمركي.',
      owner: 'الجمارك الأردنية / المستورد',
      source: 'تعليمات رقم 2 لسنة 2025، الملحق 2 والملحق 3',
    },
    safety_srd: {
      requirement: 'المعايير الفنية للأجهزة قصيرة المدى (EN 300 440 & EN 301 489-3)',
      applies: 'نعم',
      evidence: `إقرار المطابقة ${preset.docFile} يؤكد الالتزام بالمعيار الأوروبي EN 300 440.`,
      next: 'الاحتفاظ بنشرة المواصفات الفنية في أرشيف الشركة.',
      owner: 'المستورد',
      source: 'القواعد الفنية والمواصفات القياسية لهيئة الاتصالات، ص 22',
    },
    doc: {
      requirement: 'إقرار المطابقة (DoC) الصادر عن المصنّع (المادة 5.ب.3)',
      applies: 'نعم',
      evidence: `وثيقة ${preset.docFile} الصادرة عن المصنّع ${preset.manufacturer} تطابق الطراز ${preset.model}.`,
      next: 'لا يوجد. نسخة معتمدة جاهزة للإرفاق بالملف.',
      owner: 'المستورد',
      source: 'تعليمات رقم 2 لسنة 2025، المادة 5 الفقرة (ب) البند 3',
    },
    specs: {
      requirement: 'المواصفات الفنية وحزم الترددات (المادة 5.ب.4)',
      applies: 'نعم',
      evidence: `نشرة المواصفات ${preset.datasheetFile} تبين نطاقات التردد ${preset.frequencyRange} وعرض النطاق ${preset.bandwidth}.`,
      next: 'لا يوجد. المواصفات ضمن الحدود المعتمدة في المملكة.',
      owner: 'المستورد',
      source: 'تعليمات رقم 2 لسنة 2025، المادة 5 الفقرة (ب) البند 4 وقائمة المعايير الفنية',
    },
    standards_rf: {
      requirement: 'المعايير القياسية للطيف الراديوي (EN 300 328 & EN 301 893)',
      applies: 'نعم',
      evidence: `تم التحقق من مطابقة المعايير EN 300 328 و EN 301 893 استناداً لجدول المواصفات القياسية الفنية (151 صفحة).`,
      next: 'لا يوجد.',
      owner: 'المصنّع / المختبر المعتمد',
      source: 'القواعد الفنية والمواصفات القياسية لأجهزة الاتصالات، ص 9، 32',
    },
    standards_emc_safety: {
      requirement: 'معايير التوافق الكهرومغناطيسي والسلامة الكهربائية (EN 55032 & EN 62368-1)',
      applies: 'نعم',
      evidence: `مطابقة التوافق الكهرومغناطيسي والسلامة الكهربائية موثقة في ${preset.docFile}.`,
      next: 'لا يوجد.',
      owner: 'المختبر المعتمد',
      source: 'القواعد الفنية والمواصفات القياسية لأجهزة الاتصالات، ص 53، 142',
    },
    report: {
      requirement: 'تقرير الاختبار الصادر عن مختبر معتمد (المادة 5.هـ)',
      applies: 'نعم',
      evidence: state?.testReport === 'match'
        ? `تقرير الاختبار ${preset.testReportFile} من مختبر معتمد (ILAC) يغطي الطراز ${preset.model}.`
        : state?.testReport === 'mismatch'
        ? `تقرير الاختبار يذكر الطراز DEMO-X0 بينما يذكر إقرار المطابقة ${preset.model} (تعارض طراز).`
        : `لا يوجد تقرير اختبار معتمد مرفق ضمن الملف للطراز ${preset.model}.`,
      next: state?.testReport === 'match'
        ? 'لا يوجد. التقرير مكتمل وجاهز.'
        : state?.testReport === 'mismatch'
        ? `طلب تقرير اختبار محدث أو شهادة تغطية عائلة الطراز من المصنّع.`
        : `طلب تقرير اختبار RF صادر عن مختبر معتمد دولياً (ILAC) من المصنّع قبل التقديم.`,
      owner: state?.testReport === 'mismatch' ? 'المصنّع، عبر المستورد' : 'المستورد',
      source: 'تعليمات رقم 2 لسنة 2025، المادة 5 الفقرة (هـ)',
    },
    eirp: {
      requirement: 'التصريح بقدرة البث الإشعاعي (EIRP) ضمن الحدود المسموحة',
      applies: 'نعم',
      evidence: eirp.ok
        ? `قدرة البث الإشعاعي المصرح بها: ${eirp.value} dBm (${Math.round(Math.pow(10, eirp.value / 10))} ميغاواط)، مطابقة لتقرير الفحص.`
        : 'قيمة قدرة البث الإشعاعي غير مدخلة أو غير محددة صراحة.',
      next: eirp.ok ? 'تأكيد القيمة من مقدم الطلب قبل التوقيع الرسمي.' : 'إدخال قدرة البث الإشعاعي بوحدة dBm من تقرير الفحص.',
      owner: 'المستورد',
      source: 'تعليمات رقم 2 لسنة 2025، الملحق رقم 1 (القسم الفني 5)',
    },
    imei: {
      requirement: 'التسجيل في قاعدة بيانات المعرف الدولي (IMEI / GSMA) واللصاقة (المادة 5.ب.5 والمادة 12)',
      applies: 'نعم',
      evidence: 'رمز تعريف الهاتف مسجل في قاعدة بيانات GSMA الدولية ومطابق لشروط بطاقة البيان واللصاقة.',
      next: 'التأكد من تثبيت رمز IMEI والباركود على العبوة التجارية.',
      owner: 'المستورد / GSMA',
      source: 'تعليمات رقم 2 لسنة 2025، المادة 5 الفقرة (ب) البند 5 والمادة 12',
    },
    fees: {
      requirement: 'رسوم الموافقة النوعية ودراسة الطلب (الملحق 2)',
      applies: 'نعم',
      evidence: `الرسوم المستحقة: ${preset.fees.application} د.أ دراسة طلب + ${preset.fees.approval} د.أ إصدار شهادة (المجموع: ${preset.fees.total} دينار أردني).`,
      next: 'إيداع وصل الدفع المالي لحساب الهيئة عند تقديم الملف.',
      owner: 'المستورد',
      source: 'تعليمات رقم 2 لسنة 2025، الملحق رقم 2 (جدول الرسوم)',
    },
    fixed: {
      requirement: 'متطلبات واجهات الاتصالات السلكية الثابتة',
      applies: 'لا',
      evidence: 'الجهاز راديوي لاسلكي ولا يتصل بشبكة الهواتف الثابتة السلكية (PSTN).',
      next: 'لا يوجد. يثبت سبب عدم الانطباق في ملف المعاملة.',
      owner: '—',
      source: 'تعليمات رقم 2 لسنة 2025 والمواصفات القياسية ES 203021',
    },
  };

  return findings.map((f) => {
    const loc = AR_MAP[f.id];
    if (!loc) return f;
    return {
      ...f,
      requirement: loc.requirement || f.requirement,
      applies: loc.applies || f.applies,
      evidence: loc.evidence || f.evidence,
      next: loc.next || f.next,
      owner: loc.owner || f.owner,
      source: loc.source || f.source,
    };
  });
}

function getLocalizedData(state) {
  const isAr = t().lang === 'ar';
  const data = extractedData(state);
  if (!isAr) return data;
  const labels = {
    Brand: 'العلامة التجارية',
    Model: 'الطراز',
    Type: 'نوع الجهاز',
    'Marketing name': 'الاسم التجاري للمنتج',
    Manufacturer: 'الشركة المصنعة',
    'Manufacturer address': 'عنوان المصنّع',
    'Frequency range (Tx/Rx)': 'نطاق التردد (إرسال/استقبال)',
    Bandwidth: 'عرض النطاق الترددي',
    'RF output power (EIRP)': 'قدرة البث الإشعاعي (EIRP)',
    'Battery / Power': 'البطارية / التغذية الكهربائية',
  };
  const sources = {
    'Datasheet, p.1': 'نشرة المواصفات، ص 1',
    DoC: 'إقرار المطابقة DoC',
    'Datasheet, p.2': 'نشرة المواصفات، ص 2',
    'Entered by applicant': 'مدخل يدوياً من المستورد',
    '—': '—',
  };
  return data.map((d) => ({
    ...d,
    field: labels[d.field] || d.field,
    source: sources[d.source] || d.source,
  }));
}

// ------------------------------------------------------------------------------------------ views
const VIEWS = {
  home: () => {
    const s = t();
    const isAr = s.lang === 'ar';
    return {
      html: `
      <section class="band-dark on-dark hero" aria-labelledby="page-title">
        <div class="wrap hero-grid">
          <div class="hero-copy">
            <div class="chips"><span class="chip chip-dark-teal">${esc(s.hero.team)}</span><span class="chip chip-dark-gold">${esc(s.hero.event)}</span></div>
            <h1 id="page-title" tabindex="-1">${s.hero.title}</h1>
            <p class="tagline-ar" ${isAr ? 'lang="en" dir="ltr"' : 'lang="ar" dir="rtl"'}>${esc(s.hero.taglineSub)}</p>
            <p class="lede">${esc(s.hero.lede)}</p>
            <div class="actions">
              <a class="button button-primary" href="#/assessment" data-route-link>${esc(s.hero.startBtn)} ${icon('arrow')}</a>
              <a class="button button-secondary" href="#/ask" data-route-link>${esc(s.hero.searchBtn)}</a>
            </div>
          </div>
          ${matchingLines()}
        </div>
      </section>

      <div class="wrap">
        <section class="section problem" aria-labelledby="problem">
          <div>
            <p class="eyebrow">${esc(s.problem.eyebrow)}</p>
            <h2 id="problem" style="font-size:var(--step-3);margin-top:.6rem">${esc(s.problem.title)}</h2>
            <p class="lede" style="margin-top:1rem">${esc(s.problem.lede)}</p>
            <ol class="plain-list questions">${s.problem.questions.map((q, i) => `<li><span class="num" aria-hidden="true">${i + 1}</span>${esc(q)}</li>`).join('')}</ol>
          </div>
          <div class="hub" role="group" aria-label="Regulators a product may need to satisfy">
            <svg class="hub-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1="50" y1="50" x2="17" y2="14"/><line x1="50" y1="50" x2="83" y2="14"/><line x1="50" y1="50" x2="17" y2="50"/>
              <line x1="50" y1="50" x2="83" y2="50"/><line x1="50" y1="50" x2="17" y2="86"/><line x1="50" y1="50" x2="83" y2="86"/>
            </svg>
            ${regulatorCard(s.problem.regulators[0])}<span aria-hidden="true"></span>${regulatorCard(s.problem.regulators[1])}
            ${regulatorCard(s.problem.regulators[2])}
            <div class="hub-center">${icon('box')}<span>${esc(s.problem.yourProduct)}</span></div>
            ${regulatorCard(s.problem.regulators[3])}
            ${regulatorCard(s.problem.regulators[4])}<span aria-hidden="true"></span>
            <div class="card dashed"><p>${esc(s.problem.andOthers)}</p></div>
          </div>
        </section>

        <section class="section" aria-labelledby="solution">
          <div class="section-head">
            <p class="eyebrow">${esc(s.solution.eyebrow)}</p>
            <h2 id="solution">${esc(s.solution.title)}</h2>
          </div>
          <ol class="plain-list steps">${s.solution.steps.map(
            (step, i) => `<li class="card step${i === s.solution.steps.length - 1 ? ' is-final' : ''}">
              <div class="step-top"><span class="icon-tile">${icon(step.icon)}</span><span class="n">${step.n}</span></div>
              <h3>${esc(step.title)}</h3><p>${esc(step.text)}</p></li>`,
          ).join('')}</ol>
          <p class="engine-note">${icon('layers')} ${esc(s.solution.engineNote)}</p>
          <div class="handoff">
            <div class="card card-dark on-dark">
              <h3 class="card-title">${mark('brand-mark small')} ${esc(s.solution.beforeSubmission)}</h3>
              <div class="chips">${s.solution.beforeChips.map((c) => `<span class="chip chip-navy">${esc(c)}</span>`).join('')}</div>
            </div>
            <div class="handoff-middle">${icon('sign')}<span>${s.solution.middleSign}</span></div>
            <div class="card">
              <h3 class="card-title">${icon('bank')} ${esc(s.solution.officialAuthority)}</h3>
              <div class="chips">${s.solution.authorityChips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
            </div>
          </div>
        </section>

        <section class="section" aria-labelledby="usage">
          <div class="section-head"><p class="eyebrow">${esc(s.usage.eyebrow)}</p><h2 id="usage">${esc(s.usage.title)}</h2></div>
          <div class="io">
            <div class="io-col">
              <div class="card"><div class="card-head"><h3>${icon('building')} ${esc(s.usage.companyTitle)}</h3><span class="chip chip-teal">${esc(s.usage.companyBadge)}</span></div>
                <div class="chips">${s.usage.companyChips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>
              <div class="card"><div class="card-head"><h3>${icon('box')} ${esc(s.usage.productTitle)}</h3><span class="chip chip-gold">${esc(s.usage.productBadge)}</span></div>
                <div class="chips">${s.usage.productChips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
                <p class="small-note">${esc(s.usage.noDocsNote)}</p></div>
            </div>
            <div class="io-engine"><span class="arrow" aria-hidden="true">${isAr ? '←' : '→'}</span>${guide({ pose: 'wave' })}<span class="arrow" aria-hidden="true">${isAr ? '←' : '→'}</span></div>
            <div class="io-col">
              <div class="card card-teal-edge"><div class="card-head"><h3>${icon('list')} ${esc(s.usage.findingsTitle)}</h3></div>
                <p>${esc(s.usage.findingsSub)}</p>
                <div class="chips">${STATUSES.map((st) => statusTag(st.id)).join('')}</div></div>
              <div class="card card-teal-edge"><div class="card-head"><h3>${icon('folder')} ${esc(s.usage.packageTitle)}</h3></div>
                <div class="chips">${s.usage.packageChips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
                <p class="small-note">${esc(s.usage.packageNote)}</p></div>
            </div>
          </div>
        </section>

        <section class="section" aria-labelledby="trust">
          <div class="section-head"><p class="eyebrow">${esc(s.trust.eyebrow)}</p><h2 id="trust">${esc(s.trust.title)}</h2>
            <p class="muted">${esc(s.trust.sub)}</p></div>
          <ul class="plain-list trust">${s.trust.safeguards.map(
            (sg) => `<li class="card"><h3 class="card-title"><span class="icon-tile dark">${icon(sg.icon)}</span>${esc(sg.title)}</h3><p>${esc(sg.text)}</p></li>`,
          ).join('')}</ul>
        </section>

        <section class="section" aria-labelledby="prototype">
          <div class="section-head"><p class="eyebrow">${esc(s.proto.eyebrow)}</p><h2 id="prototype">${esc(s.proto.title)}</h2></div>
          <div class="status-board">
            <div class="card"><h3 class="card-title"><span class="chip chip-teal">${esc(s.proto.workingBadge)}</span> ${esc(s.proto.workingTitle)}</h3>
              <ul>${s.proto.workingList.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>
              <div class="actions" style="margin-top:1rem"><a class="button button-secondary" href="#/ask" data-route-link>${esc(s.proto.openSearch)}</a></div></div>
            <div class="card"><h3 class="card-title"><span class="chip chip-gold">${esc(s.proto.demoBadge)}</span> ${esc(s.proto.demoTitle)}</h3>
              <ul>${s.proto.demoList.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>
              <div class="actions" style="margin-top:1rem"><a class="button button-secondary" href="#/sources" data-route-link>${esc(s.proto.seeSources)}</a></div></div>
          </div>
        </section>
      </div>

      <section class="band-dark on-dark closing" aria-labelledby="closing">
        <div class="wrap closing-grid">
          <div class="hero-copy">
            <p class="eyebrow">${esc(s.closing.tag)}</p>
            <h2 id="closing">${s.closing.title}</h2>
            <p class="tagline-ar" ${isAr ? 'lang="en" dir="ltr"' : 'lang="ar" dir="rtl"'}>${esc(s.closing.taglineSub)}</p>
            <p class="lede">${esc(s.closing.lede)}</p>
          </div>
          ${readinessCard(s.closing.readiness, {
            pct: 100,
            left: s.closing.readyLabel,
            right: s.closing.decisionLabel,
            title: isAr ? 'جاهزية الطلب' : 'Application readiness',
          })}
        </div>
      </section>`,
    };
  },

  assessment: () => {
    const s = t();
    const a = s.assessment;
    return {
      html: `
      <section class="band-dark on-dark page-band" aria-labelledby="page-title">
        <div class="wrap page-band-grid">
          <div>
            <div class="chips"><span class="chip chip-dark-teal">${esc(a.badge1)}</span><span class="chip chip-dark-gold">${esc(a.badge2)}</span></div>
            <h1 id="page-title" tabindex="-1">${a.title}</h1>
            <p class="lede">${esc(a.lede)}</p>
          </div>
          ${guide({ pose: 'stamp' })}
        </div>
      </section>
      <div class="wrap lift">
        <p class="notice-bar" role="note">${a.notice}</p>
        <div class="assess" style="margin-top:1rem">
          <aside class="card flow" aria-label="${esc(a.flowTitle)}">
            <p class="eyebrow">${esc(a.flowTitle)}</p>
            <ol></ol>
          </aside>
          <section class="card app-frame" aria-labelledby="assessment-title">
            <div class="app-bar">
              <h2 id="assessment-title">${mark('brand-mark')} ${esc(s.routes.assessment.title)}</h2>
              <div class="tabs" role="tablist" aria-label="Assessment steps">
                ${a.tabs.map((tab, i) => `<button class="tab" role="tab" id="tab-${i}" aria-controls="panel" data-tab="${i}">${esc(tab)}</button>`).join('')}
              </div>
              <span class="sample">${esc(a.sampleDataBadge)}</span>
            </div>
            <div id="panel" class="tab-panel" role="tabpanel" tabindex="0"></div>
          </section>
        </div>
        <section class="section" aria-labelledby="statuses">
          <div class="section-head"><p class="eyebrow">${esc(a.statusHead)}</p><h2 id="statuses">${esc(a.statusTitle)}</h2>
            <p class="muted">${esc(a.statusSub)}</p></div>
          <ul class="plain-list grid">${STATUSES.map((st) => `<li class="card">${statusTag(st.id)}<p style="margin-top:.6rem">${esc((s.statuses[st.id] || st).help)}</p></li>`).join('')}</ul>
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
          const isRtl = t().dir === 'rtl';
          const nextKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
          const prevKey = isRtl ? 'ArrowRight' : 'ArrowLeft';
          const keys = { [nextKey]: 1, [prevKey]: -1, Home: -Infinity, End: Infinity };
          if (!(event.key in keys)) return;
          event.preventDefault();
          const step = keys[event.key];
          const next = Number.isFinite(step) ? (ui.assessment.tab + step + tabs.length) % tabs.length : step < 0 ? 0 : tabs.length - 1;
          select(next);
          tabs[next].focus();
        });
        panel.addEventListener('change', (event) => {
          const input = event.target;
          if (input.name === 'product-preset') {
            ui.assessment.productPreset = input.value;
            const p = getProductPreset(input.value);
            ui.assessment.productLink = p.link;
            ui.assessment.eirp = p.defaultEirp;
            draw();
            return;
          }
          if (input.name === 'eirp') ui.assessment.eirp = input.value;
          else if (input.name === 'test-report') ui.assessment.testReport = input.value;
          else return;
          draw({ focus: `[name="${input.name}"]` });
        });
        panel.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && event.target.name === 'eirp') {
            event.preventDefault();
            event.target.blur();
          }
        });
        panel.addEventListener('click', (event) => {
          if (event.target.closest('[data-edit-company]')) {
            ui.assessment.editingCompany = true;
            draw();
            return;
          }
          if (event.target.closest('[data-cancel-company]')) {
            ui.assessment.editingCompany = false;
            draw();
            return;
          }
          if (event.target.closest('[data-fetch-link]')) {
            const btn = event.target.closest('[data-fetch-link]');
            btn.textContent = t().lang === 'ar' ? '✓ تم الاستخراج' : '✓ Specs Extracted';
            btn.classList.add('button-primary');
            setTimeout(() => draw(), 600);
            return;
          }
          if (event.target.closest('[data-print-form]')) {
            window.print();
            return;
          }
          const go = event.target.closest('[data-goto-tab]');
          if (!go) return;
          const eirpInput = $('[name="eirp"]', panel);
          if (eirpInput) ui.assessment.eirp = eirpInput.value;
          select(Number(go.dataset.gotoTab));
          tabs[ui.assessment.tab].focus();
        });
        panel.addEventListener('submit', (event) => {
          const form = event.target.closest('[data-company-form]');
          if (!form) return;
          event.preventDefault();
          const fd = new FormData(form);
          saveCompanyProfile({
            name: fd.get('name') || '',
            nationalId: fd.get('nationalId') || '',
            vocationalLicense: fd.get('vocationalLicense') || '',
            liaisonOfficer: fd.get('liaisonOfficer') || '',
            phone: fd.get('phone') || '',
            fax: fd.get('fax') || '',
            poBox: fd.get('poBox') || '',
            email: fd.get('email') || '',
            address: fd.get('address') || '',
          });
          ui.assessment.editingCompany = false;
          draw();
        });
        draw();
      },
    };
  },

  ask: ({ params }) => {
    const s = t();
    const ask = s.ask;
    return {
      html: `
      <div class="wrap">
        <section class="page-head" aria-labelledby="page-title">
          <div>
            <p class="eyebrow">${esc(ask.eyebrow)}</p>
            <h1 id="page-title" tabindex="-1">${esc(ask.title)}</h1>
            <p class="lede">${esc(ask.lede)}</p>
          </div>
          ${guide({ pose: 'search' })}
        </section>
        <form class="search-form" role="search" novalidate>
          <label for="q">${esc(ask.questionLabel)}</label>
          <div class="search-box">
            <textarea id="q" name="q" rows="2" maxlength="500" dir="auto" placeholder="${esc(ask.placeholder)}"></textarea>
            <button class="button button-primary" type="submit">${esc(ask.submitBtn)}</button>
          </div>
          <div class="examples"><span>${esc(ask.tryLabel)}</span>${EXAMPLE_QUERIES.map(
            (e) => `<button type="button" class="example" lang="${e.lang}" dir="auto" data-example="${esc(e.text)}">${esc(e.text)}</button>`,
          ).join('')}</div>
          <details class="options">
            <summary>${esc(ask.optionsSummary)}</summary>
            <div class="options-body">
              <label>${esc(ask.instrumentLabel)} <select name="doc"><option value="">${esc(ask.allDocs)}</option>${REGISTRY_FALLBACK.map(
                (d) => `<option value="${esc(d.id)}">${esc(shortName(d.id))}</option>`,
              ).join('')}</select></label>
              <label><input type="checkbox" name="expand" checked> ${esc(ask.expandLabel)}</label>
              <label><input type="checkbox" name="history"> ${esc(ask.historyLabel)}</label>
            </div>
          </details>
          <p class="service-status" data-state="checking" role="status">${esc(ask.statusChecking)}</p>
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
            const emb = h.embedding_model || (t().lang === 'ar' ? 'بحث معجمي BM25' : 'BM25 lexical');
            status.textContent = ask.statusReady(h.documents, h.chunks, emb, Boolean(h.reranker_model));
          })
          .catch((error) => {
            if (error.kind === 'cancelled') return;
            status.dataset.state = 'offline';
            status.textContent = ask.statusOffline;
          });

        async function run(query) {
          controller?.abort();
          controller = new AbortController();
          const mine = controller;
          ui.ask = { history: form.elements.history.checked, expand: form.elements.expand.checked, doc: form.elements.doc.value };
          const params = new URLSearchParams({ q: query, top_k: '8', expand: ui.ask.expand ? '1' : '0', history: ui.ask.history ? '1' : '0' });
          if (ui.ask.doc) params.append('doc', ui.ask.doc);
          const hash = hrefFor('ask', { q: query });
          history.replaceState(history.state, '', hash);
          router.renderedHash = hash;

          const submit = $('button[type="submit"]', form);
          submit.disabled = true;
          results.setAttribute('aria-busy', 'true');
          results.innerHTML = `<div class="searching">${guide({ pose: 'search', className: 'is-quiet' })}<p>${esc(ask.searching)}</p></div>`;
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
            results.innerHTML = `<p class="results-summary">${esc(ask.typeFirst)}</p>`;
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
            more.textContent = open ? ask.showLess : ask.showFull;
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
    };
  },

  sources: () => {
    const s = t();
    const src = s.sources;
    return {
      html: `
      <div class="wrap">
        <section class="page-head" aria-labelledby="page-title">
          <div>
            <p class="eyebrow">${esc(src.eyebrow)}</p>
            <h1 id="page-title" tabindex="-1">${esc(src.title)}</h1>
            <p class="lede">${esc(src.lede)}</p>
            <p class="service-status" data-state="checking" role="status" style="margin-top:.8rem">${esc(src.loading)}</p>
          </div>
          ${guide({ pose: 'shelf' })}
        </section>
        <section class="section" aria-labelledby="indexed" style="margin-top:2rem">
          <h2 id="indexed" class="visually-hidden">Indexed instruments</h2>
          <ul class="source-list"></ul>
        </section>
        <section class="section" aria-labelledby="pipeline">
          <div class="section-head"><p class="eyebrow">${esc(src.howItWorksEyebrow)}</p><h2 id="pipeline">${esc(src.howItWorksTitle)}</h2></div>
          <div class="pipeline">
            <div class="card"><h3 class="card-title">${icon('layers')} ${esc(src.kbTitle)}</h3>
              <p>${esc(src.kbSub)}</p>
              <ol>
                <li>${esc(src.kbStep1)} <span class="chip chip-teal">${esc(src.builtBadge)}</span></li>
                <li>${esc(src.kbStep2)} <span class="chip chip-teal">${esc(src.builtBadge)}</span></li>
                <li>${esc(src.kbStep3)} <span class="chip chip-teal">${esc(src.builtBadge)}</span></li>
              </ol></div>
            <div class="card"><h3 class="card-title">${icon('search')} ${esc(src.assessmentTitle)}</h3>
              <p>${esc(src.assessmentSub)}</p>
              <ol>
                <li>${esc(src.assessStep1)} <span class="chip chip-teal">${esc(src.builtBadge)}</span></li>
                <li>${esc(src.assessStep2)} <span class="chip chip-gold">${esc(src.demoBadge)}</span></li>
                <li>${esc(src.assessStep3)} <span class="chip">${esc(src.plannedBadge)}</span></li>
                <li>${esc(src.assessStep4)} <span class="chip chip-gold">${esc(src.demoBadge)}</span></li>
              </ol></div>
          </div>
        </section>
        <section class="section" aria-labelledby="uncovered">
          <div class="section-head"><p class="eyebrow">${esc(src.notIndexedEyebrow)}</p>
            <h2 id="uncovered">${esc(src.notIndexedTitle)}</h2>
            <p class="muted">${esc(src.notIndexedSub)}</p></div>
          <ul class="uncovered">${NOT_COVERED.map(
            (n) => `<li class="card${n.trial ? ' trial' : ''}">${n.trial ? `<span class="chip chip-gold">${esc(src.trialBadge)}</span>` : ''}<h3 style="margin-top:${n.trial ? '.5rem' : '0'}">${esc(n.title)}</h3><p class="muted">${esc(n.why)}</p></li>`,
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
            status.textContent = src.liveStatus(rows.length);
          })
          .catch((error) => {
            if (error.kind === 'cancelled') return;
            status.dataset.state = 'offline';
            status.textContent = src.offlineStatus;
          });
        return () => controller.abort();
      },
    };
  },

  notfound: ({ path }) => {
    const s = t();
    const nf = s.notfound;
    return {
      html: `
      <div class="wrap">
        <section class="lost" aria-labelledby="page-title">
          <div>
            <p class="eyebrow">${esc(nf.eyebrow)}</p>
            <h1 id="page-title" tabindex="-1">${esc(nf.title)}</h1>
            <p class="lede">${nf.lede(esc(path))}</p>
            <div class="actions"><a class="button button-primary" href="#/" data-route-link>${esc(nf.backHome)}</a>
              <a class="button button-secondary" href="#/assessment" data-route-link>${esc(nf.startAssessment)}</a></div>
          </div>
          ${guide({ pose: 'shrug' })}
        </section>
      </div>`,
    };
  },
};

function regulatorCard(r) {
  return `<div class="card"><h3>${esc(r.name)}</h3><p>${esc(r.area)}</p></div>`;
}

// ------------------------------------------------------------------------------------------ assessment renderers
function renderFlow(state) {
  const current = state.tab === 0 ? 1 : state.tab === 1 ? 3 : 5;
  const steps = t().assessment.flowSteps;
  return steps
    .map((s, i) => {
      const n = i + 1;
      const cls = n === current ? 'is-current' : n < current ? 'is-done' : '';
      return `<li class="${cls}"${n === current ? ' aria-current="step"' : ''}><span class="num" aria-hidden="true">${n}</span>${esc(s)}</li>`;
    })
    .join('');
}

function renderAssessmentPanel(tab) {
  const s = t();
  const a = s.assessment;
  const isAr = s.lang === 'ar';
  const state = ui.assessment;
  const data = getLocalizedData(state);
  const findings = getLocalizedFindings(state);
  const next = (n, label) => `<button type="button" class="button button-primary" data-goto-tab="${n}">${label} ${icon('arrow')}</button>`;

  if (tab === 0) {
    const preset = getProductPreset(state.productPreset);
    const profile = getCompanyProfile();
    const files = evidenceFiles(state);
    const rawEirp = state.eirp !== '' ? state.eirp : preset.defaultEirp;
    const eirpObj = parseEirp(rawEirp);
    const eirpHelpText = eirpObj.error
      ? (isAr ? a.eirpErrorNumeric : eirpObj.error)
      : eirpObj.ok
        ? a.eirpHelpValid
        : a.eirpHelpDefault;

    const stage1Html = state.editingCompany
      ? `<form class="company-edit-form" data-company-form>
          <div class="form-grid">
            <div class="field"><label for="comp-name">${esc(isAr ? 'اسم الشركة / المنشأة' : 'Company Name')}</label>
              <input id="comp-name" name="name" value="${esc(profile.name)}" required></div>
            <div class="field"><label for="comp-nationalId">${esc(isAr ? 'الرقم الوطني للمنشأة' : 'National Company ID')}</label>
              <input id="comp-nationalId" name="nationalId" value="${esc(profile.nationalId)}" required></div>
            <div class="field"><label for="comp-vocational">${esc(isAr ? 'رخصة المهن / السجل التجاري' : 'Vocational License No.')}</label>
              <input id="comp-vocational" name="vocationalLicense" value="${esc(profile.vocationalLicense)}"></div>
            <div class="field"><label for="comp-liaison">${esc(isAr ? 'اسم ضابط الارتباط / المفوض' : 'Liaison Officer')}</label>
              <input id="comp-liaison" name="liaisonOfficer" value="${esc(profile.liaisonOfficer)}"></div>
            <div class="field"><label for="comp-phone">${esc(isAr ? 'رقم الهاتف' : 'Phone Number')}</label>
              <input id="comp-phone" name="phone" value="${esc(profile.phone)}"></div>
            <div class="field"><label for="comp-fax">${esc(isAr ? 'رقم الفاكس' : 'Fax Number')}</label>
              <input id="comp-fax" name="fax" value="${esc(profile.fax)}"></div>
            <div class="field"><label for="comp-poBox">${esc(isAr ? 'صندوق البريد' : 'P.O. Box')}</label>
              <input id="comp-poBox" name="poBox" value="${esc(profile.poBox)}"></div>
            <div class="field"><label for="comp-email">${esc(isAr ? 'البريد الإلكتروني' : 'Email Address')}</label>
              <input id="comp-email" name="email" type="email" value="${esc(profile.email)}"></div>
            <div class="field form-full"><label for="comp-address">${esc(isAr ? 'العنوان التفصيلي' : 'Address')}</label>
              <input id="comp-address" name="address" value="${esc(profile.address)}"></div>
          </div>
          <div style="display:flex;gap:0.8rem;margin-top:1rem">
            <button type="submit" class="button button-primary button-sm" data-save-company>${esc(a.saveCompanyBtn)}</button>
            <button type="button" class="button button-secondary button-sm" data-cancel-company>${esc(a.cancelEditBtn)}</button>
          </div>
        </form>`
      : `<div class="company-profile-preview">
          <div class="cpp-main">
            <div class="cpp-name">${icon('building')} <strong>${esc(profile.name)}</strong></div>
            <button type="button" class="button button-secondary button-sm" data-edit-company>${icon('sign')} ${esc(a.editCompanyBtn)}</button>
          </div>
          <div class="cpp-meta">
            <div><span class="meta-label">${esc(isAr ? 'الرقم الوطني:' : 'National ID:')}</span><strong class="mono">${esc(profile.nationalId)}</strong></div>
            <div><span class="meta-label">${esc(isAr ? 'رخصة المهن:' : 'Vocational Lic:')}</span><span>${esc(profile.vocationalLicense)}</span></div>
            <div><span class="meta-label">${esc(isAr ? 'ضابط الارتباط:' : 'Liaison:')}</span><span>${esc(profile.liaisonOfficer)}</span></div>
            <div><span class="meta-label">${esc(isAr ? 'الهاتف:' : 'Phone:')}</span><span>${esc(profile.phone)}</span></div>
            <div><span class="meta-label">${esc(isAr ? 'البريد الإلكتروني:' : 'Email:')}</span><span>${esc(profile.email)}</span></div>
            <div><span class="meta-label">${esc(isAr ? 'صندوق البريد:' : 'P.O. Box:')}</span><span>${esc(profile.poBox)}</span></div>
            <div class="form-full"><span class="meta-label">${esc(isAr ? 'العنوان:' : 'Address:')}</span><span>${esc(profile.address)}</span></div>
          </div>
          <p class="small-note">${icon('check')} ${esc(a.companySavedNote)}</p>
        </div>`;

    return `<div class="inputs-2stage">
      <!-- Stage 1 -->
      <div class="stage-card">
        <div class="stage-head">
          <div class="stage-badge"><span class="n">1</span> <strong>${esc(a.stage1Eyebrow)}</strong></div>
          <span class="status status-supported"><span class="mark" aria-hidden="true">✓</span>${esc(isAr ? 'محفوظ محلياً' : 'Persistent Profile')}</span>
        </div>
        ${stage1Html}
      </div>

      <!-- Stage 2 -->
      <div class="stage-card">
        <div class="stage-head">
          <div class="stage-badge"><span class="n">2</span> <strong>${esc(a.stage2Eyebrow)}</strong></div>
          <span class="sample">${esc(a.sampleDataBadge)}</span>
        </div>

        <div class="stage-grid">
          <div>
            <!-- Presets -->
            <div class="field">
              <label for="product-preset">${esc(a.presetLabel)}</label>
              <select id="product-preset" name="product-preset">
                ${PRODUCT_PRESETS.map((p) => `<option value="${p.id}"${p.id === state.productPreset ? ' selected' : ''}>${esc(isAr ? p.nameAr : p.name)}</option>`).join('')}
              </select>
            </div>

            <!-- Product Link -->
            <div class="field">
              <label for="product-link">${esc(a.productLinkLabel)}</label>
              <div class="input-action-group">
                <input id="product-link" name="product-link" value="${esc(state.productLink || preset.link)}">
                <button type="button" class="button button-secondary button-sm" data-fetch-link>${icon('search')} ${esc(a.fetchLinkBtn)}</button>
              </div>
              <span class="small-note">${esc(isAr ? 'نظام مُطابِق يستخرج المواصفات تلقائياً من الرابط أو الكتالوج المرفق.' : 'System automatically extracts specs from product web link or catalog.')}</span>
            </div>

            <!-- Evidence Documents -->
            <div class="field">
              <span class="label" id="evidence-label">${icon('upload')} ${esc(a.evidenceLabel)}</span>
              <div class="dropzone" aria-labelledby="evidence-label">
                <div class="chips">${files.map((f) => `<span class="chip">${icon('folder')} ${esc(f)}</span>`).join('')}</div>
                ${preset.isExempt ? `<p class="small-note" style="margin-top:0.6rem;color:var(--teal)"><strong>✓ ${esc(isAr ? 'الجهاز معفى بنص الملحق 3 البند (و) من الموافقة النوعية والرسوم.' : 'Device is explicitly exempt from Type Approval under TRC Annex 3.')}</strong></p>` : ''}
                <label class="field" style="margin-top:0.8rem">
                  <span class="label">${esc(a.sampleReportLabel)}</span>
                  <select name="test-report">
                    ${TEST_REPORT_OPTIONS.map((o) => `<option value="${o.id}"${o.id === state.testReport ? ' selected' : ''}>${esc(a.reports[o.id] || o.label)}</option>`).join('')}
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div>
            <p class="eyebrow" style="color:var(--muted)">${esc(a.extractedTitle)}</p>
            <table class="data-table">
              <caption class="visually-hidden">${esc(a.extractedTitle)}</caption>
              <thead class="visually-hidden"><tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">Source</th><th scope="col">State</th></tr></thead>
              <tbody>
                ${data.map((d) => {
                  const isEirpField = d.field.includes('EIRP') || d.field.includes('قدرة');
                  if (isEirpField) {
                    return `<tr>
                      <th scope="row"><label for="eirp">${esc(d.field)}</label></th>
                      <td class="value">
                        <div class="input-inline">
                          <input id="eirp" name="eirp" style="max-width:80px" inputmode="decimal" autocomplete="off" placeholder="${esc(preset.defaultEirp)}" value="${esc(state.eirp !== '' ? state.eirp : preset.defaultEirp)}" aria-describedby="eirp-help"${eirpObj.error ? ' aria-invalid="true"' : ''}>
                          <span>dBm</span>
                        </div>
                        <span id="eirp-help" class="${eirpObj.error ? 'field-error' : 'small-note'}">${esc(eirpHelpText)}</span>
                      </td>
                      <td class="src">${esc(d.source)}</td>
                      <td><span class="${eirpObj.ok ? 'ok-dot' : 'open-dot'}">${eirpObj.ok ? '✓' : '○'}</span></td>
                    </tr>`;
                  }
                  return `<tr>
                    <th scope="row">${esc(d.field)}</th>
                    <td class="value">${esc(d.value)}</td>
                    <td class="src">${esc(d.source)}</td>
                    <td><span class="ok-dot">✓</span></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>

            <div class="panel-foot">
              <span class="small-note">${esc(a.panelFootNote)}</span>
              ${next(1, a.runAssessmentBtn)}
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  if (tab === 1) {
    const counts = STATUSES.map((st) => [st.id, findings.filter((f) => f.status === st.id).length]).filter(([, n]) => n);
    return `<div>
      <div class="summary-chips" aria-label="${esc(a.summaryChipsAria)}">${counts.map(([id, n]) => statusTag(id, { count: n })).join('')}</div>
      <ul class="plain-list findings">${findings
        .map(
          (f) => `<li class="finding"><div class="finding-head"><h3>${esc(f.requirement)}</h3>${statusTag(f.status)}</div>
            <dl><dt>${esc(a.sourceLabel)}</dt><dd class="src">${esc(f.source)}</dd><dt>${esc(a.appliesLabel)}</dt><dd>${esc(f.applies)}</dd>
              <dt>${esc(a.evidenceFieldLabel)}</dt><dd>${esc(f.evidence)}</dd><dt>${esc(a.nextStepLabel)}</dt><dd>${esc(f.next)}</dd><dt>${esc(a.ownerLabel)}</dt><dd>${esc(f.owner)}</dd></dl></li>`,
        )
        .join('')}</ul>
      <div class="panel-foot"><button type="button" class="button button-secondary" data-goto-tab="0">${esc(a.editInputsBtn)}</button>${next(2, a.generateDraftBtn)}</div>
    </div>`;
  }

  const preset = getProductPreset(state.productPreset);
  const profile = getCompanyProfile();
  const r = readiness(findings);
  const clear = findings.filter((f) => f.status !== 'missing' && f.status !== 'conflict').length;
  const pct = Math.round((clear / findings.length) * 100);
  const rawEirp = state.eirp !== '' ? state.eirp : preset.defaultEirp;

  return `<div>
    <div class="trc-form-container">
      <!-- TRC Form Header -->
      <div class="trc-form-header">
        <div class="trc-header-top">
          <div>
            <div class="chips"><span class="chip chip-dark-teal">${esc(isAr ? 'المملكة الأردنية الهاشمية · هيئة تنظيم قطاع الاتصالات' : 'Hashemite Kingdom of Jordan · TRC')}</span></div>
            <h2 class="trc-official-title" style="margin-top:0.6rem">${esc(a.prefilledTitle)}</h2>
            <p class="small-note" style="margin:0">${esc(isAr ? 'نموذج رسمي صادر بموجب تعليمات تنظيم شروط وإجراءات الحصول على الموافقات النوعية لأجهزة الاتصالات وإدخالها لسنة 2025' : 'Official statutory form issued under TRC Type Approval & Import Instructions No. 2 of 2025')}</p>
          </div>
          <button type="button" class="button button-secondary button-sm" data-print-form>${icon('folder')} ${esc(a.printFormBtn)}</button>
        </div>
      </div>

      <!-- Section 1: Required Action -->
      <div class="trc-form-section">
        <h3 class="trc-sec-title">${esc(a.sec1Title)}</h3>
        <div class="trc-checkbox-row">
          <span class="trc-chk"><input type="checkbox" checked disabled> ${esc(a.actionNew)}</span>
          <span class="trc-chk"><input type="checkbox" checked disabled> ${esc(a.actionImport)} (${esc(isAr ? 'لغايات العرض والتخزين والمتاجرة' : 'Commercial Import')})</span>
        </div>
      </div>

      <!-- Section 2: Applicant Information (Matches user screenshot) -->
      <div class="trc-form-section">
        <h3 class="trc-sec-title">${esc(a.sec2Title)}</h3>
        <table class="trc-table">
          <tbody>
            <tr><th style="width:25%">${esc(isAr ? 'الاسم' : 'Name')}</th><td><strong>${esc(profile.name)}</strong></td></tr>
            <tr><th>${esc(isAr ? 'العنوان' : 'Address')}</th><td>${esc(profile.address)}</td></tr>
            <tr><th>${esc(isAr ? 'رقم الهاتف' : 'Telephone')}</th><td class="mono">${esc(profile.phone)}</td></tr>
            <tr><th>${esc(isAr ? 'رقم الفاكس' : 'Fax')}</th><td class="mono">${esc(profile.fax)}</td></tr>
            <tr><th>${esc(isAr ? 'صندوق البريد' : 'P.O. Box')}</th><td>${esc(profile.poBox)}</td></tr>
            <tr><th>${esc(isAr ? 'البريد الإلكتروني' : 'E-mail')}</th><td class="mono">${esc(profile.email)}</td></tr>
            <tr><th>${esc(isAr ? 'اسم ضابط الارتباط' : 'Liaison Officer')}</th><td>${esc(profile.liaisonOfficer)}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Section 3: Certificate Holder Information (Matches user screenshot) -->
      <div class="trc-form-section">
        <h3 class="trc-sec-title">${esc(a.sec3Title)}</h3>
        <table class="trc-table">
          <tbody>
            <tr><th style="width:25%">${esc(isAr ? 'اسم الشركة' : 'Company Name')}</th><td><strong>${esc(profile.name)}</strong></td></tr>
            <tr><th>${esc(isAr ? 'العنوان' : 'Address')}</th><td>${esc(profile.address)}</td></tr>
            <tr><th>${esc(isAr ? 'رقم الهاتف' : 'Telephone')}</th><td class="mono">${esc(profile.phone)}</td></tr>
            <tr><th>${esc(isAr ? 'رقم الفاكس' : 'Fax')}</th><td class="mono">${esc(profile.fax)}</td></tr>
            <tr><th>${esc(isAr ? 'صندوق البريد' : 'P.O. Box')}</th><td>${esc(profile.poBox)}</td></tr>
            <tr><th>${esc(isAr ? 'البريد الإلكتروني' : 'E-mail')}</th><td class="mono">${esc(profile.email)}</td></tr>
            <tr><th>${esc(isAr ? 'اسم ضابط الارتباط' : 'Liaison Officer')}</th><td>${esc(profile.liaisonOfficer)}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Section 4: Device Information -->
      <div class="trc-form-section">
        <h3 class="trc-sec-title">${esc(a.sec4Title)}</h3>
        <table class="trc-table">
          <tbody>
            <tr><th style="width:25%">${esc(isAr ? 'العلامة التجارية' : 'Brand Name')}</th><td>${esc(preset.brand)}</td></tr>
            <tr><th>${esc(isAr ? 'الطراز' : 'Model')}</th><td class="mono"><strong>${esc(preset.model)}</strong></td></tr>
            <tr><th>${esc(isAr ? 'نوع الجهاز' : 'Equipment Type')}</th><td>${esc(preset.type)}</td></tr>
            <tr><th>${esc(isAr ? 'الاسم التجاري للمنتج' : 'Marketing Name')}</th><td>${esc(preset.marketingName)}</td></tr>
            <tr><th>${esc(isAr ? 'اسم الشركة المصنعة' : 'Manufacturer Name')}</th><td>${esc(preset.manufacturer)}</td></tr>
            <tr><th>${esc(isAr ? 'عنوان الشركة المصنعة' : 'Manufacturer Address')}</th><td>${esc(preset.manufacturerAddress)}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Section 5: Technical Specifications -->
      <div class="trc-form-section">
        <h3 class="trc-sec-title">${esc(a.sec5Title)}</h3>
        <table class="trc-table">
          <tbody>
            <tr><th style="width:25%">${esc(isAr ? 'نطاق التردد (إرسال/استقبال)' : 'Frequency Range (Tx/Rx)')}</th><td>${esc(preset.frequencyRange)}</td></tr>
            <tr><th>${esc(isAr ? 'عرض النطاق الترددي' : 'Bandwidth')}</th><td>${esc(preset.bandwidth)}</td></tr>
            <tr><th>${esc(isAr ? 'قدرة البث الإشعاعي (EIRP)' : 'RF Output Power (EIRP)')}</th><td><strong>${esc(rawEirp)} dBm</strong> (${esc(isAr ? 'مدخل وموثق' : 'Declared & Documented')})</td></tr>
            <tr><th>${esc(isAr ? 'البطارية والتغذية الكهربائية' : 'Battery & Power Supply')}</th><td>${esc(preset.battery)}</td></tr>
            <tr><th>${esc(isAr ? 'المواصفات القياسية المعتمدة' : 'Applicable Harmonized Standards')}</th><td>${preset.standards.map((st) => `<span class="chip" style="margin:2px">${esc(st.code)}</span>`).join('')}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Section 6: Fees Schedule (Annex 2) -->
      <div class="trc-form-section">
        <h3 class="trc-sec-title">${esc(a.sec6Title)}</h3>
        <div class="trc-fees-box">
          ${preset.isExempt
            ? `<p style="margin:0;color:var(--teal)"><strong>✓ ${esc(isAr ? 'الجهاز معفى بالكامل من رسوم الموافقة النوعية ورسوم دراسة الطلب بموجب الملحق (3) البند (و).' : 'Equipment is fully EXEMPT from review & certificate fees under TRC Annex 3, Item (w).')}</strong></p>`
            : `<div class="fees-summary-grid">
                <div><span>${esc(isAr ? 'رسم دراسة الطلب:' : 'Application Fee:')}</span> <strong class="mono">${preset.fees.application} ${preset.fees.currency}</strong></div>
                <div><span>${esc(isAr ? 'رسم إصدار الموافقة النوعية:' : 'Approval Certificate Fee:')}</span> <strong class="mono">${preset.fees.approval} ${preset.fees.currency}</strong></div>
                <div><span>${esc(isAr ? 'إجمالي الرسوم المقررة:' : 'Total Payable Fees:')}</span> <span class="badge-total mono">${preset.fees.total} ${preset.fees.currency}</span></div>
              </div>`}
        </div>
      </div>

      <!-- Section 7: Applicant Declaration & Signatures -->
      <div class="trc-form-section">
        <h3 class="trc-sec-title">${esc(isAr ? '٧. إقرار وتفويض مقدم الطلب' : '7. Applicant Declaration & Authorization')}</h3>
        <p style="font-size:0.9rem;color:var(--muted);margin-bottom:1rem">
          ${esc(isAr ? 'أقر أنا الموقع أدناه بصحة كافة البيانات الفنية والثبوتية المذكورة أعلاه والمرفقة بهذا الطلب، وبأن الأجهزة مطابقة لتعليمات هيئة تنظيم قطاع الاتصالات النافذة في المملكة.' : 'I, the undersigned, hereby declare that all technical specifications and evidence documents attached are true, correct and compliant with TRC applicable regulations.')}
        </p>
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:1.5rem;padding-top:1rem;border-top:1px dashed #cbd5e1">
          <div><span>${esc(isAr ? 'اسم المفوض:' : 'Authorized Person:')}</span> <strong>${esc(profile.liaisonOfficer)}</strong></div>
          <div><span>${esc(isAr ? 'التوقيع:' : 'Signature:')}</span> ____________________</div>
          <div><span>${esc(isAr ? 'الختم الرسمي:' : 'Official Stamp:')}</span> [ _________________ ]</div>
          <div><span>${esc(isAr ? 'التاريخ:' : 'Date:')}</span> <strong class="mono">2026-10-10</strong></div>
        </div>
      </div>
    </div>

    <!-- Compliance Summary & Readiness Card -->
    <div style="margin-top:1.5rem">
      <div class="app-readiness on-dark">${readinessCard(
        a.appChecklist.map(([title, val], idx) => [title, idx === 2 ? r.blocking.length === 0 : val]),
        {
          pct,
          left: r.ready ? (isAr ? 'جاهز لمراجعة مقدم الطلب والتقديم' : 'Ready for applicant review & submission') : (isAr ? `${r.blocking.length} بنود تتطلب الإجراء قبل المراجعة` : `${r.blocking.length} open items before review`),
          right: isAr ? 'القرار: هيئة تنظيم قطاع الاتصالات' : 'Decision: TRC Official Authority',
          title: isAr ? 'جاهزية ملف المعاملة' : 'Application Dossier Readiness',
        },
      )}</div>
      <p class="small-note" style="margin-top:.8rem">${esc(a.appFootNote)}</p>
    </div>

    <div class="panel-foot">
      <button type="button" class="button button-secondary" data-goto-tab="1">${esc(a.backToFindingsBtn)}</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------------------------------------ search renderers
function renderSearchError(error) {
  const ask = t().ask;
  if (error.kind === 'offline') {
    return `<div class="card notice">${guide({ pose: 'shrug', className: 'is-quiet' })}<div>
      <h2>${esc(ask.errOfflineTitle)}</h2>
      <p>${ask.errOfflineDesc}</p></div></div>`;
  }
  return `<div class="card notice">${guide({ pose: 'shrug', className: 'is-quiet' })}<div>
    <h2>${esc(ask.errFailedTitle)}</h2><p>${esc(error.message)}</p></div></div>`;
}

function renderResults(pkg) {
  const ask = t().ask;
  const items = pkg.items || [];
  const warnings = (pkg.warnings || []).map((w) => `<li>${esc(w)}</li>`).join('');
  if (!items.length) {
    return `<p class="results-summary">${ask.noResults(esc(pkg.query))}</p>${warnings ? `<ul class="caveats">${warnings}</ul>` : ''}`;
  }
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
    <p class="results-summary">${ask.provisionsCount(retrieved.length, esc(pkg.query), items.length - retrieved.length)}</p>
    ${shared.size ? `<details class="caveats card" open><summary>${esc(ask.sharedCaveats)}</summary><ul>${[...shared].map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
    ${warnings ? `<ul class="caveats">${warnings}</ul>` : ''}
    <ol class="evidence-list" role="list">${ordered.map((item) => renderEvidence(item, number, shared)).join('')}</ol>`;
}

function renderEvidence(item, number, shared) {
  const ask = t().ask;
  const c = item.citation;
  const context = item.relation !== 'retrieved';
  const exact = !context && item.signal?.exact_reference;
  const where = getArticleLabel(c);
  const parent = context && number.get(item.related_to);
  const own = item.caveats.filter((x) => !shared.has(x));
  const url = safeUrl(c.source_url);
  const long = item.text_original.length > 520;
  const lang = c.language === 'en' ? 'en' : 'ar';
  const isAr = t().lang === 'ar';

  return `<li class="evidence${context ? ' is-context' : ''}${exact ? ' is-exact' : ''}">
    <div class="evidence-head">
      <h3>${!context ? `<span class="visually-hidden">Result ${number.get(item.chunk_id)}: </span>` : ''}${esc(shortName(c.document_id))}${
        where ? `<span class="where">${esc(where)}</span>` : ''
      }</h3>
      <div class="chips">
        <span class="chip ${context ? '' : 'chip-teal'}">${esc(getRelationLabel(item))}${parent ? (isAr ? ` · للنتيجة ${parent}` : ` · for result ${parent}`) : ''}</span>
        ${item.chunk_type === 'amendment_history' ? `<span class="chip chip-gold">${isAr ? 'ملاحظة تعديل' : 'Amendment note'}</span>` : ''}
        ${c.page_start ? `<span class="chip mono">${esc(getPageLabel(c.page_start, c.page_end))}</span>` : ''}
      </div>
    </div>
    <p class="evidence-text${long ? ' is-clamped' : ''}" lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">${esc(item.text_original)}</p>
    ${long ? `<button type="button" class="link-button" data-more aria-expanded="false">${esc(ask.showFull)}</button>` : ''}
    <div class="evidence-meta">
      <span>${esc(c.document_type)} · ${esc(c.binding_nature)}</span>
      <span class="mono">${esc(c.version_label)}</span>
      <span>${esc(getExtractionLabel(c.extraction_method))}</span>
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(ask.officialPdf)}<span class="visually-hidden"> (opens in a new tab)</span></a>` : ''}
    </div>
    ${own.length ? `<details class="caveats"><summary>${ask.caveatsCount(own.length)}</summary><ul>${own.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
  </li>`;
}

function renderSource(d, live) {
  const src = t().sources;
  const url = safeUrl(d.official_url);
  const isAr = t().lang === 'ar';
  const title = isAr && d.title_original ? d.title_original : (d.title_en || d.title_original);
  const subTitle = isAr && d.title_en ? d.title_en : (d.original_language === 'ar' ? d.title_original : null);

  return `<li class="card source">
    <p class="ar-title" ${d.original_language === 'ar' ? 'lang="ar" dir="rtl"' : 'lang="en"'}>${esc(title)}</p>
    ${subTitle && subTitle !== title ? `<p class="en-title">${esc(subTitle)}</p>` : ''}
    <div class="chips"><span class="chip">${esc(d.document_type)}</span><span class="chip">${esc(d.binding_nature)}</span>
      <span class="status status-verify"><span class="mark" aria-hidden="true">?</span>${isAr ? 'الحالة القانونية: قيد المراجعة الرسمية' : `Legal status: ${d.legal_status === 'unknown' ? 'not verified' : esc(d.legal_status)}`}</span></div>
    <dl>
      <dt>${esc(src.issuedBy)}</dt><dd>${esc(d.issuing_authority)}</dd>
      ${d.gazette_reference ? `<dt>${esc(src.gazette)}</dt><dd>${esc(d.gazette_reference)}</dd>` : ''}
      ${d.amendment_info ? `<dt>${esc(src.amendments)}</dt><dd>${esc(d.amendment_info)}</dd>` : ''}
      ${live && d.extraction_method ? `<dt>${esc(src.textExtracted)}</dt><dd>${esc(getExtractionLabel(d.extraction_method))}</dd>` : ''}
      ${live && d.version_label ? `<dt>${esc(src.versionMeta)}</dt><dd class="mono">${esc(d.version_label)} · ${esc(d.page_count)} ${isAr ? 'صفحات' : 'pages'} · ${esc(d.chunks)} ${isAr ? 'مقاطع' : 'passages'}</dd>` : ''}
    </dl>
    <div class="card-foot">${url ? `<a class="button button-secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t().ask.officialPdf)}<span class="visually-hidden"> (opens in a new tab)</span></a>` : ''}
      <a class="button button-secondary" href="${esc(hrefFor('ask'))}" data-route-link>${esc(src.searchIt)}</a></div>
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

  const routeLocalized = t().routes[target.route.id] || target.route;
  document.title = target.route === NOT_FOUND ? `${t().routes.notfound.title} · ${t().brandName}` : `${routeLocalized.title} · ${t().brandName}`;
  $$('[data-route]', nav).forEach((link) => {
    if (link.dataset.route === target.route.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (target.push && location.hash !== target.hash) history.pushState(null, '', target.hash);
  else if (!target.push && location.hash && location.hash !== target.hash) history.replaceState(null, '', target.hash);
  router.renderedHash = target.hash;
  setMenu(false);
  window.scrollTo(0, 0);
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

const navigate = createNavigator({
  async cover(target) {
    const back = $('.cover-back', cover);
    const front = $('.cover-front', cover);
    const from = (el) => getComputedStyle(el).transform;
    const start = [from(back), from(front)];
    stopCoverAnimations();
    $('.cover-scene', cover).innerHTML = guide({ pose: target.route.scene });
    const routeLoc = t().routes[target.route.id] || target.route;
    $('.cover-caption', cover).textContent = routeLoc.caption;
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
  navigate(target, !motionAllowed() || document.hidden);
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#/"]');
  if (!link || event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  request(link.getAttribute('href'));
});

const sync = () => {
  const hash = normalize(location.hash || '#/');
  if (hash !== (router.pendingHash ?? router.renderedHash)) request(hash, { push: false });
};
window.addEventListener('popstate', sync);
window.addEventListener('hashchange', sync);

// ------------------------------------------------------------------------------------------ boot
applyLanguage();
applyMotion();
const first = normalize(location.hash || '#/');
commit({ ...resolveRoute(first), hash: first, push: false }, { focus: false });
