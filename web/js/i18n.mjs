// Internationalization (i18n) for MUTABIQ UI.
// Defaults to Arabic ('ar') as requested, with instant toggle to English ('en').

const LANG_KEY = 'mutabiq.ui.v1.lang';

export function getInitialLang() {
  try {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch {
    // Storage access may be restricted
  }
  return 'ar'; // Default language is Arabic
}

export let currentLang = getInitialLang();

export function setLanguage(lang) {
  currentLang = lang === 'en' ? 'en' : 'ar';
  try {
    window.localStorage.setItem(LANG_KEY, currentLang);
  } catch {
    // Storage access may be restricted
  }
}

export const STRINGS = {
  ar: {
    dir: 'rtl',
    lang: 'ar',
    brandName: 'مُطابِق',
    brandSub: 'MUTABIQ',
    skipLink: 'الانتقال إلى المحتوى',
    menu: 'القائمة',
    pauseMotion: 'إيقاف الحركة',
    resumeMotion: 'استئناف الحركة',
    langToggle: 'English',
    langToggleAria: 'التبديل إلى اللغة الإنجليزية (Switch to English)',

    nav: {
      home: 'نظرة عامة',
      assessment: 'تقييم المطابقة',
      ask: 'البحث في التشريعات',
      sources: 'قاعدة المعرفة',
    },

    routes: {
      home: { nav: 'نظرة عامة', title: 'كل متطلب، له دليل', caption: 'مطابقة المتطلبات' },
      assessment: { nav: 'تقييم المطابقة', title: 'تقييم مطابقة جديد', caption: 'فحص كل متطلب' },
      ask: { nav: 'البحث في التشريعات', title: 'البحث في الأنظمة والتعليمات', caption: 'استخراج السند القانوني' },
      sources: { nav: 'قاعدة المعرفة', title: 'قاعدة المعرفة التنظيمية', caption: 'استعراض النصوص الرسمية' },
      notfound: { title: 'الصفحة غير موجودة', caption: 'البحث في الأرجاء' },
    },

    hero: {
      team: 'فريق ZAA',
      event: 'مسابقة الذكاء الاصطناعي 2026',
      title: 'كل متطلب، <span class="accent-text">له دليل.</span>',
      taglineSub: 'Every requirement, backed by evidence.',
      lede: 'الامتثال التنظيمي المدعوم بالذكاء الاصطناعي وإعداد طلبات المطابقة للمنتجات الداخلة إلى السوق الأردني.',
      startBtn: 'بدء تقييم مطابقة',
      searchBtn: 'البحث في التشريعات',
    },

    problem: {
      eyebrow: 'المشكلة',
      title: 'منتج واحد. جهات تنظيمية متعددة. متطلبات مبعثرة.',
      lede: 'قبل وصول أي منتج خاضع للتنظيم إلى السوق الأردني، يتعين على موظف الاستيراد الإجابة يدوياً عن الأسئلة التالية:',
      questions: [
        'ما هي القواعد والتعليمات التي تنطبق على هذا المنتج تحديداً؟',
        'ما هي الأدلة والوثائق المطلوبة لإثبات كل متطلب؟',
        'ما هي النواقص أو التناقضات في الملف قبل تقديمه؟',
        'كيف نعبئ طلب المطابقة الرسمي بأعلى دقة وموثوقية؟',
      ],
      regulators: [
        { name: 'هيئة تنظيم قطاع الاتصالات (TRC)', area: 'أجهزة الاتصالات وتكنولوجيا المعلومات' },
        { name: 'مؤسسة المواصفات والمقاييس (JSMO)', area: 'المعايير والمطابقة وضبط الجودة' },
        { name: 'المؤسسة العامة للغذاء والدواء (JFDA)', area: 'الأغذية والأدوية ومستحضرات التجميل' },
        { name: 'دائرة الجمارك الأردنية', area: 'التخليص والبيانات الجمركية' },
        { name: 'وزارة الزراعة', area: 'المنتجات الزراعية والحيوانية والمدخلات' },
      ],
      yourProduct: 'منتجك المستورد',
      andOthers: '...وجهات أخرى بحسب طبيعة المنتج وتصنيفه',
    },

    solution: {
      eyebrow: 'الحل',
      title: 'مُطابِق: مساعد ذكي للامتثال التنظيمي لأي منتج مستورد',
      steps: [
        { n: '01', icon: 'box', title: 'وصف المنتج', text: 'الرابط، المواصفات الفنية، وأي وثائق متوفرة' },
        { n: '02', icon: 'search', title: 'استخراج القواعد المنطبقة', text: 'مباشرة من التشريعات والأنظمة الرسمية' },
        { n: '03', icon: 'check', title: 'فحص كل متطلب', text: 'بمقارنته بالأدلة الثبوتية المقدمة' },
        { n: '04', icon: 'list', title: 'توثيق وتفسير كل نتيجة', text: 'مع ذكر المادة القانونية وسندها الدقيق' },
        { n: '05', icon: 'folder', title: 'إعداد حزمة الطلب', text: 'جاهزة للمراجعة والاعتماد الرسمي' },
      ],
      engineNote: 'إضافة فئة منتجات جديدة يتطلب فقط إدراج تشريعاتها في قاعدة المعرفة، ويبقى محرك النظام كما هو.',
      beforeSubmission: 'مُطابِق: قبل التقديم',
      beforeChips: ['نتائج مستندة للأنظمة', 'تحديد فجوات الأدلة', 'مسودة الطلب الرسمي', 'حزمة ملفات منظمة'],
      middleSign: 'المستورد يراجع<br>ويوقع رسمياً',
      officialAuthority: 'الجهة الرسمية: القرار النهائي',
      authorityChips: ['مراجعة الطلب والملف', 'الموافقة أو الرفض', 'إصدار الشهادة الرسمية'],
    },

    usage: {
      eyebrow: 'آلية الاستخدام',
      title: 'مدخلان.. ومخرجان',
      companyTitle: 'ملف الشركة',
      companyBadge: 'يُدخل لمرة واحدة',
      companyChips: ['الاسم التجاري المسجل', 'الرقم الوطني للمنشأة', 'العنوان وبيانات الاتصال', 'المفوض بالتوقيع', 'رخص وبطاقات الاستيراد'],
      productTitle: 'بيانات المنتج',
      productBadge: 'لكل منتج',
      productChips: ['رابط المنتج أو اسمه', 'فئة المنتج', 'المواصفات الفنية الأساسية', 'أي وثائق اختبار أو شهادات متوفرة'],
      noDocsNote: 'ليس لديك وثائق بعد؟ سيحدد مُطابِق بدقة الوثائق والأدلة التي ستحتاجها للمعاملة.',
      findingsTitle: 'نتائج تقييم المطابقة',
      findingsSub: 'لكل متطلب: المصدر القانوني · الانطباق · الدليل · الحالة · الخطوة التالية',
      packageTitle: 'حزمة الطلب الجاهزة',
      packageChips: ['نموذج رسمي معبأ مسبقاً', 'قائمة التحقق من الأدلة', 'الخطوات والإجراءات القادمة'],
      packageNote: 'الحقول غير المؤكدة تُوضع تحت المراجعة ولا يتم تخمينها مطلقاً. الإقرارات والتوقيع تبقى مسؤولية المستورد.',
    },

    trust: {
      eyebrow: 'ذكاء اصطناعي مسؤول',
      title: 'الثقة بالتصميم: ذكاء اصطناعي يبرز أدلته وسنده',
      sub: 'غياب الوثيقة يُسجل كنقص في الأدلة، وليس دليلاً على عدم مطابقة المنتج.',
      safeguards: [
        { icon: 'book', title: 'لا نتيجة بلا سند قانوني', text: 'كل نتيجة ترتبط بمادة أو فقرة قانونية رسمية محددة.' },
        { icon: 'list', title: 'قواعد خوارزمية قطعية', text: 'فحص وجود الوثائق وتطابق أرقام الطراز يتم برمجياً بدقة متناهية.' },
        { icon: 'question', title: '«بحاجة إلى تحقق» وليس تخميناً', text: 'أي بيانات غير مؤكدة تُحال إلى المراجع البشري للتحقق منها.' },
        { icon: 'dashed', title: 'النقص ليس مخالفة', text: 'غياب الدليل يُسجل كنقص في الملف يحتاج استكمالاً، وليس مخالفة نظامية.' },
        { icon: 'sign', title: 'مراجعة بشرية وتوقيع رسمي', text: 'مقدم الطلب يؤكد كل حقل بنفسه قبل التوقيع والاعتماد.' },
        { icon: 'bank', title: 'الجهة الرسمية هي صاحبة القرار', text: 'مُطابِق يعد الملف ويسهل الإجراءات، ولا يصدر موافقات رسمية.' },
      ],
    },

    proto: {
      eyebrow: 'هذا النموذج الأولي',
      title: 'ما يعمل اليوم، وما هو إيضاحي تجريبي',
      workingTitle: 'يعمل فعلياً',
      workingBadge: 'نشط',
      workingList: [
        'سبعة نصوص رسمية مفهرسة، منها تعليمات هيئة الاتصالات رقم (2) لسنة 2025 وملاحقها وقائمة القواعد الفنية، مقسمة إلى مواد وتعريفات وتعديلات.',
        'بحث فوري باللغتين العربية والإنجليزية مع إبراز المادة والصفحة ورقم الإصدار لكل نتيجة.',
        'تصنيف مستويات اليقين: الوضع القانوني قيد التحقق، نصوص مسترجعة، ونصوص معدلة.',
      ],
      openSearch: 'فتح البحث في التشريعات',
      demoTitle: 'إيضاحي تجريبي',
      demoBadge: 'محاكاة',
      demoList: [
        'تجربة تقييم الهاتف الذكي DEMO-X1 تعمل على بيانات عيّنة افتراضية.',
        'استشهادات المتطلبات تشير إلى تعليمات هيئة الاتصالات وملاحقها وتمت مطابقتها مع النصوص الرسمية؛ أما الأجهزة والوثائق فافتراضية.',
        'الاستنتاج الذكي عبر النماذج اللغوية (LLM) مخطط له في المرحلة القادمة.',
      ],
      seeSources: 'استعراض قاعدة المعرفة',
    },

    closing: {
      tag: 'فريق ZAA · مسابقة الذكاء الاصطناعي 2026',
      title: 'كل متطلب، <span class="accent-text">له دليل.</span>',
      taglineSub: 'Every requirement, backed by evidence.',
      lede: 'مُطابِق يجهز الملف، والجهة صاحبة القرار تتخذه. تصل المنتجات للسوق الأردني بأقل قدر من التأخير الممكن.',
      readiness: [
        ['استخراج القواعد المنطبقة', true],
        ['مطابقة الأدلة مع كل متطلب', true],
        ['تحديد الفجوات قبل التقديم', true],
        ['ربط كل نتيجة بمصدرها الرسمي', true],
        ['تعبئة مسودة النموذج الرسمي', true],
      ],
      readyLabel: 'جاهز لمراجعة المستورد',
      decisionLabel: 'القرار: الجهة الرسمية',
    },

    assessment: {
      badge1: 'تجربة حية',
      badge2: 'نطاق التجربة: أجهزة الاتصالات · هيئة تنظيم قطاع الاتصالات (TRC)',
      title: 'التجربة الفنية: <span class="accent-text">حالة متكاملة خطوة بخطوة</span>',
      lede: 'الموافقة النوعية لهاتف ذكي: من المدخلات إلى النتائج إلى مسودة الطلب الرسمي. غيّر الأدلة وشاهد كيف تنعكس النتائج فوراً.',
      notice: '<strong>بيانات عيّنة.</strong> الأجهزة والشركة والوثائق والأرقام افتراضية. تشير الاستشهادات إلى تعليمات هيئة تنظيم قطاع الاتصالات رقم (2) لسنة 2025 وملاحقها وقائمة القواعد الفنية، وهي مفهرسة الآن في قاعدة المعرفة وتمت مطابقتها مع ملفات PDF الرسمية. ولا يغني ذلك عن المراجعة القانونية.',
      flowTitle: 'مسار التجربة',
      flowSteps: [
        'إدخال البيانات والوثائق',
        'تشغيل التقييم الفني',
        'مراجعة نتائج المطابقة',
        'الاطلاع على السند التنظيمي',
        'إنشاء مسودة طلب المطابقة',
      ],
      tabs: ['1 · المدخلات', '2 · النتائج', '3 · الطلب'],
      sampleDataBadge: 'بيانات عيّنة',
      statusHead: 'حالات الأدلة',
      statusTitle: 'حالة الدليل، وليس حكماً بالامتثال',
      statusSub: 'تستخدم كل نتيجة إحدى خمس حالات واضحة. لا تعني أي منها «مطابق رسمياً»: الجهة الرسمية وحدها هي صاحبة القرار.',
      
      // 2-Stage Inputs
      stage1Eyebrow: 'المرحلة الأولى: ملف المنشأة المسجلة (تُحفظ تلقائياً ولا تتكرر)',
      editCompanyBtn: 'تعديل بيانات الشركة',
      saveCompanyBtn: 'حفظ بيانات المنشأة',
      cancelEditBtn: 'إلغاء',
      companySavedNote: 'بيانات المنشأة محفوظة محلياً؛ لن تضطر لإدخالها مجدداً في كل معاملة.',
      
      stage2Eyebrow: 'المرحلة الثانية: بيانات المنتج والمواصفات الفنية',
      presetLabel: 'اختر نموذجاً جاهزاً للتجربة أو أدخل منتجك',
      productLinkLabel: 'رابط المنتج أو الكتالوج التقني',
      fetchLinkBtn: 'تحميل مواصفات العيّنة (عرض توضيحي)',
      evidenceLabel: 'وثائق المواصفات والاختبار (Datasheet / DoC / Test Report)',
      sampleReportLabel: 'حالة تقرير الاختبار (اعتماد المختبر)',
      reports: {
        match: 'تقرير اختبار معتمد يغطي الطراز بالكامل (مطابق)',
        mismatch: 'تقرير اختبار يشير إلى طراز مغاير DEMO-X0 (تعارض)',
        none: 'لا يوجد تقرير اختبار معتمد بعد (نقص في الأدلة)',
      },
      extractedTitle: 'المواصفات الفنية المستخرجة من الوثائق',
      eirpPlaceholder: 'بوحدة dBm',
      eirpHelpDefault: 'قدرة البث الإشعاعي (EIRP) بوحدة dBm.',
      eirpHelpValid: 'dBm، مدخل مؤكد من التقرير الفني.',
      eirpErrorNumeric: 'يرجى إدخال رقم بوحدة dBm، مثلاً 23.',
      eirpErrorRange: 'المتوقع قيمة بين -10 و 60 dBm.',
      panelFootNote: 'القيم مأخوذة من نشرات المواصفات النموذجية، والمعايير مطابقة لقائمة القواعد الفنية لهيئة الاتصالات. قراءة المواصفات من رابط المنتج غير متاحة بعد.',
      runAssessmentBtn: 'تشغيل الفحص الفني والمطابقة',

      // Findings Panel
      summaryChipsAria: 'النتائج مصنفة حسب الحالة',
      sourceLabel: 'السند الرسمي',
      appliesLabel: 'الانطباق',
      evidenceFieldLabel: 'الدليل المستند إليه',
      nextStepLabel: 'الإجراء المطلوب',
      ownerLabel: 'المسؤول',
      editInputsBtn: 'العودة للمدخلات',
      generateDraftBtn: 'معاينة النموذج الرسمي المعبأ',

      // Application Panel - Official TRC Form (Annex 1)
      prefilledTitle: 'الملحق رقم (1): نموذج طلب الحصول على الموافقة النوعية لأجهزة الاتصالات و/أو إدخالها إلى المملكة',
      sec1Title: '١. الإجراء المطلوب',
      actionNew: 'الحصول على الموافقة النوعية: موافقة جديدة',
      actionImport: 'إدخال أجهزة الاتصالات',
      sec2Title: '٢. بيانات مقدم الطلب (Applicant)',
      sec3Title: '٣. بيانات حامل الموافقة النوعية (Type Approval Certificate Holder)',
      sec4Title: '٤. بيانات الجهاز (Device Information)',
      sec5Title: '٥. المواصفات الفنية (Technical Specifications)',
      sec6Title: '٦. الرسوم المقررة بموجب الملحق (2)',
      checklistTitle: 'قائمة التحقق من بنود الامتثال',
      nextStepsTitle: 'الخطوات والإجراءات القادمة',
      applicantRow: 'مقدم الطلب',
      companyProfileSource: 'ملف الشركة المحفوظ',
      decAndSig: 'الإقرارات والتوقيع الرسمي',
      leftForApplicant: 'متروك لمقدم الطلب للتوقيع والختم',
      unconfirmed: 'غير مؤكد',
      missingNotFilled: 'ناقص: يتطلب استكمال',
      noOpenSteps: 'جميع المتطلبات مكتملة. الملف جاهز للمراجعة والتوقيع والتقديم.',
      appChecklist: [
        ['استخراج المعايير المنطبقة من تعليمات الهيئة 2/2025', true],
        ['مطابقة المعايير الأوروبية (ETSI EN) المعتمدة', true],
        ['فحص كفاية تقارير الاختبار واعتماد المختبرات (ILAC)', true],
        ['التأكد من حدود قدرة الإرسال والترددات المصرح بها', true],
        ['تعبئة نموذج الملحق رقم 1 الرسمي مع احتساب الرسوم', true],
      ],
      appFootNote: 'مُطابِق يعد الملف وحزمة الطلب، والجهة الرسمية (هيئة تنظيم قطاع الاتصالات) تتخذ القرار النهائي.',
      backToFindingsBtn: 'العودة إلى النتائج',
      printFormBtn: 'طباعة المسودة (PDF)',
    },

    ask: {
      eyebrow: 'البحث في الأدلة',
      title: 'البحث في التشريعات والأنظمة',
      lede: 'ابحث عن المادة القانونية الدقيقة وراء أي متطلب. النتائج مسترجعة من النصوص الرسمية في قاعدة المعرفة، باللغتين العربية والإنجليزية مع السند القانوني الكامل. لا يوجد نصوص مولدة.',
      questionLabel: 'سؤالك أو استفسارك',
      placeholder: 'مثال: ما هي رسوم اصدار رخصة الاستيراد؟ أو: هل يشترط تسجيل المبيدات الزراعية قبل استيرادها؟',
      submitBtn: 'البحث عن الدليل',
      tryLabel: 'جرّب:',
      optionsSummary: 'خيارات البحث',
      instrumentLabel: 'التشريع / الوثيقة',
      allDocs: 'الكل في قاعدة المعرفة',
      expandLabel: 'إضافة التعريفات والمواد المرتبطة والمحالة',
      historyLabel: 'تضمين ملاحظات التعديلات التاريخية (قد تذكر نصوصاً ملغاة)',
      statusChecking: 'جاري التحقق من خدمة البحث…',
      statusReady: (docs, chunks, emb, rerank) =>
        `خدمة البحث جاهزة: ${docs} تشريعات، ${chunks} مقطعاً قانونياً (${emb}${rerank ? ' + إعادة ترتيب' : ''}).`,
      statusOffline: 'خدمة البحث غير متصلة. يرجى تشغيلها عبر: uv run import-compliance-rag serve',
      typeFirst: 'يرجى كتابة سؤالك أولاً، باللغة العربية أو الإنجليزية.',
      searching: 'جاري البحث في قاعدة المعرفة…',
      noResults: (q) => `لم يتم العثور على أدلة مطابقة للسؤال: <strong dir="auto">${q}</strong>.`,
      provisionsCount: (retrieved, q, extra) =>
        `<strong>${retrieved} مادة وقيد قانوني</strong> متعلقة بـ <strong dir="auto">${q}</strong>${
          extra > 0 ? `، بالإضافة إلى ${extra} مادة ساندة ومفسرة` : ''
        }. يرجى قراءة النص الأصلي كاملاً قبل الاعتماد عليه.`,
      sharedCaveats: 'تنبيهات تنطبق على جميع النتائج المسترجعة',
      caveatsCount: (n) => `${n} ملاحظة وتنبيه لهذه المادة`,
      showFull: 'عرض النص كاملاً',
      showLess: 'عرض أقل',
      officialPdf: 'ملف PDF الرسمي ↗',
      errOfflineTitle: 'خدمة البحث غير متاحة حالياً.',
      errOfflineDesc: 'تحتاج هذه الصفحة إلى الخدمة المحلية. شغل الأمر: <code>uv run import-compliance-rag serve</code> ثم افتح <code>http://127.0.0.1:8765/</code>.',
      errFailedTitle: 'لم يكتمل البحث.',
    },

    sources: {
      eyebrow: 'قاعدة المعرفة التنظيمية',
      title: 'النصوص الرسمية المعتمدة وحدودها',
      lede: 'كل نتيجة واستنتاج يجب أن يستند إلى نص موثق في هذه القاعدة. إضافة فئة منتجات جديدة يعني إدراج تشريعاتها، مع بقاء المحرك ذاته. الوضع القانوني للنصوص قيد المراجعة والتحقق الرسمي.',
      loading: 'جاري تحميل سجل التشريعات والأنظمة…',
      liveStatus: (n) => `مباشرة من قاعدة البيانات: ${n} وثائق تشريعية مع النسخ الفعالة وعدد المواد.`,
      offlineStatus: 'عرض من سجل التشريعات. شغل الخدمة للاطلاع على النسخ الفعالة وتفاصيل المواد.',
      howItWorksEyebrow: 'آلية العمل',
      howItWorksTitle: 'استرجاع الأدلة المبني على النصوص الرسمية',
      kbTitle: 'قاعدة المعرفة',
      kbSub: 'تُبنى لمرة واحدة، وتُحدّث عند تعديل أي تشريع أو نظام.',
      kbStep1: 'التشريعات الرسمية من الجهات المصدرة المعتمدة',
      kbStep2: 'التقسيم إلى مواد وتعريفات وملاحظات تعديل',
      kbStep3: 'الفهرسة الدقيقة بأرقام المواد وإصدارات الملفات',
      builtBadge: 'مبني ويعمل',
      assessmentTitle: 'كل عملية تقييم',
      assessmentSub: 'تُجرى لكل منتج. حالياً يرتبط الاسترجاع بنصوص حقيقية.',
      assessStep1: 'استرجاع المواد والفقرات القانونية المنطبقة',
      assessStep2: 'استخراج ذكي لبيانات المنتج',
      assessStep3: 'استنتاج منطقي للنماذج اللغوية (LLM) فوق النصوص المسترجعة فقط',
      assessStep4: 'فحوصات قطعية وقواعد واضحة للنتائج',
      demoBadge: 'إيضاحي تجريبي',
      plannedBadge: 'مخطط له',
      notIndexedEyebrow: 'نصوص غير مفهرسة بعد',
      notIndexedTitle: 'نصوص وتشريعات لا يستشهد بها هذا النموذج حالياً',
      notIndexedSub: 'قد يعيد البحث أقرب النصوص المشابهة من التشريعات المفهرسة، لكنها لا تغطي هذه المجالات تحديداً.',
      trialBadge: 'نطاق التجربة',
      searchIt: 'ابحث في النص',
      issuedBy: 'الجهة المصدرة',
      gazette: 'الجريدة الرسمية',
      amendments: 'التعديلات',
      textExtracted: 'طريقة الاستخراج',
      versionMeta: 'النسخة والبيانات',
    },

    notfound: {
      eyebrow: 'صفحة غير معروفة',
      title: 'لا يوجد دليل لهذه الصفحة.',
      lede: (path) => `لا يوجد محتوى في المسار <code>${path}</code>. يمكنك العودة للنظرة العامة أو بدء تقييم جديد.`,
      backHome: 'العودة للنظرة العامة',
      startAssessment: 'بدء تقييم مطابقة',
    },

    statuses: {
      supported: { label: 'مدعوم بدليل', help: 'الدليل يغطي المتطلب لهذا المنتج تحديداً.' },
      missing: { label: 'نقص في الأدلة', help: 'وثيقة أو قيمة مطلوبة غير متوفرة. نقص في الملف وليس مخالفة.' },
      conflict: { label: 'تعارض في البيانات', help: 'الوثائق تختلف حول قيمة جوهرية، مثل رقم الطراز.' },
      verify: { label: 'بحاجة إلى تحقق', help: 'مدخلات يدوية أو غير مؤكدة، تتطلب تأكيداً بشرياً قبل الاعتماد.' },
      not_applicable: { label: 'غير منطبق', help: 'المتطلب لا ينطبق على طبيعة هذا المنتج، مع تسجيل سبب الاستثناء.' },
    },

    relations: {
      retrieved: 'مسترجع مباشر',
      exact_reference: 'إحالة مباشرة دقيقة',
      definition: 'تعريف قانوني معتمد',
      sibling_part: 'فقرة أخرى من المادة ذاتها',
      cross_reference: 'مادة قانونية محال إليها',
    },

    extractionMethods: {
      text_layer: 'طبقة النص الأصلية في PDF',
      font_recovery: 'مسترجع من خطوط الملف ومتحقق منه عبر OCR',
      ocr: 'التعرف الضوئي على الحروف (OCR)',
      mixed: 'طرق استخراج متعددة',
      plain_text: 'نص صريح',
    },

    shortNames: {
      'mit-import-export-law-21-2001': 'قانون الاستيراد والتصدير رقم 21/2001',
      'mit-import-export-licenses-system-114-2004': 'نظام رخص وبطاقات الاستيراد 114/2004',
      'moa-agriculture-law-13-2015': 'قانون الزراعة رقم 13/2015 وتعديلاته',
      'ustr-jordan-fta-rules-of-origin': 'اتفاقية التجارة الحرة الأردنية الأمريكية - ملحق 2.2',
      'trc-type-approval-instructions-2-2025': 'تعليمات الموافقة النوعية لأجهزة الاتصالات 2/2025',
      'trc-technical-standards-specifications': 'المواصفات القياسية لأجهزة الاتصالات (TRC)',
      'trc-type-approval-annexes-2-2025': 'ملاحق الموافقة النوعية والرسوم والاستثناءات 2/2025',
    },

    footer: {
      brand: 'مُطابِق · فريق ZAA · مسابقة الذكاء الاصطناعي 2026',
      note: 'مُطابِق يُعد الملف، والجهة الرسمية تتخذ القرار. نموذج أولي: ليس استشارة قانونية، والوضع القانوني للنصوص قيد المراجعة الرسمية.',
    },
  },

  en: {
    dir: 'ltr',
    lang: 'en',
    brandName: 'MUTABIQ',
    brandSub: 'مُطابِق',
    skipLink: 'Skip to content',
    menu: 'Menu',
    pauseMotion: 'Pause motion',
    resumeMotion: 'Resume motion',
    langToggle: 'العربية',
    langToggleAria: 'التبديل إلى اللغة العربية (Switch to Arabic)',

    nav: {
      home: 'Overview',
      assessment: 'Assessment',
      ask: 'Evidence search',
      sources: 'Knowledge base',
    },

    routes: {
      home: { nav: 'Overview', title: 'Every requirement, backed by evidence', caption: 'Matching requirements' },
      assessment: { nav: 'Assessment', title: 'New assessment', caption: 'Checking each requirement' },
      ask: { nav: 'Evidence search', title: 'Search the regulations', caption: 'Finding the clause' },
      sources: { nav: 'Knowledge base', title: 'Knowledge base', caption: 'Opening the knowledge base' },
      notfound: { title: 'Page not found', caption: 'Looking around' },
    },

    hero: {
      team: 'Team ZAA',
      event: 'AI Quest 2026',
      title: 'Every requirement, <span class="accent-text">backed by evidence.</span>',
      taglineSub: 'كل متطلب، له دليل.',
      lede: 'AI-powered regulatory compliance and application preparation for products entering the Jordanian market.',
      startBtn: 'Start an assessment',
      searchBtn: 'Search the regulations',
    },

    problem: {
      eyebrow: 'The problem',
      title: 'One product. Several regulators. Scattered requirements.',
      lede: 'Before a regulated product reaches the Jordanian market, someone in the importing company has to answer, mostly by hand:',
      questions: [
        'Which rules apply to this product?',
        'Which evidence proves each requirement?',
        'What is missing or inconsistent?',
        'How do we fill the official application?',
      ],
      regulators: [
        { name: 'TRC', area: 'Telecom devices' },
        { name: 'JSMO', area: 'Standards & conformity' },
        { name: 'JFDA', area: 'Food, drugs & cosmetics' },
        { name: 'Jordan Customs', area: 'Clearance & declarations' },
        { name: 'Ministry of Agriculture', area: 'Plant & animal products' },
      ],
      yourProduct: 'Your product',
      andOthers: '…and others, depending on the product',
    },

    solution: {
      eyebrow: 'The solution',
      title: 'MUTABIQ: a compliance co-pilot for any imported product',
      steps: [
        { n: '01', icon: 'box', title: 'Describe the product', text: 'Link, specs, any evidence' },
        { n: '02', icon: 'search', title: 'Find the applicable rules', text: 'From official regulations' },
        { n: '03', icon: 'check', title: 'Check each requirement', text: 'Against its evidence' },
        { n: '04', icon: 'list', title: 'Explain every finding', text: 'With the exact source' },
        { n: '05', icon: 'folder', title: 'Prepare the application', text: 'Ready for review' },
      ],
      engineNote: 'A new product category means adding its regulations to the knowledge base. The engine stays the same.',
      beforeSubmission: 'MUTABIQ: before submission',
      beforeChips: ['Regulation-based findings', 'Evidence gaps', 'Draft application', 'Organised package'],
      middleSign: 'Applicant reviews<br>&amp; signs',
      officialAuthority: 'The authority: official decision',
      authorityChips: ['Reviews the application', 'Approves or rejects', 'Issues the certificate'],
    },

    usage: {
      eyebrow: 'How it is used',
      title: 'Two inputs, two outputs',
      companyTitle: 'Company profile',
      companyBadge: 'Entered once',
      companyChips: ['Registered name', 'Registration no.', 'Address & contacts', 'Authorised representative', 'Licences'],
      productTitle: 'Product',
      productBadge: 'Per product',
      productChips: ['Product link or name', 'Category', 'Key specifications', 'Any evidence you already have'],
      noDocsNote: 'No documents yet? MUTABIQ still lists exactly which evidence you will need.',
      findingsTitle: 'Compliance findings',
      findingsSub: 'Each requirement: source · applies? · evidence · status · next step',
      packageTitle: 'Application package',
      packageChips: ['Pre-filled official form', 'Evidence checklist', 'Next steps'],
      packageNote: 'Unconfirmed fields are flagged, never guessed. Declarations and signatures stay with the applicant.',
    },

    trust: {
      eyebrow: 'Responsible AI',
      title: 'Trust by design: AI that shows its work',
      sub: 'A missing document is reported as missing evidence, never as proof that the product is non-compliant.',
      safeguards: [
        { icon: 'book', title: 'No source, no finding', text: 'Every result links to an exact article or clause.' },
        { icon: 'list', title: 'Fixed rules for clear checks', text: 'Presence of a document or matching model numbers is checked by code.' },
        { icon: 'question', title: '“Needs verification”, not guesses', text: 'Uncertain items are flagged for a human.' },
        { icon: 'dashed', title: 'Missing ≠ non-compliant', text: 'Absent evidence is reported as a gap, not a violation.' },
        { icon: 'sign', title: 'Human review & signature', text: 'The applicant confirms every field and signs.' },
        { icon: 'bank', title: 'The authority decides', text: 'MUTABIQ never issues approvals or certificates.' },
      ],
    },

    proto: {
      eyebrow: 'This prototype',
      title: 'What works today, and what is illustrated',
      workingTitle: 'Working',
      workingBadge: 'Working',
      workingList: [
        'Seven official texts indexed, including TRC Instructions No. 2/2025, its annexes and the technical standards list, parsed into articles, definitions and amendment notes.',
        'Search in Arabic or English, with article, page and version for every result.',
        'Uncertainty labelled: unverified legal status, recovered text, superseded wording.',
      ],
      openSearch: 'Open evidence search',
      demoTitle: 'Illustrative',
      demoBadge: 'Illustrative',
      demoList: [
        'The DEMO-X1 smartphone walkthrough runs on fictional sample data.',
        'Requirement citations point to the TRC Instructions and annexes and were checked against the official texts; the devices and documents are fictional.',
        'LLM reasoning over retrieved text is planned, not built.',
      ],
      seeSources: 'See the knowledge base',
    },

    closing: {
      tag: 'Team ZAA · AI Quest 2026',
      title: 'Every requirement, <span class="accent-text">backed by evidence.</span>',
      taglineSub: 'كل متطلب، له دليل.',
      lede: 'MUTABIQ prepares the file. The authority makes the decision. Jordanian businesses reach the market with fewer avoidable delays.',
      readiness: [
        ['Applicable rules found', true],
        ['Evidence matched to each requirement', true],
        ['Gaps flagged before submission', true],
        ['Every finding linked to its source', true],
        ['Official form pre-filled', true],
      ],
      readyLabel: 'Ready for applicant review',
      decisionLabel: 'Decision: the authority',
    },

    assessment: {
      badge1: 'Live demo',
      badge2: 'Trial scope: telecom devices · TRC',
      title: 'Technical trial: <span class="accent-text">one case, end to end</span>',
      lede: 'Type approval for a smartphone, from inputs to findings to a draft application. Change the evidence and watch every finding follow.',
      notice: '<strong>Sample data.</strong> The devices, company, documents and values are fictional. Requirement citations point to TRC Instructions No. 2 of 2025, its annexes and the TRC technical standards list, now indexed in the knowledge base and checked against the official PDFs. Not a substitute for legal review.',
      flowTitle: 'Demo flow',
      flowSteps: [
        'Enter the inputs',
        'Run the assessment',
        'Review the findings',
        'Open the regulatory source',
        'Generate the application draft',
      ],
      tabs: ['1 · Inputs', '2 · Findings', '3 · Application'],
      sampleDataBadge: 'Sample data',
      statusHead: 'Statuses',
      statusTitle: 'Evidence status, never a compliance verdict',
      statusSub: 'Every finding uses one of five statuses. None of them means “compliant”: the authority decides that.',

      // 2-Stage Inputs
      stage1Eyebrow: 'Stage 1: Saved Company Profile (Persistent Identity, No Re-entry Required)',
      editCompanyBtn: 'Edit Company Profile',
      saveCompanyBtn: 'Save Company Profile',
      cancelEditBtn: 'Cancel',
      companySavedNote: 'Company identity is saved persistently in your browser; never re-enter it for future forms.',

      stage2Eyebrow: 'Stage 2: Product Specifications & Evidence',
      presetLabel: 'Product Demo Preset / Select Device',
      productLinkLabel: 'Product link or online catalog URL',
      fetchLinkBtn: 'Load sample specs (demo)',
      evidenceLabel: 'Technical documents (Datasheet, DoC, Accredited Test Report)',
      sampleReportLabel: 'Accredited Lab Test Report Status',
      reports: {
        match: 'Accredited test report covering exact model (Fully compliant)',
        mismatch: 'Test report naming different model DEMO-X0 (Conflict)',
        none: 'No test report uploaded yet (Missing evidence)',
      },
      extractedTitle: 'Extracted Technical Specifications',
      eirpPlaceholder: 'In dBm',
      eirpHelpDefault: 'RF Output Power (EIRP) in dBm.',
      eirpHelpValid: 'dBm, verified against technical test report.',
      eirpErrorNumeric: 'Enter a number in dBm, for example 23.',
      eirpErrorRange: 'Expected a value between -10 and 60 dBm.',
      panelFootNote: 'Values come from the sample spec sheets; standards are matched to the TRC technical standards list. Reading specs from a product link is not built yet.',
      runAssessmentBtn: 'Run Technical Assessment',

      // Findings Panel
      summaryChipsAria: 'Findings by status',
      sourceLabel: 'Regulatory Ground',
      appliesLabel: 'Applies?',
      evidenceFieldLabel: 'Submitted Evidence',
      nextStepLabel: 'Required Action',
      ownerLabel: 'Owner',
      editInputsBtn: 'Return to Inputs',
      generateDraftBtn: 'Preview Official Pre-filled Form',

      // Application Panel - Official TRC Form (Annex 1)
      prefilledTitle: 'Annex (1): Official Type Approval & Import Application Form (TRC)',
      sec1Title: '1. Required Action',
      actionNew: 'Obtaining Type Approval: New Approval',
      actionImport: 'Importation of Telecommunications Equipment',
      sec2Title: '2. Applicant Information (بيانات مقدم الطلب)',
      sec3Title: '3. Type Approval Certificate Holder (بيانات حامل الموافقة النوعية)',
      sec4Title: '4. Device Information (بيانات الجهاز)',
      sec5Title: '5. Technical Specifications (المواصفات الفنية)',
      sec6Title: '6. Official Fees Schedule (Annex 2)',
      checklistTitle: 'Regulatory Compliance Checklist',
      nextStepsTitle: 'Next Actions & Procedures',
      applicantRow: 'Applicant',
      companyProfileSource: 'Saved Company Profile',
      decAndSig: 'Declarations & Official Signatures',
      leftForApplicant: 'Left for Applicant review & signature',
      unconfirmed: 'Unconfirmed',
      missingNotFilled: 'Missing: Action Required',
      noOpenSteps: 'All requirements satisfied. Dossier is complete and ready for signature.',
      appChecklist: [
        ['Standards extracted from TRC Instructions No. 2/2025', true],
        ['European harmonized standards (ETSI EN) matched', true],
        ['ILAC-accredited test reports verified', true],
        ['EIRP transmission power within Jordanian bounds', true],
        ['Official Annex 1 form pre-filled with fee calculation', true],
      ],
      appFootNote: 'MUTABIQ prepares the dossier package. The official authority (TRC) makes the final decision.',
      backToFindingsBtn: 'Back to Findings',
      printFormBtn: 'Print draft (PDF)',
    },

    ask: {
      eyebrow: 'Evidence search',
      title: 'Search the regulations',
      lede: 'Find the exact article behind a requirement. Results come from the official texts in the knowledge base, in Arabic or English, with their source. Nothing is generated.',
      questionLabel: 'Your question',
      placeholder: 'e.g. ما هي رسوم اصدار رخصة الاستيراد؟ or: Who issues import licences for farm inputs?',
      submitBtn: 'Search evidence',
      tryLabel: 'Try:',
      optionsSummary: 'Search options',
      instrumentLabel: 'Instrument',
      allDocs: 'All in the knowledge base',
      expandLabel: 'Add definitions and referenced articles',
      historyLabel: 'Include amendment notes (may quote superseded text)',
      statusChecking: 'Checking the search service…',
      statusReady: (docs, chunks, emb, rerank) =>
        `Search service ready: ${docs} instruments, ${chunks} passages (${emb}${rerank ? ' + reranker' : ''}).`,
      statusOffline: 'Search service offline. Start it with: uv run import-compliance-rag serve',
      typeFirst: 'Type a question first, in Arabic or English.',
      searching: 'Searching the knowledge base…',
      noResults: (q) => `No evidence found for <strong dir="auto">${q}</strong>.`,
      provisionsCount: (retrieved, q, extra) =>
        `<strong>${retrieved} provisions</strong> for <strong dir="auto">${q}</strong>${
          extra > 0 ? `, with ${extra} supporting passages` : ''
        }. Read them in full before relying on them.`,
      sharedCaveats: 'Applies to every result',
      caveatsCount: (n) => `${n} caveat${n > 1 ? 's' : ''} for this passage`,
      showFull: 'Show full text',
      showLess: 'Show less',
      officialPdf: 'Official PDF ↗',
      errOfflineTitle: 'The search service is not running.',
      errOfflineDesc: 'This page needs the local service. In the project folder run <code>uv run import-compliance-rag serve</code>, then open <code>http://127.0.0.1:8765/</code>.',
      errFailedTitle: 'That search did not finish.',
    },

    sources: {
      eyebrow: 'Knowledge base',
      title: 'Official texts, clearly bounded',
      lede: 'Every finding must point to a text in here. A new product category means adding its regulations; the engine stays the same. None of these texts has been verified as current yet, so every result says so.',
      loading: 'Loading the source register…',
      liveStatus: (n) => `Live from the database: ${n} instruments, with active versions and passage counts.`,
      offlineStatus: 'Showing the registry file. Start the search service for versions and passage counts.',
      howItWorksEyebrow: 'How it works',
      howItWorksTitle: 'Retrieval grounded in official texts',
      kbTitle: 'Knowledge base',
      kbSub: 'Built once, updated when a regulation changes.',
      kbStep1: 'Official regulations, from the publishing authority',
      kbStep2: 'Parsed into articles, definitions and amendment notes',
      kbStep3: 'Indexed with article IDs and file versions',
      builtBadge: 'Built',
      assessmentTitle: 'Each assessment',
      assessmentSub: 'Runs per product. Today only retrieval is connected to real texts.',
      assessStep1: 'Retrieve the relevant articles',
      assessStep2: 'AI extraction into a product profile',
      assessStep3: 'LLM reasoning over retrieved text only',
      assessStep4: 'Deterministic rule checks and findings',
      demoBadge: 'Demo only',
      plannedBadge: 'Planned',
      notIndexedEyebrow: 'Not indexed yet',
      notIndexedTitle: 'Texts this prototype cannot cite',
      notIndexedSub: 'Search may still return the closest provisions from the indexed instruments; they do not answer questions on these topics.',
      trialBadge: 'Trial scope',
      searchIt: 'Search it',
      issuedBy: 'Issued by',
      gazette: 'Gazette',
      amendments: 'Amendments',
      textExtracted: 'Text',
      versionMeta: 'Version',
    },

    notfound: {
      eyebrow: 'Unknown page',
      title: 'No evidence for this page.',
      lede: (path) => `Nothing lives at <code>${path}</code>. Pick up from the overview or start an assessment.`,
      backHome: 'Back to the overview',
      startAssessment: 'Start an assessment',
    },

    statuses: {
      supported: { label: 'Supported', help: 'The evidence covers the requirement for this exact product.' },
      missing: { label: 'Missing evidence', help: 'A required document or value is absent. A gap, not a violation.' },
      conflict: { label: 'Conflict', help: 'Documents disagree on a value that matters, such as the model.' },
      verify: { label: 'Needs verification', help: 'Uncertain or entered by hand: a person confirms it before use.' },
      not_applicable: { label: 'Not applicable', help: 'The requirement does not apply; the rationale is recorded.' },
    },

    relations: {
      retrieved: 'Retrieved',
      exact_reference: 'Exact reference',
      definition: 'Definition used',
      sibling_part: 'Other part of this article',
      cross_reference: 'Referenced article',
    },

    extractionMethods: {
      text_layer: 'PDF text layer',
      font_recovery: 'Recovered from embedded fonts, verified against OCR',
      ocr: 'OCR',
      mixed: 'Mixed extraction methods',
      plain_text: 'Plain text',
    },

    shortNames: {
      'mit-import-export-law-21-2001': 'Import & Export Law 21/2001',
      'mit-import-export-licenses-system-114-2004': 'Licences & Cards Bylaw 114/2004',
      'moa-agriculture-law-13-2015': 'Agriculture Law 13/2015',
      'ustr-jordan-fta-rules-of-origin': 'US–Jordan FTA, Annex 2.2',
      'trc-type-approval-instructions-2-2025': 'TRC Type Approval Instructions 2/2025',
      'trc-technical-standards-specifications': 'TRC Technical Standards',
      'trc-type-approval-annexes-2-2025': 'TRC Type Approval Annexes',
    },

    footer: {
      brand: 'MUTABIQ · Team ZAA · AI Quest 2026',
      note: 'MUTABIQ prepares the file. The authority makes the decision. Prototype: not legal advice, and the legal status of every source is still unverified.',
    },
  },
};

export function t() {
  return STRINGS[currentLang] || STRINGS.ar;
}
