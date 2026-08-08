/**
 * ZcashMetro Internationalization (i18n)
 *
 * Lightweight translation module supporting 5 languages.
 * Auto-detects from browser settings, with manual override.
 */

const translations = {
  en: {
    // Navbar
    block: 'BLOCK',
    mempool: 'MEMPOOL',

    // Legend
    legendTitle: 'SHIELD TIERS',
    bronze: 'Bronze',
    bronzeDesc: 'shielding · t↔z/o',
    silver: 'Silver',
    silverDesc: 'partial · z↔o',
    gold: 'Gold',
    goldDesc: 'fully shielded',
    noBadge: 'No badge',
    noBadgeDesc: 'transparent · t→t',

    // Help
    helpScroll: 'pan camera',
    helpClick: 'open in explorer',
    helpHover: 'tx details',

    // Inspector
    inspectorTitle: 'SELECTED TRANSACTION',
    txid: 'TXID',
    type: 'TYPE',
    pool: 'POOL',
    seen: 'SEEN',
    explorer: 'EXPLORER',
    copyId: 'COPY ID',
    copied: 'COPIED!',

    // Tooltip
    tooltipTxid: 'Transaction ID',
    tooltipType: 'Type',

    // Tx types
    transparent: 'Transparent',
    shielding: 'Shielding',
    deshielding: 'Deshielding',
    partiallyShielded: 'Partially Shielded',
    fullyShielded: 'Fully Shielded',

    // Pool names
    poolTransparent: 'transparent',
    poolSapling: 'sapling',
    poolOrchard: 'orchard',
    poolIronwood: 'ironwood',

    // Loading
    loading: 'Loading...',
    retrying: 'Retrying...',

    // Time
    secondsAgo: '{n}s ago',
    justNow: 'just now',

    // Elapsed timer
    elapsed: 'ELAPSED',
    elapsedSeconds: '{n} Seconds',
    elapsedMinSec: '{m} Min, {s} Sec',

    // Language name
    langName: 'English',
  },

  pt: {
    block: 'BLOCO',
    mempool: 'MEMPOOL',

    legendTitle: 'NÍVEIS DE PROTEÇÃO',
    bronze: 'Bronze',
    bronzeDesc: 'blindagem · t↔z/o',
    silver: 'Prata',
    silverDesc: 'parcial · z↔o',
    gold: 'Ouro',
    goldDesc: 'totalmente blindado',
    noBadge: 'Sem badge',
    noBadgeDesc: 'transparente · t→t',

    helpScroll: 'mover câmera',
    helpClick: 'abrir no explorer',
    helpHover: 'detalhes da tx',

    inspectorTitle: 'TRANSAÇÃO SELECIONADA',
    txid: 'TXID',
    type: 'TIPO',
    pool: 'POOL',
    seen: 'VISTO',
    explorer: 'EXPLORER',
    copyId: 'COPIAR ID',
    copied: 'COPIADO!',

    tooltipTxid: 'ID da Transação',
    tooltipType: 'Tipo',

    transparent: 'Transparente',
    shielding: 'Blindagem',
    deshielding: 'Desblindagem',
    partiallyShielded: 'Parcialmente Blindado',
    fullyShielded: 'Totalmente Blindado',

    poolTransparent: 'transparente',
    poolSapling: 'sapling',
    poolOrchard: 'orchard',
    poolIronwood: 'ironwood',

    loading: 'Carregando...',
    retrying: 'Tentando novamente...',

    secondsAgo: '{n}s atrás',
    justNow: 'agora',

    elapsed: 'TEMPO',
    elapsedSeconds: '{n} Segundos',
    elapsedMinSec: '{m} Min, {s} Seg',

    langName: 'Português',
  },

  es: {
    block: 'BLOQUE',
    mempool: 'MEMPOOL',

    legendTitle: 'NIVELES DE ESCUDO',
    bronze: 'Bronce',
    bronzeDesc: 'blindaje · t↔z/o',
    silver: 'Plata',
    silverDesc: 'parcial · z↔o',
    gold: 'Oro',
    goldDesc: 'totalmente blindado',
    noBadge: 'Sin badge',
    noBadgeDesc: 'transparente · t→t',

    helpScroll: 'mover cámara',
    helpClick: 'abrir en explorer',
    helpHover: 'detalles de tx',

    inspectorTitle: 'TRANSACCIÓN SELECCIONADA',
    txid: 'TXID',
    type: 'TIPO',
    pool: 'POOL',
    seen: 'VISTO',
    explorer: 'EXPLORER',
    copyId: 'COPIAR ID',
    copied: '¡COPIADO!',

    tooltipTxid: 'ID de Transacción',
    tooltipType: 'Tipo',

    transparent: 'Transparente',
    shielding: 'Blindaje',
    deshielding: 'Desblindaje',
    partiallyShielded: 'Parcialmente Blindado',
    fullyShielded: 'Totalmente Blindado',

    poolTransparent: 'transparente',
    poolSapling: 'sapling',
    poolOrchard: 'orchard',
    poolIronwood: 'ironwood',

    loading: 'Cargando...',
    retrying: 'Reintentando...',

    secondsAgo: 'hace {n}s',
    justNow: 'ahora',

    elapsed: 'TIEMPO',
    elapsedSeconds: '{n} Segundos',
    elapsedMinSec: '{m} Min, {s} Seg',

    langName: 'Español',
  },

  ru: {
    block: 'БЛОК',
    mempool: 'МЕМПУЛ',

    legendTitle: 'УРОВНИ ЗАЩИТЫ',
    bronze: 'Бронза',
    bronzeDesc: 'экранирование · t↔z/o',
    silver: 'Серебро',
    silverDesc: 'частичное · z↔o',
    gold: 'Золото',
    goldDesc: 'полное экранирование',
    noBadge: 'Без значка',
    noBadgeDesc: 'прозрачная · t→t',

    helpScroll: 'перемещение камеры',
    helpClick: 'открыть в обозревателе',
    helpHover: 'детали транзакции',

    inspectorTitle: 'ВЫБРАННАЯ ТРАНЗАКЦИЯ',
    txid: 'TXID',
    type: 'ТИП',
    pool: 'ПУЛ',
    seen: 'ВИДНО',
    explorer: 'ОБОЗРЕВАТЕЛЬ',
    copyId: 'КОПИРОВАТЬ ID',
    copied: 'СКОПИРОВАНО!',

    tooltipTxid: 'ID Транзакции',
    tooltipType: 'Тип',

    transparent: 'Прозрачная',
    shielding: 'Экранирование',
    deshielding: 'Снятие экрана',
    partiallyShielded: 'Частично экранировано',
    fullyShielded: 'Полностью экранировано',

    poolTransparent: 'прозрачный',
    poolSapling: 'sapling',
    poolOrchard: 'orchard',
    poolIronwood: 'ironwood',

    loading: 'Загрузка...',
    retrying: 'Повторная попытка...',

    secondsAgo: '{n}с назад',
    justNow: 'только что',

    elapsed: 'ВРЕМЯ',
    elapsedSeconds: '{n} Секунд',
    elapsedMinSec: '{m} Мин, {s} Сек',

    langName: 'Русский',
  },

  zh: {
    block: '区块',
    mempool: '内存池',

    legendTitle: '隐私等级',
    bronze: '铜牌',
    bronzeDesc: '屏蔽 · t↔z/o',
    silver: '银牌',
    silverDesc: '部分 · z↔o',
    gold: '金牌',
    goldDesc: '完全屏蔽',
    noBadge: '无徽章',
    noBadgeDesc: '透明 · t→t',

    helpScroll: '移动视角',
    helpClick: '在浏览器中打开',
    helpHover: '交易详情',

    inspectorTitle: '已选交易',
    txid: 'TXID',
    type: '类型',
    pool: '池',
    seen: '发现',
    explorer: '浏览器',
    copyId: '复制 ID',
    copied: '已复制！',

    tooltipTxid: '交易 ID',
    tooltipType: '类型',

    transparent: '透明',
    shielding: '屏蔽',
    deshielding: '解除屏蔽',
    partiallyShielded: '部分屏蔽',
    fullyShielded: '完全屏蔽',

    poolTransparent: '透明',
    poolSapling: 'sapling',
    poolOrchard: 'orchard',
    poolIronwood: 'ironwood',

    loading: '加载中...',
    retrying: '重试中...',

    secondsAgo: '{n}秒前',
    justNow: '刚刚',

    elapsed: '已过',
    elapsedSeconds: '{n} 秒',
    elapsedMinSec: '{m} 分 {s} 秒',

    langName: '中文',
  },
};

const SUPPORTED_LANGS = Object.keys(translations);
let currentLang = 'en';

/**
 * Detect the best matching language from browser settings.
 * @returns {string} Language code (en, pt, es, ru, zh)
 */
function detectLanguage() {
  const browserLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  const base = browserLang.split('-')[0];
  if (SUPPORTED_LANGS.includes(base)) return base;
  return 'en';
}

// Initialize with browser language
currentLang = detectLanguage();

/**
 * Get a translated string by key.
 * Supports simple interpolation: `t('secondsAgo', { n: 5 })` → "5s ago"
 * @param {string} key  Translation key
 * @param {object} [params]  Interpolation values
 * @returns {string}
 */
export function t(key, params) {
  const dict = translations[currentLang] || translations.en;
  let str = dict[key] || translations.en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(`{${k}}`, v);
    }
  }
  return str;
}

/**
 * Set the active language.
 * @param {string} lang  Language code
 */
export function setLanguage(lang) {
  if (SUPPORTED_LANGS.includes(lang)) {
    currentLang = lang;
  }
}

/**
 * Get the current language code.
 * @returns {string}
 */
export function getLanguage() {
  return currentLang;
}

/**
 * Get all supported language codes and their display names.
 * @returns {{ code: string, name: string }[]}
 */
export function getSupportedLanguages() {
  return SUPPORTED_LANGS.map((code) => ({
    code,
    name: translations[code].langName,
  }));
}
