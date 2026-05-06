/**
 * ZcashMetro HTML Overlay Controller
 *
 * Manages the DOM-based UI overlays: navbar stats, tooltip,
 * inspector dialog, legend, help, and language switcher.
 * Listens to events from the Phaser game via window.zmEvents.
 */

import zmEvents from './events.js';
import { t, setLanguage, getLanguage, getSupportedLanguages } from './i18n.js';

/** Truncate a txid for display: "0xabc…def" */
function truncateTxid(txid) {
  if (!txid || txid.length <= 16) return txid || '';
  return txid.slice(0, 10) + '…' + txid.slice(-6);
}

/** Get pool names from tx type code */
function poolsFromType(txType) {
  const map = {
    t2t: ['transparent', 'transparent'],
    t2z: ['transparent', 'sapling'],
    t2o: ['transparent', 'orchard'],
    z2t: ['sapling', 'transparent'],
    z2z: ['sapling', 'sapling'],
    z2o: ['sapling', 'orchard'],
    o2t: ['orchard', 'transparent'],
    o2z: ['orchard', 'sapling'],
    o2o: ['orchard', 'orchard'],
  };
  const pools = map[txType] || ['unknown', 'unknown'];
  return `${t('pool' + pools[0].charAt(0).toUpperCase() + pools[0].slice(1))} → ${t('pool' + pools[1].charAt(0).toUpperCase() + pools[1].slice(1))}`;
}

/** Color class for tx type in inspector */
function typeColorClass(txType) {
  if (txType === 'z2z' || txType === 'o2o') return 'gold';
  if (txType === 'z2o' || txType === 'o2z') return 'silver';
  if (txType === 't2z' || txType === 't2o' || txType === 'z2t' || txType === 'o2t') return 'bronze';
  return '';
}

/**
 * Initialize all HTML overlay behavior.
 * Call this once after DOMContentLoaded.
 */
export function initUI() {
  const blockEl = document.getElementById('zm-block-value');
  const mempoolEl = document.getElementById('zm-mempool-value');
  const tooltipEl = document.getElementById('zm-tooltip');
  const inspectorEl = document.getElementById('zm-inspector');
  const inspectorCloseBtn = document.getElementById('zm-inspector-close');
  const inspectorTxid = document.getElementById('zm-inspector-txid');
  const inspectorType = document.getElementById('zm-inspector-type');
  const inspectorPool = document.getElementById('zm-inspector-pool');
  const inspectorSeen = document.getElementById('zm-inspector-seen');
  const explorerBtn = document.getElementById('zm-explorer-btn');
  const copyBtn = document.getElementById('zm-copy-btn');
  const langSelect = document.getElementById('zm-lang-select');

  let currentInspectorTxid = null;
  let inspectorOpenTime = null;
  let seenInterval = null;

  // --- Elapsed timer state ---
  const elapsedEl = document.getElementById('zm-elapsed-value');
  let lastBlockTimestamp = null; // Unix epoch (seconds) from server

  // Update elapsed display every second using real block timestamp
  setInterval(() => {
    if (!elapsedEl || !lastBlockTimestamp) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const totalSec = Math.max(0, nowSec - lastBlockTimestamp);
    if (totalSec < 60) {
      elapsedEl.textContent = t('elapsedSeconds', { n: totalSec });
    } else {
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      elapsedEl.textContent = t('elapsedMinSec', { m, s });
    }
  }, 1000);

  // --- Stats updates ---
  zmEvents.on('stats', (data) => {
    if (blockEl && data.height != null) {
      blockEl.textContent = Number(data.height).toLocaleString();
    }
    if (mempoolEl && data.mempool != null) {
      mempoolEl.textContent = data.mempool;
    }
    // Update block timestamp for elapsed timer
    if (data.blockTime) {
      lastBlockTimestamp = data.blockTime;
    }
  });

  // --- Tooltip ---
  zmEvents.on('npcHover', (data) => {
    if (!tooltipEl) return;
    tooltipEl.innerHTML =
      `<span class="tooltip-label">${t('tooltipTxid')}:</span>\n` +
      `<span class="tooltip-txid">${truncateTxid(data.txid)}</span>\n` +
      `<span class="tooltip-label">${t('tooltipType')}:</span> ${data.typeText}`;
    tooltipEl.style.left = data.screenX + 'px';
    tooltipEl.style.top = (data.screenY - 10) + 'px';
    tooltipEl.classList.add('visible');
  });

  zmEvents.on('npcHoverEnd', () => {
    if (!tooltipEl) return;
    tooltipEl.classList.remove('visible');
  });

  // --- Inspector ---
  zmEvents.on('npcClick', (data) => {
    if (!inspectorEl) return;
    currentInspectorTxid = data.txid;
    inspectorOpenTime = Date.now();

    if (inspectorTxid) inspectorTxid.textContent = data.txid;
    if (inspectorType) {
      const colorClass = typeColorClass(data.txType);
      inspectorType.className = colorClass;
      inspectorType.textContent = `${data.txType} — ${data.typeText}`;
    }
    if (inspectorPool) inspectorPool.textContent = poolsFromType(data.txType);
    if (inspectorSeen) inspectorSeen.textContent = t('justNow');

    // Update "seen" timer
    if (seenInterval) clearInterval(seenInterval);
    seenInterval = setInterval(() => {
      if (inspectorSeen && inspectorOpenTime) {
        const seconds = Math.floor((Date.now() - inspectorOpenTime) / 1000);
        inspectorSeen.textContent = seconds > 0 ? t('secondsAgo', { n: seconds }) : t('justNow');
      }
    }, 1000);

    inspectorEl.classList.add('visible');

    // Reset copy button text
    if (copyBtn) copyBtn.textContent = t('copyId');
  });

  // Close inspector
  if (inspectorCloseBtn) {
    inspectorCloseBtn.addEventListener('click', () => {
      inspectorEl.classList.remove('visible');
      if (seenInterval) clearInterval(seenInterval);
    });
  }

  // Explorer button
  if (explorerBtn) {
    explorerBtn.addEventListener('click', () => {
      if (currentInspectorTxid) {
        window.open(
          `https://mainnet.zcashexplorer.app/transactions/${currentInspectorTxid}`,
          '_blank'
        );
      }
    });
  }

  // Copy ID button
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (currentInspectorTxid) {
        try {
          await navigator.clipboard.writeText(currentInspectorTxid);
          copyBtn.textContent = t('copied');
          setTimeout(() => {
            copyBtn.textContent = t('copyId');
          }, 2000);
        } catch {
          // Fallback
          const textarea = document.createElement('textarea');
          textarea.value = currentInspectorTxid;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          copyBtn.textContent = t('copied');
          setTimeout(() => {
            copyBtn.textContent = t('copyId');
          }, 2000);
        }
      }
    });
  }

  // --- Make inspector draggable ---
  const inspectorHead = inspectorEl?.querySelector('.inspector-head');
  if (inspectorHead && inspectorEl) {
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    inspectorHead.addEventListener('mousedown', (e) => {
      isDragging = true;
      const rect = inspectorEl.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      inspectorHead.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const x = e.clientX - dragOffsetX;
      const y = e.clientY - dragOffsetY;
      inspectorEl.style.left = x + 'px';
      inspectorEl.style.top = y + 'px';
      inspectorEl.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      if (inspectorHead) inspectorHead.style.cursor = 'grab';
    });
  }

  // --- Language switcher ---
  if (langSelect) {
    // Populate options
    const langs = getSupportedLanguages();
    langSelect.innerHTML = '';
    for (const lang of langs) {
      const opt = document.createElement('option');
      opt.value = lang.code;
      opt.textContent = lang.name;
      if (lang.code === getLanguage()) opt.selected = true;
      langSelect.appendChild(opt);
    }

    langSelect.addEventListener('change', () => {
      setLanguage(langSelect.value);
      applyTranslations();
    });
  }

  // --- Skin switcher ---
  const skinSelect = document.getElementById('zm-skin-select');
  if (skinSelect) {
    skinSelect.addEventListener('change', () => {
      zmEvents.emit('changeSkin', skinSelect.value);
    });
  }

  // Initial translation application
  applyTranslations();
}

/**
 * Apply current language translations to all static DOM text.
 */
function applyTranslations() {
  // Navbar labels
  setTextById('zm-block-label', t('block'));
  setTextById('zm-mempool-label', t('mempool'));
  setTextById('zm-elapsed-label', t('elapsed'));

  // Legend
  setTextById('zm-legend-title', t('legendTitle'));
  setTextById('zm-legend-bronze', t('bronze'));
  setTextById('zm-legend-bronze-desc', t('bronzeDesc'));
  setTextById('zm-legend-silver', t('silver'));
  setTextById('zm-legend-silver-desc', t('silverDesc'));
  setTextById('zm-legend-gold', t('gold'));
  setTextById('zm-legend-gold-desc', t('goldDesc'));
  setTextById('zm-legend-nobadge', t('noBadge'));
  setTextById('zm-legend-nobadge-desc', t('noBadgeDesc'));

  // Help
  setTextById('zm-help-scroll', t('helpScroll'));
  setTextById('zm-help-click', t('helpClick'));
  setTextById('zm-help-hover', t('helpHover'));

  // Inspector
  setTextById('zm-inspector-title', t('inspectorTitle'));
  setTextById('zm-inspector-txid-label', t('txid'));
  setTextById('zm-inspector-type-label', t('type'));
  setTextById('zm-inspector-pool-label', t('pool'));
  setTextById('zm-inspector-seen-label', t('seen'));
  setTextById('zm-explorer-btn', t('explorer'));
  setTextById('zm-copy-btn', t('copyId'));
}

function setTextById(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
