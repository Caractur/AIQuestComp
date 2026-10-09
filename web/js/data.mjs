// Static content. Registry entries mirror data/sources/registry.yaml and are used only when the
// local service is not running; live data from /api/sources takes precedence.

export const EXAMPLE_QUERIES = [
  { text: 'ما هي رسوم اصدار رخصة الاستيراد؟', lang: 'ar' },
  { text: 'Is registration required to import pesticides?', lang: 'en' },
  { text: 'هل يجوز التنازل عن رخصة الاستيراد لشخص آخر؟', lang: 'ar' },
  { text: 'Can goods pass through a third country and still get FTA treatment?', lang: 'en' },
];

export const NOT_COVERED = [
  { title: 'Customs Law and the customs tariff', why: 'Duty rates, classification and declarations are not in the corpus yet.' },
  { title: 'JSMO technical regulations', why: 'Standards and conformity requirements for specific product families.' },
  { title: 'JFDA food, drug and cosmetics requirements', why: 'Registration and labelling rules for regulated consumer goods.' },
  { title: 'Other trade agreements', why: 'Only the US–Jordan FTA rules of origin are included.' },
];

export const REGISTRY_FALLBACK = [
  {
    id: 'mit-import-export-law-21-2001',
    title_original: 'قانون الاستيراد والتصدير وتعديلاته رقم 21 لسنة 2001',
    title_en: 'Import and Export Law No. 21 of 2001, as amended',
    issuing_authority: 'Ministry of Industry, Trade and Supply',
    document_type: 'law',
    binding_nature: 'binding',
    legal_status: 'unknown',
    original_language: 'ar',
    gazette_reference: 'Official Gazette No. 4494, p. 2453, 1/7/2001',
    amendment_info: 'Annotates amendments by Amending Law No. 18 of 2003.',
    official_url: 'https://www.mit.gov.jo/ebv4.0/root_storage/ar/eb_list_page/قانون_الاستيراد_و_التصدير_وتعديلاته_رقم_21_لسنة_2001.pdf',
  },
  {
    id: 'mit-import-export-licenses-system-114-2004',
    title_original: 'نظام رخص وبطاقات الاستيراد والتصدير وتعديلاته رقم 114 لسنة 2004',
    title_en: 'Import and Export Licences and Cards Bylaw No. 114 of 2004, as amended',
    issuing_authority: 'Ministry of Industry, Trade and Supply',
    document_type: 'bylaw',
    binding_nature: 'binding',
    legal_status: 'unknown',
    original_language: 'ar',
    gazette_reference: 'Official Gazette No. 4677, p. 4603, 30/9/2004',
    amendment_info: 'Annotates amendments by Amending Bylaw No. 58 of 2005.',
    official_url: 'https://www.mit.gov.jo/ebv4.0/root_storage/ar/eb_list_page/نظام_رخص_وبطاقات_الاستيراد_والتصدير_و_تعيدلاته_رقم_114_لسنة_2004.pdf',
  },
  {
    id: 'moa-agriculture-law-13-2015',
    title_original: 'قانون الزراعة رقم 13 لسنة 2015 وتعديلاته',
    title_en: 'Agriculture Law No. 13 of 2015, as amended',
    issuing_authority: 'Ministry of Agriculture',
    document_type: 'law',
    binding_nature: 'binding',
    legal_status: 'unknown',
    original_language: 'ar',
    gazette_reference: 'Official Gazette No. 5337, p. 1868, 16/4/2015',
    amendment_info: 'Annotates amendments by Amending Laws No. 12 of 2017 and No. 2 of 2020.',
    official_url: 'http://moa.gov.jo/ebv4.0/root_storage/ar/eb_list_page/قانون_الزراعة_رقم_13_لسنة_2015_وتعديلاته.pdf',
  },
  {
    id: 'ustr-jordan-fta-rules-of-origin',
    title_original: 'US–Jordan Free Trade Agreement, Annex 2.2 — Rules of Origin',
    title_en: 'US–Jordan FTA, Annex 2.2 Rules of Origin',
    issuing_authority: 'Office of the United States Trade Representative',
    document_type: 'agreement',
    binding_nature: 'binding',
    legal_status: 'unknown',
    original_language: 'en',
    gazette_reference: null,
    amendment_info: 'Implementing rules and later modifications not verified.',
    official_url: 'https://ustr.gov/sites/default/files/uploads/agreements/fta/jordan/asset_upload_file366_8456.pdf',
  },
];

export const SHORT_NAMES = {
  'mit-import-export-law-21-2001': 'Import & Export Law 21/2001',
  'mit-import-export-licenses-system-114-2004': 'Licences & Cards Bylaw 114/2004',
  'moa-agriculture-law-13-2015': 'Agriculture Law 13/2015',
  'ustr-jordan-fta-rules-of-origin': 'US–Jordan FTA, Annex 2.2',
};

export const EXTRACTION_LABELS = {
  text_layer: 'PDF text layer',
  font_recovery: 'Recovered from embedded fonts, verified against OCR',
  ocr: 'OCR',
  mixed: 'Mixed extraction methods',
  plain_text: 'Plain text',
};
