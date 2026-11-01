/**
 * LÓGICA DEL SIMULADOR MULTIACTIVO Y CONTROL DE ACCESO
 */

let activeStudio = null;
let currentCurrency = 'ARS'; // 'ARS' o 'USD'
let selectedInstrument = 'caucion'; // 'caucion', 'lecap', 'plazofijo', 'usd', 'cheques', 'macroLetra'
let currentCapital = 5000000;
let currentPlazo = 7;
let liquidityPlazo = 7;
let chequePlazoDays = 90;
let macroLetraPlazoDays = 38;
let lecapPlazoDays = null;
let macroPlazoFollowsVto = true;
let macroTnaDirty = false;
let letraTnaDirty = false;
let manualLecapTicker = null;
let lecapMode = 'letra';
let selectedLecapTicker = null;
let lecapQuoteMeta = null;
let liveMacroBands = null;
let liveMacroBandsAt = null;
let activeTNA = 21.5;

// Inicialización al cargar la página
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  setupPinBoxes();
  macroLetraPlazoDays = letraDaysFromConfig();
  lecapPlazoDays = macroLetraPlazoDays;
  setupEventListeners();
  seedChequeMarketFallbacks();
  initChequeControls();
  initMacroLetraControls();
  initTaxToggles();
  renderQuickCapitalButtons();
  updateInstrumentRates();
  checkUrlParams();

  // Sincronización de tasas de mercado (con renovación cada 30 min)
  fetchLiveRates();
  startRatesAutoRefresh();
});

/* ==========================================================
   0. ACCESO: EL PIN SE VALIDA EN /api/pin, NO EN EL NAVEGADOR
========================================================== */

/* ==========================================================
   0. SINCRONIZACIÓN DE TASAS EN TIEMPO REAL (CADA 30 MIN)
========================================================== */

let ratesRefreshTimer = null;

function startRatesAutoRefresh() {
  if (ratesRefreshTimer) clearInterval(ratesRefreshTimer);
  const intervalMs = (ZETA_CONFIG.ratesConfig?.refreshIntervalMinutes || 30) * 60 * 1000;
  ratesRefreshTimer = setInterval(() => {
    console.log("[Zeta Finance] Actualizando tasas de mercado (ciclo de 30 minutos)...");
    fetchLiveRates(false);
  }, intervalMs);
}

async function fetchLiveRates(force = false) {
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.classList.add('animate-spin');

  const cacheKey = 'zeta_market_rates_cache_v5';
  const ttlMs = (ZETA_CONFIG.ratesConfig?.refreshIntervalMinutes || 30) * 60 * 1000;

  // 1. Revisar si hay datos en caché válidos por menos de 30 minutos
  if (!force) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        const age = Date.now() - parsed.timestamp;
        // Si el caché tiene tasas viejas o tickers vencidos (ej. S28F5 de 2025), descartarlo
        if (!parsed.meta || !parsed.meta.lecapSource || parsed.rates?.lecapDetails?.ticker === 'S28F5') {
          localStorage.removeItem(cacheKey);
        } else if (age < ttlMs && parsed.rates) {
          applyFetchedRates(parsed.rates, new Date(parsed.timestamp), 'cache', parsed.meta);
          if (icon) icon.classList.remove('animate-spin');
          return;
        }
      }
    } catch (e) {
      console.warn('[Zeta Finance] Error leyendo caché local:', e);
    }
  }

  // 2. Intentar consultar endpoint serverless /api/rates
  let success = false;
  try {
    const res = await fetch(ZETA_CONFIG.ratesConfig?.apiEndpoint || '/api/rates', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (res.ok) {
      const json = await res.json();
      if (json.rates) {
        const meta = lecapMetaFromPayload(json);
        applyFetchedRates(json.rates, json.timestamp ? new Date(json.timestamp) : new Date(), 'api', meta);
        saveRatesToCache(json.rates, meta);
        success = true;
      }
    }
  } catch (err) {
    // Si corre localmente por file:/// o sin server, intentar ArgentinaDatos directo
    console.info('[Zeta Finance] Intentando conexión directa a ArgentinaDatos...');
    success = await fetchDirectArgentinaDatos();
  }

  if (!success) {
    // Si no hubo conexión, siguen las tasas base de config.js.
    updateRatesStatusUI(new Date(), 'fallback', {
      lecapSource: 'config',
      lecapSourceLabel: 'config',
      marketOpen: false
    });
  }

  if (icon) {
    setTimeout(() => icon.classList.remove('animate-spin'), 600);
  }
}

async function fetchDirectArgentinaDatos() {
  try {
    let updated = false;
    const fallbackCurve = { ...(ZETA_CONFIG.marketRates.caucionByDays || {}) };
    let directCaucionQuotes = null;

    // Caución: BYMA primero. ArgentinaDatos suele devolver [] aunque el mercado esté abierto.
    let caucionCurve = null;
    try {
      const bymaRes = await fetch(ZETA_CONFIG.ratesConfig?.bymaCaucionesUrl || 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/cauciones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://open.bymadata.com.ar',
          'Referer': 'https://open.bymadata.com.ar/'
        },
        body: '{}',
        signal: AbortSignal.timeout(5000)
      });
      if (bymaRes.ok && typeof quotesFromBymaRows === 'function' && typeof bucketCaucionQuotes === 'function') {
        const bymaRows = await bymaRes.json();
        const quotes = quotesFromBymaRows(bymaRows);
        if (quotes.length) directCaucionQuotes = quotes;
        const curve = bucketCaucionQuotes(quotes, fallbackCurve);
        if (curve.filledBuckets > 0) caucionCurve = curve.caucionByDays;
      }
    } catch (bymaError) {
      console.info('[Zeta Finance] BYMA directo no disponible:', bymaError.message);
    }

    if (!caucionCurve) {
      const cRes = await fetch(ZETA_CONFIG.ratesConfig?.directCaucionesUrl || 'https://api.argentinadatos.com/v1/finanzas/cauciones/ars', {
        signal: AbortSignal.timeout(3500)
      });
      if (cRes.ok && typeof quotesFromArgentinaDatosRows === 'function' && typeof bucketCaucionQuotes === 'function') {
        const data = await cRes.json();
        const curve = bucketCaucionQuotes(quotesFromArgentinaDatosRows(data), fallbackCurve);
        if (curve.filledBuckets > 0) caucionCurve = curve.caucionByDays;
      }
    }

    if (caucionCurve) {
      ZETA_CONFIG.marketRates.caucionByDays = caucionCurve;
      updated = true;
    }

    // Plazo Fijo
    const pRes = await fetch(ZETA_CONFIG.ratesConfig?.directPlazoFijoUrl || 'https://api.argentinadatos.com/v1/finanzas/tasas/depositos30Dias', {
      signal: AbortSignal.timeout(3500)
    });
    if (pRes.ok) {
      const pData = await pRes.json();
      if (Array.isArray(pData) && pData.length > 0) {
        const last = pData[pData.length - 1];
        const val = parseFloat(last.valor || last.tna);
        if (!isNaN(val) && val > 15) {
          ZETA_CONFIG.marketRates.plazoFijoTNA = parseFloat(val.toFixed(1));
          ZETA_CONFIG.marketRates.plazoFijoDetails = { fuente: 'bcra', fecha: last.fecha || null };
          updated = true;
        }
      }
    }

    let macroBands = null;
    try {
      const mRes = await fetch(ZETA_CONFIG.ratesConfig?.directMacroPlazoFijoUrl || 'https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo', {
        signal: AbortSignal.timeout(3500)
      });
      if (mRes.ok && typeof macroBandsFromArgentinaDatos === 'function') {
        macroBands = macroBandsFromArgentinaDatos(await mRes.json());
        if (macroBands) updated = true;
      }
    } catch (macroError) {
      console.info('[Zeta Finance] Sin tramos de Macro en vivo:', macroError.message);
    }

    try {
      const fRes = await fetch(ZETA_CONFIG.ratesConfig?.directFciHistoricoUrl || 'https://api.argentinadatos.com/v1/finanzas/fci/fondos/balanz-capital-money-market-clase-a/historico', {
        signal: AbortSignal.timeout(8000)
      });
      if (fRes.ok && typeof tnaFromCuotapartes === 'function') {
        const body = await fRes.json();
        const quote = tnaFromCuotapartes(body && body.historico, 7);
        if (quote) {
          ZETA_CONFIG.marketRates.fciTNA = quote.tna;
          ZETA_CONFIG.marketRates.fciDetails = {
            ...(ZETA_CONFIG.marketRates.fciDetails || {}),
            ...quote,
            fuente: 'cnv',
            plazoRescateDias: 0
          };
          updated = true;
        }
      }
    } catch (fciError) {
      console.info('[Zeta Finance] FCI directo no disponible:', fciError.message);
    }

    try {
      const bRes = await fetch(ZETA_CONFIG.ratesConfig?.directBcraMonetariasUrl || 'https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?limit=3000', {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000)
      });
      if (bRes.ok && typeof parseBcraMonetarias === 'function' && typeof bcraPanelFromSources === 'function') {
        const panel = bcraPanelFromSources(parseBcraMonetarias(await bRes.json()));
        if (panel && panel.series && panel.series.some((row) => row.fuente === 'bcra')) {
          ZETA_CONFIG.marketRates.bcra = panel;
          updated = true;
        }
      }
    } catch (bcraError) {
      console.info('[Zeta Finance] BCRA directo no disponible:', bcraError.message);
    }

    const lecapPayload = await fetchDirectLecapCurve();
    if (lecapPayload) {
      if (lecapPayload.rates.lecapTNA) {
        ZETA_CONFIG.marketRates.lecapTNA = lecapPayload.rates.lecapTNA;
        ZETA_CONFIG.marketRates.lecapDetails = lecapPayload.rates.lecapDetails;
        ZETA_CONFIG.marketRates.lecaps = lecapPayload.rates.lecaps;
      }
      if (lecapPayload.rates.chequeLecaps) {
        ZETA_CONFIG.marketRates.chequeLecaps = lecapPayload.rates.chequeLecaps;
      }
      updated = true;
    }

    if (updated) {
      const payload = { ...ZETA_CONFIG.marketRates };
      if (macroBands) payload.macroPlazoFijoBands = macroBands;
      if (directCaucionQuotes) payload.caucionQuotes = directCaucionQuotes;
      if (lecapPayload) {
        if (lecapPayload.rates.lecapTNA) payload.lecapTNA = lecapPayload.rates.lecapTNA;
        if (lecapPayload.rates.lecapDetails) payload.lecapDetails = lecapPayload.rates.lecapDetails;
        if (lecapPayload.rates.lecaps) payload.lecaps = lecapPayload.rates.lecaps;
        if (lecapPayload.rates.chequeLecaps) payload.chequeLecaps = lecapPayload.rates.chequeLecaps;
      }
      const meta = lecapPayload ? lecapPayload.meta : { lecapSource: 'config', lecapSourceLabel: 'config', marketOpen: false };
      applyFetchedRates(payload, new Date(), 'direct', meta);
      saveRatesToCache(payload, meta);
      return true;
    }
  } catch (e) {
    console.warn('[Zeta Finance] Mercado offline o CORS local:', e.message);
  }
  return false;
}

function lecapMetaFromPayload(json) {
  const lecap = (json && json.lecap) || {};
  const source = lecap.source || (json && json.rates && json.rates.lecapDetails && json.rates.lecapDetails.fuente) || 'config';
  return {
    lecapSource: source,
    lecapSourceLabel: lecap.sourceLabel || (source === 'data912' ? 'Data912' : source === 'byma' ? 'BYMA' : 'config'),
    marketOpen: !!lecap.marketOpen,
    sourcesChecked: (json && json.sourcesChecked) || []
  };
}

async function fetchDirectLecapCurve() {
  if (typeof buildLecapCurve !== 'function' || typeof lecapDetailsFromReference !== 'function') return null;
  try {
    const headers = { 'Accept': 'application/json' };
    const notesPromise = fetch(ZETA_CONFIG.ratesConfig?.directLecapUrl || 'https://data912.com/live/arg_notes', {
      headers,
      signal: AbortSignal.timeout(4000)
    });
    const bymaPromise = fetch(ZETA_CONFIG.ratesConfig?.bymaLecapUrl || 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/lebacs', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 700 }),
      signal: AbortSignal.timeout(5000)
    }).catch(() => null);

    const bondsPromise = fetch(ZETA_CONFIG.ratesConfig?.directLecapBondsUrl || 'https://data912.com/live/arg_bonds', {
      headers,
      signal: AbortSignal.timeout(4000)
    }).catch(() => null);
    const notesRes = await notesPromise;
    const bymaRes = await bymaPromise;
    const bondsRes = await bondsPromise;
    const noteRows = notesRes && notesRes.ok ? await notesRes.json() : [];
    const bondRows = bondsRes && bondsRes.ok ? await bondsRes.json() : [];
    const data912Rows = []
      .concat(Array.isArray(noteRows) ? noteRows : [])
      .concat(Array.isArray(bondRows) ? bondRows : []);
    let bymaRows = [];
    if (bymaRes && bymaRes.ok) {
      const body = await bymaRes.json();
      bymaRows = Array.isArray(body) ? body : (body && body.data) || [];
    }
    const rows = Array.isArray(data912Rows) ? data912Rows : [];
    const curve = buildLecapCurve({
      now: new Date(),
      data912Rows: rows,
      bymaRows,
      fichas: {}
    });
    let chequeLecaps = null;
    if (typeof buildChequeLecapQuotes === 'function') {
      const settlement = typeof quoteCalendar === 'function' ? quoteCalendar(new Date()).settlement : null;
      chequeLecaps = buildChequeLecapQuotes({ data912Rows: rows, settlement });
    }
    if (!curve && !chequeLecaps) return null;
    return {
      rates: {
        ...(curve ? {
          lecapTNA: curve.reference.tna,
          lecapDetails: lecapDetailsFromReference(curve.reference),
          lecaps: curve.letters
        } : {}),
        ...(chequeLecaps ? { chequeLecaps } : {})
      },
      meta: curve ? {
        lecapSource: curve.source,
        lecapSourceLabel: curve.sourceLabel,
        marketOpen: curve.marketOpen
      } : {
        lecapSource: 'config',
        lecapSourceLabel: 'config',
        marketOpen: false
      }
    };
  } catch (error) {
    console.info('[Zeta Finance] LECAP directa no disponible:', error.message);
    return null;
  }
}

function applyFetchedRates(newRates, timestamp, origin, meta) {
  if (newRates.caucionByDays) {
    ZETA_CONFIG.marketRates.caucionByDays = { ...ZETA_CONFIG.marketRates.caucionByDays, ...newRates.caucionByDays };
  }
  if (newRates.plazoFijoTNA) ZETA_CONFIG.marketRates.plazoFijoTNA = newRates.plazoFijoTNA;
  ZETA_CONFIG.marketRates.plazoFijoDetails = newRates.plazoFijoDetails || { fuente: 'referencia' };
  if (newRates.lecapTNA) ZETA_CONFIG.marketRates.lecapTNA = newRates.lecapTNA;
  if (newRates.lecapDetails && newRates.lecapDetails.ticker && newRates.lecapDetails.diasAlVencimiento) {
    ZETA_CONFIG.marketRates.lecapDetails = { ...newRates.lecapDetails };
  } else if (newRates.lecapDetails) {
    ZETA_CONFIG.marketRates.lecapDetails = {
      ...(ZETA_CONFIG.marketRates.lecapDetails || {}),
      ...newRates.lecapDetails
    };
  }
  if (Array.isArray(newRates.lecaps)) {
    ZETA_CONFIG.marketRates.lecaps = newRates.lecaps;
  }
  if (newRates.fciTNA) ZETA_CONFIG.marketRates.fciTNA = newRates.fciTNA;
  if (newRates.fciDetails && newRates.fciDetails.tna) {
    ZETA_CONFIG.marketRates.fciDetails = {
      ...(ZETA_CONFIG.marketRates.fciDetails || {}),
      ...newRates.fciDetails
    };
  }
  if (lecapMode === 'letra') {
    const horizon = currentLecapPick();
    if (horizon.letter) {
      selectedLecapTicker = horizon.letter.ticker;
      macroLetraPlazoDays = horizon.plazo;
      if (isMacroLetraMode() || selectedInstrument === 'lecap') currentPlazo = horizon.plazo;
    }
  } else {
    const letterDays = letraDaysFromConfig();
    if (macroPlazoFollowsVto && isFinite(letterDays) && letterDays >= 1) {
      macroLetraPlazoDays = Math.round(letterDays);
      if (isMacroLetraMode()) currentPlazo = macroLetraPlazoDays;
    }
  }
  if (Array.isArray(newRates.macroPlazoFijoBands) && newRates.macroPlazoFijoBands.length) {
    liveMacroBands = newRates.macroPlazoFijoBands;
    liveMacroBandsAt = timestamp || new Date();
  }
  if (newRates.usdRateAnnual) ZETA_CONFIG.marketRates.usdRateAnnual = newRates.usdRateAnnual;
  if (newRates.bcra && Array.isArray(newRates.bcra.series) && newRates.bcra.series.length) {
    ZETA_CONFIG.marketRates.bcra = newRates.bcra;
  }
  if (newRates.chequeLecaps && Array.isArray(newRates.chequeLecaps.letters)) {
    ZETA_CONFIG.marketRates.chequeLecaps = newRates.chequeLecaps;
  }
  if (Array.isArray(newRates.caucionQuotes) && newRates.caucionQuotes.length) {
    ZETA_CONFIG.marketRates.caucionQuotes = newRates.caucionQuotes;
  }

  updateInstrumentRates();
  if (currentCurrency === 'ARS') {
    selectInstrument(selectedInstrument);
  } else {
    calculateYield();
  }

  if (meta) lecapQuoteMeta = meta;
  updateRatesStatusUI(timestamp, origin, meta || lecapQuoteMeta);
}

function saveRatesToCache(rates, meta) {
  try {
    localStorage.setItem('zeta_market_rates_cache_v5', JSON.stringify({
      timestamp: Date.now(),
      rates,
      meta: meta || lecapQuoteMeta
    }));
  } catch (e) {}
}

function updateRatesStatusUI(date, origin, meta) {
  try { document.dispatchEvent(new CustomEvent('zeta:rates', { detail: { date: date, origin: origin, meta: meta } })); } catch (e) {}
  const dot = document.getElementById('rate-status-dot');
  const text = document.getElementById('rate-status-text');
  const lastUpdate = document.getElementById('rate-last-update');
  if (!dot || !text || !lastUpdate) return;

  const timeStr = date.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires'
  });
  const source = meta && meta.lecapSource;
  const label = (meta && meta.lecapSourceLabel) || 'config';
  const live = (source === 'data912' || source === 'byma') && origin !== 'fallback';

  if (live) {
    dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse";
    text.textContent = meta && meta.marketOpen ? "LECAP en vivo" : "LECAP último cierre";
    text.className = "font-medium text-emerald-300";
    lastUpdate.textContent = `${label} · ${timeStr} hs`;
  } else {
    dot.className = "w-2.5 h-2.5 rounded-full bg-amber-400";
    text.textContent = "LECAP de referencia";
    text.className = "font-medium text-amber-300";
    lastUpdate.textContent = `config · ${timeStr} hs`;
  }
}

function forceRefreshRates() {
  fetchLiveRates(true);
  showToast("Actualizando cotizaciones y tasas...");
}

/* ==========================================================
   1. CONTROL DE ACCESO (PIN & URL)
========================================================== */

function setupPinBoxes() {
  const boxes = document.querySelectorAll('.pin-box');
  
  boxes.forEach((box, index) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value;
      if (!/^\d*$/.test(val)) {
        box.value = '';
        return;
      }
      if (val.length === 1 && index < boxes.length - 1) {
        boxes[index + 1].focus();
      }
      const fullPin = getEnteredPin();
      if (fullPin.length === 4) {
        validatePin(fullPin);
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && index > 0) {
        boxes[index - 1].focus();
      }
      if (e.key === 'Enter') {
        validatePin(getEnteredPin());
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = e.clipboardData.getData('text').trim();
      if (/^\d{4}$/.test(pasteData)) {
        fillPin(pasteData);
        validatePin(pasteData);
      }
    });
  });

  const btnUnlock = document.getElementById('btn-unlock');
  if (btnUnlock) {
    btnUnlock.addEventListener('click', () => {
      validatePin(getEnteredPin());
    });
  }
}

function getEnteredPin() {
  const boxes = document.querySelectorAll('.pin-box');
  return Array.from(boxes).map(b => b.value).join('');
}

function fillPin(pin) {
  const boxes = document.querySelectorAll('.pin-box');
  const digits = pin.toString().split('');
  boxes.forEach((box, i) => {
    box.value = digits[i] || '';
  });
  if (boxes[3]) boxes[3].focus();
}

async function validatePin(pin) {
  const errorEl = document.getElementById('pin-error');
  const code = String(pin || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(code)) {
    showPinError(errorEl);
    return;
  }
  try {
    const res = await fetch('/api/pin?pin=' + encodeURIComponent(code), {
      signal: AbortSignal.timeout(8000)
    });
    const json = await res.json();
    if (json && json.ok && json.studio && json.studio.name) {
      errorEl.classList.add('hidden');
      unlockSimulator(json.studio, code);
      return;
    }
  } catch (error) {
    console.info('[Zeta Finance] No se pudo validar el acceso.');
  }
  showPinError(errorEl);
}

function showPinError(errorEl) {
  if (!errorEl) return;
  errorEl.classList.remove('hidden');
  const pinBoxes = document.getElementById('pin-boxes');
  if (pinBoxes) {
    pinBoxes.classList.add('animate-bounce');
    setTimeout(() => pinBoxes.classList.remove('animate-bounce'), 500);
  }
}

async function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const pinParam = urlParams.get('pin');
  const estudioParam = urlParams.get('estudio');

  if (pinParam) {
    await validatePin(pinParam);
    return;
  }

  if (!estudioParam) return;
  try {
    const res = await fetch('/api/pin?estudio=' + encodeURIComponent(estudioParam), {
      signal: AbortSignal.timeout(8000)
    });
    const json = await res.json();
    if (json && json.ok && json.studio && json.studio.name) {
      unlockSimulator(json.studio, '');
    }
  } catch (error) {
    console.info('[Zeta Finance] No se pudo abrir el estudio de la URL.');
  }
}

function unlockSimulator(studio, pin) {
  activeStudio = { ...studio, pin };
  applyStudioBranding(activeStudio);

  document.getElementById('gatekeeper-screen').classList.add('hidden');
  document.getElementById('simulator-screen').classList.remove('hidden');

  calculateYield();
  if (window.zetaWelcomeRender) window.zetaWelcomeRender();

  if (window.lucide) {
    lucide.createIcons();
  }

  showToast(`Terminal desbloqueada: ${studio.name}`);
}

function lockScreen() {
  activeStudio = null;
  const boxes = document.querySelectorAll('.pin-box');
  boxes.forEach(b => b.value = '');
  document.getElementById('pin-error').classList.add('hidden');
  document.getElementById('simulator-screen').classList.add('hidden');
  document.getElementById('gatekeeper-screen').classList.remove('hidden');
  if (boxes[0]) boxes[0].focus();
}

function applyStudioBranding(studio) {
  document.getElementById('studio-title').textContent = studio.name;
  document.getElementById('studio-subtitle').textContent = `${studio.subtitle} • ${studio.city}`;
  document.getElementById('footer-studio-name').textContent = studio.name;
  document.getElementById('modal-studio-tag').textContent = `Derivado por: ${studio.name}`;

  const initials = studio.name
    .split(' ')
    .filter(word => word.length > 2 && !['del', 'los', 'las', 'por', 'con'].includes(word.toLowerCase()))
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
  
  const avatarEl = document.getElementById('studio-avatar');
  avatarEl.textContent = initials || 'EP';
  avatarEl.style.backgroundColor = studio.primaryColor || '#1e3a8a';

  const partnerTag = document.getElementById('zeta-partner-tag');
  const footerSignature = document.getElementById('footer-zeta-signature');
  
  if (studio.hideZetaBranding) {
    partnerTag.classList.add('!hidden');
    footerSignature.classList.add('!hidden');
  } else {
    partnerTag.classList.remove('!hidden');
    footerSignature.classList.remove('!hidden');
  }
}

/* ==========================================================
   2. GESTIÓN DE MONEDA (ARS / USD) E INSTRUMENTOS
========================================================== */

function setCurrency(currency) {
  if (selectedInstrument === 'cheques' || selectedInstrument === 'macroLetra') {
    rememberPlazo(selectedInstrument);
    currentPlazo = liquidityPlazo;
  }
  currentCurrency = currency;
  const btnArs = document.getElementById('btn-currency-ars');
  const btnUsd = document.getElementById('btn-currency-usd');
  const arsInstruments = document.getElementById('ars-instruments');
  const usdInstruments = document.getElementById('usd-instruments');
  const currencyBadge = document.getElementById('currency-badge-label');
  const symbolDisplay = document.getElementById('currency-symbol-display');
  const hintLabel = document.getElementById('label-capital-hint');

  if (currency === 'USD') {
    btnUsd.className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-emerald-600 text-white shadow-md";
    btnArs.className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-400 hover:text-white hover:bg-slate-800";
    
    arsInstruments.classList.add('hidden');
    usdInstruments.classList.remove('hidden');
    
    currencyBadge.textContent = "USD (US$)";
    currencyBadge.className = "text-xs px-2.5 py-1 rounded-lg bg-emerald-950 text-emerald-300 font-mono";
    symbolDisplay.textContent = "US$";
    hintLabel.textContent = "Tasa corporativa fija: 5% anual en dólares";

    currentCapital = 25000;
    activeTNA = ZETA_CONFIG.marketRates.usdRateAnnual || 5.0;
    selectedInstrument = 'usd';

  } else {
    btnArs.className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-blue-600 text-white shadow-md";
    btnUsd.className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-400 hover:text-white hover:bg-slate-800";
    
    arsInstruments.classList.remove('hidden');
    usdInstruments.classList.add('hidden');

    currencyBadge.textContent = "ARS ($)";
    currencyBadge.className = "text-xs px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-mono";
    symbolDisplay.textContent = "$";
    hintLabel.textContent = "Mínimo sugerido: $500.000 ARS";

    currentCapital = 5000000;
    selectedInstrument = 'caucion';
    updateCaucionRateForDays(currentPlazo);
  }

  document.getElementById('input-capital').value = formatNumber(currentCapital);
  document.getElementById('input-active-tna').value = activeTNA;

  renderQuickCapitalButtons();
  updateInstrumentVisuals();
  syncChequeMode();
  setPlazo(currentPlazo);
}

function renderQuickCapitalButtons() {
  const container = document.getElementById('quick-capital-container');
  container.innerHTML = '';

  const chequeMode = currentCurrency === 'ARS' && selectedInstrument === 'cheques';
  const options = currentCurrency === 'USD'
    ? [5000, 10000, 25000, 50000, 100000]
    : chequeMode
      ? [10000000, 25000000, 50000000, 100000000, 150000000]
      : [1000000, 5000000, 10000000, 25000000, 50000000];

  options.forEach(amount => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition';
    const label = currentCurrency === 'USD'
      ? `+US$${amount >= 1000 ? (amount/1000) + 'K' : amount}`
      : chequeMode
        ? `$${amount >= 1000000 ? (amount/1000000) + 'M' : amount}`
        : `+$${amount >= 1000000 ? (amount/1000000) + 'M' : amount}`;
    btn.textContent = label;
    btn.onclick = () => setCapital(amount);
    container.appendChild(btn);
  });
}

function rememberPlazo(inst) {
  if (inst === 'cheques') chequePlazoDays = currentPlazo;
  else if (inst === 'macroLetra') macroLetraPlazoDays = currentPlazo;
  else if (inst === 'lecap') lecapPlazoDays = currentPlazo;
  else if (currentCurrency === 'ARS') liquidityPlazo = currentPlazo;
}

function plazoForInstrument(inst) {
  if (inst === 'cheques') return chequePlazoDays;
  if (inst === 'macroLetra') return macroLetraPlazoDays;
  if (inst === 'lecap') return lecapPlazoDays || letraDaysFromConfig();
  return liquidityPlazo;
}

function selectInstrument(inst) {
  if (currentCurrency === 'USD') return;
  if (inst !== selectedInstrument) {
    rememberPlazo(selectedInstrument);
    selectedInstrument = inst;
    currentPlazo = plazoForInstrument(inst);
  }

  if (inst === 'caucion') {
    updateCaucionRateForDays(currentPlazo);
  } else if (inst === 'lecap' || (inst === 'macroLetra' && lecapMode === 'letra')) {
    const horizon = currentLecapPick();
    if (inst === 'lecap') {
      activeTNA = horizon.letter ? Number(horizon.letter.tna) : ZETA_CONFIG.marketRates.lecapTNA;
    }
    if (lecapMode === 'letra' && horizon.letter) {
      selectedLecapTicker = horizon.letter.ticker;
      currentPlazo = horizon.plazo;
    }
  } else if (inst === 'fci') {
    activeTNA = ZETA_CONFIG.marketRates.fciTNA;
  } else if (inst === 'plazofijo') {
    activeTNA = macroPlazoFijoRef(currentCapital, currentPlazo).tna;
  }

  if (inst !== 'cheques' && inst !== 'macroLetra') {
    document.getElementById('input-active-tna').value = activeTNA;
  }
  const tnaLabel = document.getElementById('tna-adjust-label');
  if (tnaLabel) {
    tnaLabel.textContent = (inst === 'lecap' || inst === 'caucion' || inst === 'fci')
      ? 'TNA bruta de simulación:'
      : 'TNA activa de simulación:';
  }

  syncChequeMode();
  renderQuickCapitalButtons();
  updateInstrumentVisuals();
  setPlazo(currentPlazo);
}

function caucionTnaForDays(days) {
  const rates = (ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.caucionByDays) || {};
  let tna = rates[days];
  if (!tna) {
    if (days <= 3) tna = rates[3];
    else if (days <= 7) tna = rates[7];
    else if (days <= 10) tna = rates[10];
    else if (days <= 15) tna = rates[15];
    else tna = rates[30];
  }
  return Number(tna);
}

function updateCaucionRateForDays(days) {
  const tna = caucionTnaForDays(days);
  const quote = netQuote('caucion', tna, days);
  const badge = document.getElementById('rate-badge-caucion');
  if (badge) {
    badge.textContent = quote && quote.tnaNeta != null
      ? `${formatLecapTna(quote.tnaNeta)}%`
      : `${Number(tna).toFixed(1)}%`;
  }
  const label = document.getElementById('caucion-net-label');
  if (label && quote && quote.tnaNeta != null) {
    label.textContent = `Bruta ${Number(tna).toFixed(2)}% · neta ${formatLecapTna(quote.tnaNeta)}%`;
  }
  // Solo la caución toma la TNA del plazo. LECAP, FCI y plazo fijo conservan la suya.
  if (selectedInstrument === 'caucion') {
    activeTNA = tna;
    document.getElementById('input-active-tna').value = tna;
  }
}

function updateInstrumentRates() {
  const rates = ZETA_CONFIG.marketRates;
  const horizon = (selectedInstrument === 'cheques' || selectedInstrument === 'macroLetra')
    ? liquidityPlazo
    : currentPlazo;
  const fciQuote = netQuote('fci', rates.fciTNA, horizon);
  const fciBadge = document.getElementById('rate-badge-fci');
  if (fciBadge) {
    fciBadge.textContent = `${formatLecapTna(fciQuote && fciQuote.tnaNeta != null ? fciQuote.tnaNeta : rates.fciTNA)}%`;
  }
  const fciLabel = document.getElementById('fci-net-label');
  const fciSource = document.getElementById('fci-source-label');
  if (fciLabel && fciQuote) {
    fciLabel.textContent = `Bruta ${formatLecapTna(rates.fciTNA)}% · T+0`;
  }
  if (fciSource) {
    const details = rates.fciDetails || {};
    const source = details.fuente === 'cnv' ? 'CNV' : 'config';
    fciSource.textContent = details.fecha ? `${source} · ${details.fecha}` : source;
  }

  refreshLecapCards();
  renderLecapCurve();

  const curveDays = (selectedInstrument === 'cheques' || selectedInstrument === 'macroLetra')
    ? liquidityPlazo
    : currentPlazo;
  updateCaucionRateForDays(curveDays);
  updateCaucionPillRates();
  refreshMacroVtoPill();

}

function refreshLecapCards() {
  const rates = ZETA_CONFIG.marketRates;
  const pfRef = macroPlazoFijoRef(currentCapital, currentPlazo);
  const pfBadge = document.getElementById('rate-badge-plazofijo');
  if (pfBadge) pfBadge.textContent = `${pfRef.tna.toFixed(1)}%`;
  const pfSource = document.getElementById('plazofijo-source-label');
  if (pfSource) pfSource.textContent = pfRef.label;
  const activeLetter = activeLecapLetter();
  const lecapQuote = netQuote('lecap', activeLetter.tna, activeLetter.dias);
  const lecapBadge = document.getElementById('rate-badge-lecap');
  if (lecapBadge) {
    lecapBadge.textContent = `${formatLecapTna(lecapQuote && lecapQuote.tnaNeta != null ? lecapQuote.tnaNeta : activeLetter.tna)}%`;
  }
  if (rates.lecapDetails) {
    const pill = document.getElementById('lecap-ticker-pill');
    const vto = document.getElementById('lecap-vto-label');
    const sourceLabel = document.getElementById('lecap-source-label');
    if (pill && activeLetter.ticker) pill.textContent = activeLetter.ticker;
    if (vto && activeLetter.vencimiento) vto.textContent = activeLetter.vencimiento;
    if (sourceLabel) sourceLabel.textContent = `Bruta ${formatLecapTna(activeLetter.tna)}% · ${activeLetter.dias}d · ${lecapSourceCaption(rates.lecapDetails)}`;
  }

  const macroBadge = document.getElementById('macro-letra-badge');
  if (macroBadge) {
    const macroQuote = netQuote('lecap', activeLetter.tna, activeLetter.dias);
    macroBadge.textContent = `${formatLecapTna(macroQuote && macroQuote.tnaNeta != null ? macroQuote.tnaNeta : activeLetter.tna)}%`;
  }
}

function formatLecapTna(value) {
  const n = Number(value);
  if (!isFinite(n)) return '—';
  return n.toFixed(2);
}

function lecapSourceCaption(details) {
  const source = (lecapQuoteMeta && lecapQuoteMeta.lecapSource) || (details && details.fuente) || 'config';
  if (source === 'data912') return 'Data912';
  if (source === 'byma') return 'BYMA';
  return 'config';
}

function renderLecapCurve() {
  const node = document.getElementById('lecap-curve');
  if (!node) return;
  const letters = (ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.lecaps) || [];
  const menu = typeof tradableLecaps === 'function' ? tradableLecaps(letters, new Date()) : [];
  if (!menu.length) {
    node.textContent = 'Letras: sin una vigente. Las ya vencidas no entran.';
    return;
  }
  const parts = menu.map((letter) => {
    const ticker = letter.ticker || 'LECAP';
    const tna = formatLecapTna(letter.tna);
    return `${ticker} ${letter.diasHoy}d TNA ${tna}%`;
  });
  const source = lecapSourceCaption(menu[0]);
  node.textContent = `Letras vigentes ${source}: ${parts.join('  ·  ')}`;
}

function updateCaucionPillRates() {
  const rates = (ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.caucionByDays) || {};
  [3, 7, 10, 15, 30].forEach(days => {
    const el = document.getElementById('pill-tna-' + days);
    const tna = Number(rates[days]);
    if (el && isFinite(tna)) el.textContent = tna.toFixed(1) + '%';
  });
}

function updateInstrumentVisuals() {
  if (currentCurrency === 'USD') {
    document.getElementById('active-instrument-badge').textContent = "Colocación USD 5%";
    document.getElementById('active-instrument-badge').className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
    return;
  }

  const btnCaucion = document.getElementById('btn-inst-caucion');
  const btnLecap = document.getElementById('btn-inst-lecap');
  const btnFci = document.getElementById('btn-inst-fci');
  const btnPlazo = document.getElementById('btn-inst-plazofijo');
  const btnCheques = document.getElementById('btn-inst-cheques');
  const btnMacro = document.getElementById('btn-inst-macro-letra');
  const badge = document.getElementById('active-instrument-badge');
  const idle = "p-3.5 rounded-2xl border text-left transition relative bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700";

  [btnCaucion, btnLecap, btnFci, btnPlazo, btnCheques].forEach(b => {
    if (!b) return;
    b.className = idle + (b === btnCheques ? " min-w-0" : "");
  });
  if (btnMacro) btnMacro.className = idle + " sm:col-span-2 min-w-0";

  if (selectedInstrument === 'caucion') {
    btnCaucion.className = "p-3.5 rounded-2xl border text-left transition relative bg-blue-500/10 border-blue-500 text-white";
    badge.textContent = "Caución Bursátil (BYMA)";
    badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30";
  } else if (selectedInstrument === 'lecap') {
    const ticker = activeLecapLetter().ticker;
    btnLecap.className = "p-3.5 rounded-2xl border text-left transition relative bg-emerald-500/10 border-emerald-500 text-white";
    badge.textContent = `LECAP Corta (${ticker})`;
    badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
  } else if (selectedInstrument === 'fci' && btnFci) {
    btnFci.className = "p-3.5 rounded-2xl border text-left transition relative bg-teal-500/10 border-teal-500 text-white";
    badge.textContent = "FCI liquidez (T+0)";
    badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30";
  } else if (selectedInstrument === 'plazofijo') {
    btnPlazo.className = "p-3.5 rounded-2xl border text-left transition relative bg-amber-500/10 border-amber-500 text-white";
    badge.textContent = "Plazo Fijo Tradicional";
    badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30";
  } else if (selectedInstrument === 'cheques' && btnCheques) {
    btnCheques.className = "p-3.5 rounded-2xl border text-left transition relative bg-fuchsia-500/10 border-fuchsia-500 text-white min-w-0";
    badge.textContent = "Descuento de cheques";
    badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30";
  } else if (selectedInstrument === 'macroLetra' && btnMacro) {
    btnMacro.className = "sm:col-span-2 min-w-0 p-3.5 rounded-2xl border text-left transition relative bg-sky-500/10 border-sky-500 text-white";
    const ticker = activeLecapLetter().ticker || "LECAP";
    badge.textContent = `Macro vs ${ticker}`;
    badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30";
  }
}

/* ==========================================================
   3. EVENT LISTENERS Y CÁLCULOS
========================================================== */

function setupEventListeners() {
  const inputCapital = document.getElementById('input-capital');
  const sliderPlazo = document.getElementById('slider-plazo');
  const inputTNA = document.getElementById('input-active-tna');

  inputCapital.addEventListener('input', (e) => {
    let cleanVal = e.target.value.replace(/\D/g, '');
    let numVal = parseInt(cleanVal, 10);
    if (isNaN(numVal)) numVal = 0;
    currentCapital = numVal;
    e.target.value = formatNumber(numVal);
    calculateYield();
  });

  sliderPlazo.addEventListener('input', (e) => {
    setPlazo(parseInt(e.target.value, 10));
  });

  inputTNA.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      activeTNA = val;
      calculateYield();
    }
  });

  [
    'cheque-bank-label', 'cheque-tna-bank', 'cheque-tna-zeta',
    'cheque-ref-promedio', 'cheque-ref-avalado', 'cheque-ref-no-garantizado', 'cheque-ref-garantia',
    'cheque-mav-venta', 'cheque-mav-compra', 'cheque-alyc', 'cheque-iva', 'cheque-icdb',
    'cheque-comision-banco', 'cheque-aval-sgr', 'cheque-sellos', 'cheque-iva-intereses-aliq'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (isChequeMode()) calculateYield();
    });
  });
  [
    'cheque-cobro-fci', 'cheque-aplicar-compra', 'cheque-iva-intereses', 'cheque-comision-banco-iva', 'cheque-aval-sgr-iva', 'cheque-computo'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      if (isChequeMode()) calculateYield();
    });
  });
  const chequeRefs = document.getElementById('cheque-market-refs');
  if (chequeRefs) {
    chequeRefs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-use-input]');
      if (!button) return;
      const source = document.getElementById(button.getAttribute('data-use-input'));
      const zetaTna = document.getElementById('cheque-tna-zeta');
      if (!source || !zetaTna) return;
      zetaTna.value = source.value;
      if (isChequeMode()) calculateYield();
    });
  }

  const plazoExact = document.getElementById('input-plazo-cheque');
  if (plazoExact) {
    plazoExact.addEventListener('input', () => {
      const n = parseInt(plazoExact.value, 10);
      if (!isNaN(n)) setPlazo(n);
    });
  }

  const plazoMacro = document.getElementById('input-plazo-macro');
  if (plazoMacro) {
    plazoMacro.addEventListener('input', () => {
      const n = parseInt(plazoMacro.value, 10);
      if (!isNaN(n)) setMacroPlazo(n);
    });
  }

  const macroTna = document.getElementById('macro-tna-bank');
  if (macroTna) {
    macroTna.addEventListener('input', () => {
      macroTnaDirty = true;
      if (isMacroLetraMode()) calculateYield();
    });
  }
  const letraTna = document.getElementById('macro-tna-letra');
  if (letraTna) {
    letraTna.addEventListener('input', () => {
      letraTnaDirty = true;
      if (isMacroLetraMode()) calculateYield();
    });
  }
  ['macro-bank-label', 'macro-comision', 'macro-derechos'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (isMacroLetraMode()) calculateYield();
    });
  });
  ['tax-mismo-titular', 'tax-queda-broker'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      updateInstrumentRates();
      calculateYield();
    });
  });
  const ivaToggle = document.getElementById('macro-aplica-iva');
  if (ivaToggle) {
    ivaToggle.addEventListener('change', () => {
      if (isMacroLetraMode()) calculateYield();
    });
  }
  const resetMacro = document.getElementById('macro-reset-tna');
  if (resetMacro) {
    resetMacro.addEventListener('click', () => {
      macroTnaDirty = false;
      if (isMacroLetraMode()) calculateYield();
    });
  }
  const resetLetra = document.getElementById('macro-reset-letra');
  if (resetLetra) {
    resetLetra.addEventListener('click', () => {
      letraTnaDirty = false;
      if (isMacroLetraMode()) calculateYield();
    });
  }
}

function setMacroPlazo(days) {
  lecapMode = 'plazo';
  selectedLecapTicker = null;
  manualLecapTicker = null;
  macroPlazoFollowsVto = false;
  letraTnaDirty = false;
  const input = document.getElementById('input-plazo-macro');
  if (input) input.readOnly = false;
  setPlazo(days);
}

function useLetraVto() {
  setLecapMode('letra');
}

function setCapital(amount) {
  currentCapital = amount;
  document.getElementById('input-capital').value = formatNumber(amount);
  calculateYield();
}

function setPlazo(days) {
  const max = isChequeMode() ? 180 : ((isMacroLetraMode() || selectedInstrument === 'lecap') ? 365 : 35);
  let safe = parseInt(days, 10);
  if (!isFinite(safe) || safe < 1) safe = 1;
  if (safe > max) safe = max;
  const changed = safe !== currentPlazo;
  currentPlazo = safe;
  if (!syncingLecapHorizon && (isMacroLetraMode() || selectedInstrument === 'lecap') && lecapMode === 'letra' && changed) {
    lecapMode = 'plazo';
    selectedLecapTicker = null;
    manualLecapTicker = null;
    letraTnaDirty = false;
  }
  if (isChequeMode()) chequePlazoDays = safe;
  else if (isMacroLetraMode()) macroLetraPlazoDays = safe;
  else if (selectedInstrument === 'lecap') lecapPlazoDays = safe;
  else if (currentCurrency === 'ARS') liquidityPlazo = safe;

  const slider = document.getElementById('slider-plazo');
  if (slider) {
    slider.max = String(max);
    slider.value = String(safe);
  }
  const plazoExact = document.getElementById('input-plazo-cheque');
  if (plazoExact && String(plazoExact.value) !== String(safe)) {
    plazoExact.value = String(safe);
  }
  const plazoMacro = document.getElementById('input-plazo-macro');
  if (plazoMacro && String(plazoMacro.value) !== String(safe)) {
    plazoMacro.value = String(safe);
  }
  document.getElementById('display-plazo').textContent = `${safe} días`;
  updatePlazoPills();

  if (currentCurrency === 'ARS' && selectedInstrument !== 'cheques' && selectedInstrument !== 'macroLetra') {
    updateCaucionRateForDays(safe);
  }

  calculateYield();
}

function updatePlazoPills() {
  const activeBorder = isChequeMode() ? 'border-fuchsia-500' : (isMacroLetraMode() ? 'border-sky-500' : 'border-blue-500');
  const activeBg = isChequeMode() ? 'bg-fuchsia-500/10' : (isMacroLetraMode() ? 'bg-sky-500/10' : 'bg-blue-500/10');
  document.querySelectorAll('.plazo-pill').forEach(btn => {
    const d = parseInt(btn.getAttribute('data-days'), 10);
    btn.classList.remove('border-blue-500', 'bg-blue-500/10', 'border-fuchsia-500', 'bg-fuchsia-500/10', 'border-sky-500', 'bg-sky-500/10', 'border-slate-700', 'bg-slate-800');
    if (d === currentPlazo) {
      btn.classList.add(activeBorder, activeBg);
    } else {
      btn.classList.add('border-slate-700', 'bg-slate-800');
    }
  });
}

/**
 * LECAP, caución y FCI se muestran netos. El plazo fijo y el dólar siguen brutos.
 * La TNA que edita el asesor es la bruta.
 */
function getBrokerCosts() {
  const cfg = (typeof ZETA_CONFIG !== 'undefined' && ZETA_CONFIG.brokerCosts) || {};
  const lecap = cfg.lecap || {};
  const caucion = cfg.caucion || {};
  const fci = cfg.fci || {};
  const legacy = (ZETA_CONFIG.macroVsLetra && ZETA_CONFIG.macroVsLetra.letra) || {};
  return {
    label: cfg.label || legacy.brokerLabel || 'Balanz',
    iva: numberOr(cfg.iva, numberOr(legacy.iva, 0.21)),
    lecap: {
      comisionPct: numberOr(lecap.comisionPct, numberOr(legacy.comisionPct, 0.10)),
      aplicaIva: lecap.aplicaIva != null ? !!lecap.aplicaIva : legacy.aplicaIva !== false,
      derechosPct: numberOr(lecap.derechosPct, numberOr(legacy.derechosPct, 0.001))
    },
    caucion: {
      comisionTnaPct: numberOr(caucion.comisionTnaPct != null ? caucion.comisionTnaPct : caucion.comisionPct90, 0.50),
      aplicaIva: caucion.aplicaIva !== false,
      derechosPct90: numberOr(caucion.derechosPct90, 0.045),
      derechosConIva: caucion.derechosConIva !== false
    },
    fci: {
      honorariosAnualesPct: numberOr(fci.honorariosAnualesPct, 2.45)
    }
  };
}

function getLecapFees() {
  const costs = getBrokerCosts();
  const ivaBox = document.getElementById('macro-aplica-iva');
  return {
    comisionPct: readOptionalNumber('macro-comision', costs.lecap.comisionPct),
    derechosPct: readOptionalNumber('macro-derechos', costs.lecap.derechosPct),
    aplicaIva: ivaBox ? ivaBox.checked : costs.lecap.aplicaIva,
    iva: costs.iva
  };
}

function getCaucionFees() {
  const costs = getBrokerCosts();
  return {
    comisionTnaPct: costs.caucion.comisionTnaPct,
    aplicaIva: costs.caucion.aplicaIva,
    iva: costs.iva,
    derechosPct90: costs.caucion.derechosPct90,
    derechosConIva: costs.caucion.derechosConIva
  };
}

function getBankTax() {
  const cfg = (typeof ZETA_CONFIG !== 'undefined' && ZETA_CONFIG.impuestoDebCred) || {};
  const exento = document.getElementById('tax-mismo-titular');
  const queda = document.getElementById('tax-queda-broker');
  return {
    alicuotaDebito: numberOr(cfg.alicuotaDebito, 0.006),
    alicuotaCredito: numberOr(cfg.alicuotaCredito, 0.006),
    mismoTitularExento: exento ? exento.checked : cfg.mismoTitularExento !== false,
    quedaEnBroker: queda ? queda.checked : !!cfg.quedaEnBroker
  };
}

function netQuote(inst, tna, days) {
  const tax = getBankTax();
  const gross = Number(tna);
  const plazo = Number(days);
  if (inst === 'lecap' && typeof calcLetraNeta === 'function' && typeof withBankTax === 'function') {
    return withBankTax(calcLetraNeta(currentCapital, plazo, gross, getLecapFees()), tax);
  }
  if (inst === 'caucion' && typeof calcCaucionNeta === 'function' && typeof withBankTax === 'function') {
    return withBankTax(calcCaucionNeta(currentCapital, plazo, gross, getCaucionFees()), tax);
  }
  if (inst === 'fci' && typeof calcFciSimple === 'function' && typeof withBankTax === 'function') {
    return withBankTax(calcFciSimple(currentCapital, plazo, gross), tax);
  }
  const interes = currentCapital * (gross / 100) * (plazo / 365);
  return {
    monto: currentCapital,
    dias: plazo,
    tnaBruta: gross,
    tnaNeta: gross,
    interes: interes,
    total: currentCapital + interes,
    impuesto: 0,
    impuestoExento: true,
    pricedNet: false
  };
}

function netCaption(quote) {
  const rates = `Bruta ${formatPercentPoints(quote.tnaBruta)} · neta ${formatPercentPoints(quote.tnaNeta)}`;
  if (!quote || quote.impuestoExento !== false) {
    return `${rates} · Débitos y créditos $0 (mismo titular, exenta)`;
  }
  const vuelta = quote.quedaEnBroker ? 'sin vuelta al banco' : 'ida y vuelta';
  return `${rates} · Débitos y créditos ${formatMoneyARS(quote.impuesto)} (${vuelta})`;
}

function initTaxToggles() {
  const cfg = (ZETA_CONFIG && ZETA_CONFIG.impuestoDebCred) || {};
  const exento = document.getElementById('tax-mismo-titular');
  const queda = document.getElementById('tax-queda-broker');
  if (exento) exento.checked = cfg.mismoTitularExento !== false;
  if (queda) queda.checked = !!cfg.quedaEnBroker;
  const summary = document.getElementById('broker-cost-summary');
  if (!summary) return;
  const costs = getBrokerCosts();
  summary.textContent = `Letra: compra ${formatPercentPoints(costs.lecap.comisionPct)} + IVA, sin venta. Derechos BYMA ${formatPercentPoints(costs.lecap.derechosPct)}, sin IVA. Caución: ${formatPercentPoints(costs.caucion.comisionTnaPct)} TNA + IVA y derechos ${formatPercentPoints(costs.caucion.derechosPct90)} + IVA. FCI: sin comisión de entrada ni de salida. Honorarios ${formatPercentPoints(costs.fci.honorariosAnualesPct)} ya en la cuotaparte.`;
}

function calculateYield() {
  // Las tarjetas de la letra siguen a la letra y al plazo elegidos.
  refreshLecapCards();
  if (isChequeMode()) {
    renderChequeExperience();
    return;
  }
  if (isMacroLetraMode()) {
    renderMacroLetraExperience();
    return;
  }

  const gananciaLabel = document.getElementById('modal-ganancia-label');
  if (gananciaLabel) gananciaLabel.textContent = 'Rendimiento';

  const currPrefix = currentCurrency === 'USD' ? 'US$' : '$';
  let quoteDays = currentPlazo;
  let quoteTna = activeTNA;
  if (selectedInstrument === 'lecap') {
    const horizon = currentLecapPick();
    if (horizon.letter) {
      quoteDays = horizon.letter.diasHoy;
      quoteTna = Number(horizon.letter.tna);
      activeTNA = quoteTna;
    }
    syncLecapHorizonUI(horizon);
  }
  const quote = netQuote(selectedInstrument, quoteTna, quoteDays);
  const rendimiento = Math.round(quote.interes);
  const capitalFinal = currentCapital + rendimiento;
  const rendimientoDiario = quoteDays > 0 ? Math.round(rendimiento / quoteDays) : 0;

  // Actualizar Tarjeta Principal
  document.getElementById('display-rendimiento').textContent = `+${currPrefix}${formatNumber(rendimiento)}`;
  document.getElementById('display-resumen-capital').textContent = `${currPrefix}${formatNumber(currentCapital)}`;
  document.getElementById('display-capital-final').textContent = `${currPrefix}${formatNumber(capitalFinal)}`;
  document.getElementById('display-diario').textContent = `+${currPrefix}${formatNumber(rendimientoDiario)} / día`;
  document.getElementById('display-opportunity-cost').textContent = `+${currPrefix}${formatNumber(rendimiento)}`;
  const netDetail = document.getElementById('display-net-detail');
  const lead = document.getElementById('display-lead-explanation');
  if (netDetail) {
    if (quote.pricedNet && currentCurrency === 'ARS') {
      netDetail.textContent = netCaption(quote);
      netDetail.classList.remove('hidden');
    } else {
      netDetail.textContent = '';
    }
  }
  if (lead) {
    lead.textContent = quote.pricedNet && currentCurrency === 'ARS'
      ? 'Interés neto, después de la comisión de referencia. El plazo fijo del mismo banco no paga débitos y créditos.'
      : 'Intereses netos que ingresan a la cuenta comitente de la PyME.';
  }

  // Actualizar Modal
  const lecapTicker = activeLecapLetter().ticker;
  const instNames = {
    caucion: "Caución Bursátil",
    lecap: `LECAP (${lecapTicker})`,
    fci: "FCI liquidez",
    plazofijo: "Plazo Fijo",
    usd: "Colocación USD 5%"
  };
  document.getElementById('modal-instrumento').textContent = instNames[selectedInstrument] || selectedInstrument;
  document.getElementById('modal-capital-plazo').textContent = `${currPrefix}${formatNumber(currentCapital)} • ${currentPlazo}d`;
  document.getElementById('modal-ganancia').textContent = `+${currPrefix}${formatNumber(rendimiento)}`;

  // Renderizar Comparativa Multiactivo
  renderComparisonTable(rendimiento);
}

function renderComparisonTable(currentRendimiento) {
  const container = document.getElementById('comparison-rows-container');
  const currPrefix = currentCurrency === 'USD' ? 'US$' : '$';

  if (currentCurrency === 'USD') {
    container.innerHTML = `
      <div class="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
            $
          </div>
          <div>
            <span class="block text-xs font-bold text-emerald-300">Renta Corporativa USD (5.0% TNA)</span>
            <span class="text-[11px] text-emerald-400/80">Liquidación en dólares billete</span>
          </div>
        </div>
        <span class="font-mono font-bold text-emerald-400 text-sm">+${currPrefix}${formatNumber(currentRendimiento)}</span>
      </div>
      <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center font-bold text-xs">
            ✕
          </div>
          <div>
            <span class="block text-xs font-bold text-slate-300">Caja de Ahorro en Dólares (Banco)</span>
            <span class="text-[11px] text-slate-500">Tasa 0% anual</span>
          </div>
        </div>
        <span class="font-mono font-bold text-slate-400 text-sm">US$0</span>
      </div>
    `;
    return;
  }

  // Cálculos para cada alternativa en Pesos. LECAP, caución y FCI van netos.
  const rates = ZETA_CONFIG.marketRates;
  const tnaCaucion = caucionTnaForDays(currentPlazo);
  const caucionQuote = netQuote('caucion', tnaCaucion, currentPlazo);
  const letterHorizon = currentLecapPick();
  const letter = letterHorizon.letter;
  const lecapDays = letter ? letter.diasHoy : currentPlazo;
  const lecapTna = letter ? letter.tna : rates.lecapTNA;
  const lecapQuote = netQuote('lecap', lecapTna, lecapDays);
  const fciQuote = netQuote('fci', rates.fciTNA, currentPlazo);
  const yieldCaucion = Math.round(caucionQuote.interes);
  const yieldLecap = Math.round(lecapQuote.interes);
  const yieldFci = Math.round(fciQuote.interes);
  
  // Plazo fijo: requiere min 30 días
  const pfEligible = currentPlazo >= 30;
  const pfRef = macroPlazoFijoRef(currentCapital, currentPlazo);
  const yieldPlazoFijo = Math.round(currentCapital * (pfRef.tna / 100) * (currentPlazo / 365));
  const lecapTicker = letter ? letter.ticker : (rates.lecapDetails?.ticker || "S30N6");
  const lecapVto = letter ? (letter.vencimiento || "") : (rates.lecapDetails?.vencimiento || "30/11/2026");
  const lecapDayNote = lecapDays === currentPlazo
    ? `${lecapDays} días`
    : `${lecapDays} días hasta el vencimiento`;

  container.innerHTML = `
    <!-- 1. LECAP Corta -->
    <div onclick="selectInstrument('lecap')" class="cursor-pointer p-3.5 rounded-xl border transition flex items-center justify-between ${selectedInstrument === 'lecap' ? 'bg-emerald-500/15 border-emerald-500' : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'}">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
          ⚡
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-bold text-slate-200">LECAP Corta (${lecapTicker})</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 font-mono font-bold">${formatLecapTna(lecapQuote.tnaNeta)}% neta</span>
            <span class="text-[9px] px-1 py-0.2 rounded bg-emerald-900/60 text-emerald-300">Vto: ${lecapVto}</span>
          </div>
          <span class="text-[11px] text-slate-400">Bruta ${formatLecapTna(lecapTna)}% · ${lecapDayNote} · compra única, sin venta</span>
        </div>
      </div>
      <span class="font-mono font-bold text-emerald-400 text-sm">+${currPrefix}${formatNumber(yieldLecap)}</span>
    </div>

    <!-- 2. Caución Bursátil -->
    <div onclick="selectInstrument('caucion')" class="cursor-pointer p-3.5 rounded-xl border transition flex items-center justify-between ${selectedInstrument === 'caucion' ? 'bg-blue-500/15 border-blue-500' : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'}">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs">
          🛡️
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-bold text-slate-200">Caución Bursátil</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-400 font-mono font-bold">${formatLecapTna(caucionQuote.tnaNeta)}% neta</span>
            <span class="text-[9px] px-1 py-0.2 rounded bg-blue-900/60 text-blue-300">Garantía BYMA</span>
          </div>
          <span class="text-[11px] text-slate-400">Bruta ${Number(tnaCaucion).toFixed(2)}% · ${currentPlazo} días &bull; comisión prorrateada</span>
        </div>
      </div>
      <span class="font-mono font-bold text-blue-400 text-sm">+${currPrefix}${formatNumber(yieldCaucion)}</span>
    </div>

    <div onclick="selectInstrument('fci')" class="cursor-pointer p-3.5 rounded-xl border transition flex items-center justify-between ${selectedInstrument === 'fci' ? 'bg-teal-500/15 border-teal-500' : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'}">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-300 flex items-center justify-center font-bold text-xs">
          F
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-bold text-slate-200">FCI liquidez</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-teal-950 text-teal-300 font-mono font-bold">${formatLecapTna(fciQuote.tnaNeta)}% neta</span>
            <span class="text-[9px] px-1 py-0.2 rounded bg-teal-900/60 text-teal-200">T+0</span>
          </div>
          <span class="text-[11px] text-slate-400">Bruta ${formatLecapTna(rates.fciTNA)}% · sin comisión de entrada ni de salida · ${(rates.fciDetails && rates.fciDetails.fuente) === 'cnv' ? 'CNV' : 'config'}</span>
        </div>
      </div>
      <span class="font-mono font-bold text-teal-300 text-sm">+${currPrefix}${formatNumber(yieldFci)}</span>
    </div>

    <!-- 3. Plazo Fijo Bancario -->
    <div onclick="selectInstrument('plazofijo')" class="cursor-pointer p-3.5 rounded-xl border transition flex items-center justify-between ${selectedInstrument === 'plazofijo' ? 'bg-amber-500/15 border-amber-500' : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'}">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-xs">
          🏦
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-bold text-slate-200">Plazo Fijo Banco</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono font-bold">${pfRef.tna}% TNA</span>
          </div>
          <span class="text-[11px] ${pfEligible ? 'text-slate-400' : 'text-amber-400/90 font-medium'}">
            ${pfEligible ? 'Inmovilizado por 30 días' : '⚠️ No disponible para menos de 30 días'}
          </span>
        </div>
      </div>
      <span class="font-mono font-bold ${pfEligible ? 'text-slate-300' : 'text-slate-500'} text-sm">
        ${pfEligible ? `+${currPrefix}${formatNumber(yieldPlazoFijo)}` : 'N/A'}
      </span>
    </div>

    <!-- 4. Cuenta Corriente Banco -->
    <div class="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/60 flex items-center justify-between opacity-75">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center font-bold text-xs">
          ✕
        </div>
        <div>
          <span class="block text-xs font-bold text-slate-400">Cuenta Corriente Bancaria</span>
          <span class="text-[11px] text-slate-500">Saldo a la vista (Tasa 0% - Pérdida inflacionaria)</span>
        </div>
      </div>
      <span class="font-mono font-bold text-slate-500 text-sm">$0</span>
    </div>
  `;
}

function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/* ==========================================================
   3b. DESCUENTO DE CHEQUES (Banco vs Propuesta Zeta)
   Fórmulas: cheque-discount.js
========================================================== */

function isChequeMode() {
  return currentCurrency === 'ARS' && selectedInstrument === 'cheques';
}

function isMacroLetraMode() {
  return currentCurrency === 'ARS' && selectedInstrument === 'macroLetra';
}

function syncChequeMode() {
  const cheque = isChequeMode();
  const macro = isMacroLetraMode();
  const lecapInst = currentCurrency === 'ARS' && selectedInstrument === 'lecap';
  const single = !cheque && !macro;
  const toggle = (id, show) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
  };

  toggle('cheque-rate-overrides', cheque);
  toggle('cheque-plazo-direct', cheque);
  toggle('plazo-pills-cheques', cheque);
  toggle('cheque-comparison-card', cheque);
  toggle('cheque-result-stack', cheque);
  toggle('macro-rate-overrides', macro);
  toggle('macro-plazo-direct', macro);
  toggle('plazo-pills-macro', macro);
  toggle('lecap-horizon-mode', macro || lecapInst);
  toggle('macro-comparison-card', macro);
  toggle('macro-result-stack', macro);
  toggle('plazo-pills-liquidity', single);
  toggle('broker-cost-panel', currentCurrency === 'ARS' && !cheque);
  toggle('tna-adjust-row', single);
  toggle('multiasset-table-card', single);
  toggle('liquidity-result-card', single);
  toggle('liquidity-opportunity-card', single);

  const capitalLabel = document.getElementById('label-capital-input');
  const capitalHint = document.getElementById('label-capital-hint');
  const plazoLabel = document.getElementById('label-plazo');
  if (cheque) {
    if (capitalLabel) capitalLabel.textContent = 'Monto a descontar';
    if (capitalHint) capitalHint.textContent = 'Valor nominal del cheque';
    if (plazoLabel) plazoLabel.textContent = 'Plazo del cheque (días)';
  } else if (macro) {
    if (capitalLabel) capitalLabel.textContent = 'Capital a colocar';
    if (capitalHint) capitalHint.textContent = 'El tramo de Macro depende del monto';
    if (plazoLabel) plazoLabel.textContent = lecapMode === 'letra' ? 'Días hasta el vencimiento de la letra' : 'Plazo libre (días)';
  } else if (lecapInst) {
    if (plazoLabel) plazoLabel.textContent = lecapMode === 'letra' ? 'Días hasta el vencimiento de la letra' : 'Plazo libre (días)';
  } else if (currentCurrency === 'ARS') {
    if (capitalLabel) capitalLabel.textContent = 'Capital a Rentabilizar';
    if (capitalHint) capitalHint.textContent = 'Mínimo sugerido: $500.000 ARS';
    if (plazoLabel) plazoLabel.textContent = 'Horizonte de Tiempo (Días)';
  } else {
    if (capitalLabel) capitalLabel.textContent = 'Capital a Rentabilizar';
    if (capitalHint) capitalHint.textContent = 'Tasa corporativa fija: 5% anual en dólares';
    if (plazoLabel) plazoLabel.textContent = 'Horizonte de Tiempo (Días)';
  }

  const slider = document.getElementById('slider-plazo');
  if (slider) {
    slider.max = cheque ? '180' : ((macro || lecapInst) ? '365' : '35');
    slider.classList.toggle('accent-fuchsia-500', cheque);
    slider.classList.toggle('accent-sky-500', macro);
    slider.classList.toggle('accent-blue-500', !cheque && !macro);
  }
}

function seedChequeMarketFallbacks() {
  if (typeof ZETA_CONFIG === 'undefined') return;
  if (!ZETA_CONFIG.marketRates.bcra && typeof bcraPanelFromSources === 'function') {
    ZETA_CONFIG.marketRates.bcra = bcraPanelFromSources(null);
  }
  if (!ZETA_CONFIG.marketRates.chequeLecaps && typeof buildChequeLecapQuotes === 'function') {
    ZETA_CONFIG.marketRates.chequeLecaps = buildChequeLecapQuotes({});
  }
}

function getChequeConfig() {
  const cfg = (typeof ZETA_CONFIG !== 'undefined' && ZETA_CONFIG.chequeDiscount) || {};
  const example = typeof chequeCostoEjemplo === 'function' ? chequeCostoEjemplo() : {};
  const costos = cfg.costos || {};
  const refs = cfg.referenciasCheques || {};
  return {
    bankLabel: cfg.bankLabel || 'Banco',
    bank: { tnaDesc: numberOr(cfg.bank && cfg.bank.tnaDesc, 27.5) },
    zeta: { tnaDesc: numberOr(cfg.zeta && cfg.zeta.tnaDesc, example.tna || 25.73) },
    costos: {
      iva: numberOr(costos.iva, example.iva != null ? example.iva : 0.21),
      mavVentaPct: numberOr(costos.mavVentaPct, 0.06),
      mavCompraPct: numberOr(costos.mavCompraPct, 0.03),
      aplicarCompra: costos.aplicarCompra === true,
      alycPct: numberOr(costos.alycPct, 0.40),
      icdbAlicuota: numberOr(costos.icdbAlicuota, 0.006),
      computoGanancias: numberOr(costos.computoGanancias, 0),
      cobroFciMoneyMarket: costos.cobroFciMoneyMarket === true,
      ivaIntereses: costos.ivaIntereses === true,
      ivaInteresesAlicuota: numberOr(costos.ivaInteresesAlicuota, 0.21),
      comisionBancoPct: numberOr(costos.comisionBancoPct, 0),
      comisionBancoIva: costos.comisionBancoIva === true,
      avalSgrPct: numberOr(costos.avalSgrPct, 0),
      avalSgrIva: costos.avalSgrIva === true,
      sellosPct: numberOr(costos.sellosPct, 0)
    },
    referencias: {
      periodo: refs.periodo || 'septiembre 2026',
      fuente: refs.fuente || 'VetaCap vía Infobae, 21/10/2026',
      nota: refs.nota || 'Estos valores se cargan a mano.',
      promedio: numberOr(refs.promedio, 26.84),
      avalado: numberOr(refs.avalado, 25.73),
      noGarantizado: numberOr(refs.noGarantizado, 29.23),
      garantiaMav: numberOr(refs.garantiaMav, 24.92)
    }
  };
}

function numberOr(value, fallback) {
  const n = Number(value);
  return isFinite(n) ? n : fallback;
}

function readOptionalNumber(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const raw = String(el.value).trim().replace(',', '.');
  if (raw === '') return fallback;
  const n = parseFloat(raw);
  if (!isFinite(n) || n < 0) return fallback;
  return n;
}

function initChequeControls() {
  const cfg = getChequeConfig();
  const label = document.getElementById('cheque-bank-label');
  const bankTna = document.getElementById('cheque-tna-bank');
  const zetaTna = document.getElementById('cheque-tna-zeta');
  if (label) {
    label.value = cfg.bankLabel;
    label.placeholder = cfg.bankLabel;
  }
  if (bankTna) bankTna.value = String(cfg.bank.tnaDesc);
  if (zetaTna) zetaTna.value = String(cfg.zeta.tnaDesc);

  const costos = cfg.costos;
  setInputValue('cheque-mav-venta', costos.mavVentaPct);
  setInputValue('cheque-mav-compra', costos.mavCompraPct);
  setInputValue('cheque-alyc', costos.alycPct);
  setInputValue('cheque-iva', Math.round(costos.iva * 1000) / 10);
  setInputValue('cheque-icdb', Math.round(costos.icdbAlicuota * 10000) / 100);
  setInputValue('cheque-comision-banco', costos.comisionBancoPct);
  setInputValue('cheque-aval-sgr', costos.avalSgrPct);
  setInputValue('cheque-sellos', costos.sellosPct);
  setInputValue('cheque-iva-intereses-aliq', Math.round(costos.ivaInteresesAlicuota * 1000) / 10);
  setChecked('cheque-cobro-fci', costos.cobroFciMoneyMarket);
  setChecked('cheque-aplicar-compra', costos.aplicarCompra);
  setChecked('cheque-iva-intereses', costos.ivaIntereses);
  setChecked('cheque-comision-banco-iva', costos.comisionBancoIva);
  setChecked('cheque-aval-sgr-iva', costos.avalSgrIva);
  const computo = document.getElementById('cheque-computo');
  if (computo) computo.value = String(costos.computoGanancias);

  const refs = cfg.referencias;
  setInputValue('cheque-ref-promedio', refs.promedio);
  setInputValue('cheque-ref-avalado', refs.avalado);
  setInputValue('cheque-ref-no-garantizado', refs.noGarantizado);
  setInputValue('cheque-ref-garantia', refs.garantiaMav);
  const note = document.getElementById('cheque-ref-note');
  if (note) {
    note.textContent = `${refs.fuente}. ${refs.periodo.charAt(0).toUpperCase()}${refs.periodo.slice(1)}, no es una curva de este mes. ${refs.nota}`;
  }

  const plazoExact = document.getElementById('input-plazo-cheque');
  if (plazoExact) plazoExact.value = String(chequePlazoDays);
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el && document.activeElement !== el) el.value = String(value);
}

function setChecked(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = !!checked;
}

function readCheckbox(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return !!fallback;
  return !!el.checked;
}

function readChequeCostParams(tna) {
  const cfg = getChequeConfig().costos;
  const computoEl = document.getElementById('cheque-computo');
  const computo = computoEl ? parseFloat(computoEl.value) : cfg.computoGanancias;
  return {
    tna,
    iva: readOptionalNumber('cheque-iva', cfg.iva * 100) / 100,
    mavVentaPct: readOptionalNumber('cheque-mav-venta', cfg.mavVentaPct),
    mavCompraPct: readOptionalNumber('cheque-mav-compra', cfg.mavCompraPct),
    aplicarCompra: readCheckbox('cheque-aplicar-compra', cfg.aplicarCompra),
    alycPct: readOptionalNumber('cheque-alyc', cfg.alycPct),
    icdbAlicuota: readOptionalNumber('cheque-icdb', cfg.icdbAlicuota * 100) / 100,
    computoGanancias: isFinite(computo) && computo >= 0 && computo <= 1 ? computo : 0,
    cobroFciMoneyMarket: readCheckbox('cheque-cobro-fci', cfg.cobroFciMoneyMarket),
    ivaIntereses: readCheckbox('cheque-iva-intereses', cfg.ivaIntereses),
    ivaInteresesAlicuota: readOptionalNumber('cheque-iva-intereses-aliq', cfg.ivaInteresesAlicuota * 100) / 100,
    comisionBancoPct: readOptionalNumber('cheque-comision-banco', cfg.comisionBancoPct),
    comisionBancoIva: readCheckbox('cheque-comision-banco-iva', cfg.comisionBancoIva),
    avalSgrPct: readOptionalNumber('cheque-aval-sgr', cfg.avalSgrPct),
    avalSgrIva: readCheckbox('cheque-aval-sgr-iva', cfg.avalSgrIva),
    sellosPct: readOptionalNumber('cheque-sellos', cfg.sellosPct)
  };
}

function getChequeScenario() {
  const cfg = getChequeConfig();
  const labelInput = document.getElementById('cheque-bank-label');
  const typedLabel = labelInput ? labelInput.value.trim() : '';
  const bankLabel = typedLabel || cfg.bankLabel;
  const bankTna = readOptionalNumber('cheque-tna-bank', cfg.bank.tnaDesc);
  const zetaTna = readOptionalNumber('cheque-tna-zeta', cfg.zeta.tnaDesc);
  const quoteWith = typeof calcChequeCosto === 'function' ? calcChequeCosto : calcChequeQuote;
  const bank = quoteWith(currentCapital, currentPlazo, readChequeCostParams(bankTna));
  const zeta = quoteWith(currentCapital, currentPlazo, readChequeCostParams(zetaTna));

  let conviene = 'No comparable';
  let winner = null;
  if (bank.cftEfectivo != null && zeta.cftEfectivo != null) {
    const diff = zeta.cftEfectivo - bank.cftEfectivo;
    if (Math.abs(diff) < 1e-10) {
      conviene = 'Empate';
      winner = 'empate';
    } else if (diff < 0) {
      conviene = 'Propuesta Zeta';
      winner = 'zeta';
    } else {
      conviene = bankLabel;
      winner = 'banco';
    }
  } else if (zeta.cftEfectivo != null) {
    conviene = 'Propuesta Zeta';
    winner = 'zeta';
  } else if (bank.cftEfectivo != null) {
    conviene = bankLabel;
    winner = 'banco';
  }

  return {
    bankLabel,
    bank,
    zeta,
    conviene,
    winner,
    monto: currentCapital,
    plazo: currentPlazo
  };
}

function renderChequeExperience() {
  const scenario = getChequeScenario();
  const grid = document.getElementById('cheque-comparison-grid');
  if (grid) {
    grid.innerHTML = [
      renderChequeSideCard('banco', scenario.bankLabel, scenario.bank, scenario),
      renderChequeSideCard('zeta', 'Propuesta Zeta', scenario.zeta, scenario)
    ].join('');
  }

  setText('cheque-hero-cft', formatMoneyARS(scenario.zeta.montoRecibido));
  const fci = !!(scenario.zeta && scenario.zeta.cobroFciMoneyMarket);
  setText('cheque-hero-subtitle', fci
    ? 'Propuesta Zeta. En esta simulación el impuesto al cheque quedó en cero porque el cobro va a un FCI money market a 1 día. A confirmar: no es una exención definitiva.'
    : 'Propuesta Zeta, después de los costos cargados.');
  setText('cheque-hero-rates', fci
    ? `TNA sin impuesto ${formatPercentPoints(scenario.zeta.tnaSinIcdbPct)} · TNA con impuesto ${formatPercentPoints(scenario.zeta.tnaConIcdbPct)} (no aplicada)`
    : `TNA ${formatPercentPoints(scenario.zeta.tnaCostoPct)} · TEA ${formatPercentPoints(scenario.zeta.teaCostoPct)}`);
  setText('cheque-winner-badge', scenario.conviene === 'Empate' || scenario.conviene === 'No comparable'
    ? scenario.conviene
    : `Conviene ${scenario.conviene}`);
  setText('cheque-hero-monto', formatMoneyARS(scenario.monto));
  setText('cheque-hero-zeta', formatMoneyARS(scenario.zeta.montoRecibido));
  setText('cheque-hero-bank-label', `Recibe con ${scenario.bankLabel}`);
  setText('cheque-hero-bank', formatMoneyARS(scenario.bank.montoRecibido));

  const delta = scenario.zeta.montoRecibido - scenario.bank.montoRecibido;
  if (Math.abs(delta) < 0.005) {
    setText('cheque-hero-delta-label', 'Diferencia de neto');
    setText('cheque-hero-delta', formatMoneyARS(0));
  } else if (delta > 0) {
    setText('cheque-hero-delta-label', 'A favor de Zeta');
    setText('cheque-hero-delta', formatMoneyARS(delta));
  } else {
    setText('cheque-hero-delta-label', `A favor de ${scenario.bankLabel}`);
    setText('cheque-hero-delta', formatMoneyARS(Math.abs(delta)));
  }

  setText('modal-instrumento', 'Descuento de cheques');
  setText('modal-capital-plazo', `${formatMoneyARS(scenario.monto)} • ${scenario.plazo}d`);
  setText('modal-ganancia-label', 'Conviene');
  const pct = scenario.zeta.tnaCostoPct;
  setText('modal-ganancia', pct == null ? scenario.conviene : `${scenario.conviene} · TNA ${formatPercentPoints(pct)}`);
  renderChequeMarketContext(scenario);
  renderChequeWait(scenario);
}

function renderChequeSideCard(key, title, quote, scenario) {
  const won = scenario.winner === key;
  const border = won
    ? 'border-emerald-500 bg-emerald-500/10'
    : 'border-slate-800 bg-slate-950/40';
  const cftClass = won ? 'text-emerald-400' : 'text-white';
  const badge = won
    ? '<span class="shrink-0 text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">Conviene</span>'
    : '';

  return `
    <article class="min-w-0 rounded-2xl border p-4 ${border}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">${key === 'zeta' ? 'Propuesta' : 'Banco'}</p>
          <h5 class="font-bold text-white text-sm leading-snug">${escapeHtml(title)}</h5>
          <p class="text-[11px] text-slate-400 mt-0.5">TNA descuento ${formatPercentPoints(quote.tnaDesc)}</p>
        </div>
        ${badge}
      </div>
      <div class="space-y-1.5 text-xs">
        ${chequeMoneyRow('Interés de la tasa pactada', quote.interes)}
        ${chequeMoneyRow('Derecho MAV venta + IVA', quote.mavVenta)}
        ${quote.mavCompra > 0 ? chequeMoneyRow('Derecho MAV compra + IVA', quote.mavCompra) : ''}
        ${chequeMoneyRow('Arancel ALyC + IVA', quote.alyc)}
        ${quote.ivaInteresesPesos > 0 ? chequeMoneyRow('IVA sobre intereses', quote.ivaInteresesPesos) : ''}
        ${quote.comisionBanco > 0 ? chequeMoneyRow('Comisión bancaria', quote.comisionBanco) : ''}
        ${quote.avalSgr > 0 ? chequeMoneyRow('Aval SGR', quote.avalSgr) : ''}
        ${quote.sellos > 0 ? chequeMoneyRow('Sellos', quote.sellos) : ''}
        ${chequeMoneyRow(quote.cobroFciMoneyMarket ? 'Impuesto créd/déb (en cero)' : 'Impuesto créd/déb', quote.icdbNeto)}
        ${quote.cobroFciMoneyMarket ? '<p class="text-[10px] leading-relaxed text-amber-200">En esta simulación el impuesto al cheque quedó en cero: el cobro va a un FCI money market a 1 día. A confirmar. No es una exención definitiva.</p>' : ''}
        ${chequeMoneyRow('Total costos', quote.totalCostos, true)}
      </div>
      <div class="mt-3 rounded-xl ${won ? 'bg-emerald-500/15' : 'bg-slate-800/80'} px-3 py-2.5 flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wide ${won ? 'text-emerald-200' : 'text-slate-300'}">Líquido a cobrar</span>
        <span class="font-mono font-bold ${won ? 'text-emerald-300' : 'text-white'} text-sm text-right">${formatMoneyARS(quote.liquido)}</span>
      </div>
      <div class="mt-3 space-y-1.5 text-xs">
        ${chequePctPointsRow('Costo efectivo TNA', quote.tnaCostoPct)}
        ${chequePctPointsRow('Costo efectivo TEA', quote.teaCostoPct)}
        ${quote.cobroFciMoneyMarket ? chequePctPointsRow('TNA con impuesto (no aplicada)', quote.tnaConIcdbPct) : ''}
        ${chequePctPointsRow('TNA sin impuesto al cheque', quote.tnaSinIcdbPct)}
      </div>
      <div class="mt-3 pt-3 border-t border-slate-800/80">
        <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Costo efectivo TEA</p>
        <p class="text-2xl sm:text-3xl font-extrabold font-mono tracking-tight ${cftClass}">${formatPercentPoints(quote.teaCostoPct)}</p>
        <p class="text-[10px] text-slate-500">TNA ${formatPercentPoints(quote.tnaCostoPct)} · tasa pactada ${formatPercentPoints(quote.tnaDesc)}</p>
      </div>
    </article>
  `;
}

function formatIsoDateAr(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return iso ? String(iso) : '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function renderChequeMarketContext(scenario) {
  const list = document.getElementById('cheque-bcra-list');
  const status = document.getElementById('cheque-bcra-status');
  const ceiling = document.getElementById('cheque-ceiling-note');
  const panel = (ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.bcra) || null;
  if (status) {
    if (!panel) {
      status.textContent = '';
    } else if (panel.status === 'bcra') {
      status.textContent = 'BCRA en vivo';
      status.className = 'text-[10px] text-emerald-300 text-right';
    } else if (panel.status === 'parcial') {
      status.textContent = 'Parte en vivo. El resto es el último valor cargado.';
      status.className = 'text-[10px] text-amber-300 text-right';
    } else {
      const when = formatIsoDateAr(panel.asOf);
      status.textContent = when
        ? `Último valor cargado (${when}). El BCRA no respondió.`
        : 'Último valor cargado. El BCRA no respondió.';
      status.className = 'text-[10px] text-amber-300 text-right';
    }
  }
  if (list) {
    const series = (panel && panel.series) || [];
    list.innerHTML = series.map((row) => {
      const value = row.unit === 'millones'
        ? `${formatNumber(Math.round(row.valor))} mill.`
        : formatPercentPoints(row.valor);
      const when = formatIsoDateAr(row.fecha);
      const stale = row.stale ? ' · último valor cargado' : '';
      const hint = row.hint ? ` · ${row.hint}` : '';
      return `<div class="flex items-baseline justify-between gap-3 text-[11px]">
        <span class="text-slate-400 min-w-0">${escapeHtml(row.label)}<span class="text-slate-500">${escapeHtml(hint)}</span></span>
        <span class="font-mono text-slate-200 text-right shrink-0">${value}<span class="block text-[10px] text-slate-500 font-sans">BCRA ${row.id} · ${escapeHtml(when)}${stale}</span></span>
      </div>`;
    }).join('');
  }
  if (ceiling) {
    const sola = panel && typeof bcraSeriesByKey === 'function' ? bcraSeriesByKey(panel, 'solaFirma') : null;
    const zetaTna = scenario.zeta && scenario.zeta.tnaDesc;
    const bankTna = scenario.bank && scenario.bank.tnaDesc;
    const top = Math.max(numberOr(zetaTna, 0), numberOr(bankTna, 0));
    if (sola && sola.valor != null && top > sola.valor + 0.05) {
      ceiling.classList.remove('hidden');
      ceiling.textContent = `La tasa ingresada supera los documentos a sola firma del BCRA (${formatPercentPoints(sola.valor)} al ${formatIsoDateAr(sola.fecha)}), que acá se usan como techo de referencia.`;
    } else {
      ceiling.classList.add('hidden');
      ceiling.textContent = '';
    }
  }
}

function chequeCaucionQuotes() {
  const live = ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.caucionQuotes;
  if (Array.isArray(live) && live.length) return live;
  if (typeof caucionQuotesFromBuckets === 'function') {
    return caucionQuotesFromBuckets(ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.caucionByDays);
  }
  return [];
}

function renderChequeWait(scenario) {
  const intro = document.getElementById('cheque-wait-intro');
  const body = document.getElementById('cheque-wait-body');
  if (!body) return;
  const quote = scenario.zeta;
  if (intro) {
    intro.textContent = `Para la propuesta Zeta el costo es ${formatPercentPoints(quote.tnaCostoPct)} TNA y ${formatPercentPoints(quote.teaCostoPct)} TEA. El líquido es ${formatMoneyARS(quote.liquido)}. Si ese líquido se coloca a la TNA de cada alternativa durante los ${scenario.plazo} días del cheque, se compara contra cobrar el nominal al vencimiento.`;
  }
  const rows = [];
  const caucion = typeof pickClosestByDays === 'function'
    ? pickClosestByDays(scenario.plazo, chequeCaucionQuotes())
    : null;
  const caucionViva = caucion && caucion.fuente !== 'config';
  rows.push(renderWaitAlternative({
    title: 'Caución',
    pick: caucion,
    quote,
    plazo: scenario.plazo,
    nominal: scenario.monto,
    sourceLine: !caucion
      ? 'Sin caución cargada.'
      : (caucionViva
        ? `BYMA · plazo ${caucion.days} días · TNA ${formatPercentPoints(caucion.tna)}${caucion.days !== scenario.plazo ? '. No hay caución al plazo exacto: se usa esta TNA sobre los días del cheque.' : '.'}`
        : `Respaldo cargado, balde de ${caucion.days} días, TNA ${formatPercentPoints(caucion.tna)}. BYMA no trajo una curva en esta carga${caucion.days !== scenario.plazo ? '. No coincide con el plazo del cheque: se usa esta TNA sobre esos días.' : '.'}`)
  }));

  const pfRef = macroPlazoFijoRef(scenario.monto, scenario.plazo);
  const pfTna = pfRef.tna;
  const pfStale = !pfRef.live;
  rows.push(renderWaitAlternative({
    title: 'Plazo fijo',
    pick: pfTna == null ? null : { days: 30, tna: pfTna, stale: pfStale },
    quote,
    plazo: scenario.plazo,
    nominal: scenario.monto,
    sourceLine: `${pfRef.label}. Tramo por monto, aplicado al plazo del cheque.`
  }));

  const lecaps = (ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.chequeLecaps) || null;
  const letters = (lecaps && lecaps.letters) || [];
  const letter = typeof pickClosestByDays === 'function' ? pickClosestByDays(scenario.plazo, letters) : null;
  const flujo = (lecaps && lecaps.flujoNota) || 'Los pagos finales no están confirmados con la Secretaría de Finanzas.';
  const lecapStatus = !lecaps
    ? 'Sin letras cargadas.'
    : (lecaps.status === 'data912'
      ? 'Precio Data912. El pago final sigue sin confirmación oficial.'
      : (lecaps.status === 'mixto'
        ? `Data912 no trajo precio para todas. Las que faltan quedan con la foto del ${formatIsoDateAr(lecaps.asOf || '2026-10-28')}.`
        : `Data912 no respondió. Último valor cargado${lecaps.asOf ? ' el ' + formatIsoDateAr(lecaps.asOf) : ''}.`));
  rows.push(renderWaitAlternative({
    title: letter ? `LECAP/Boncap ${letter.ticker}` : 'LECAP/Boncap',
    pick: letter,
    quote,
    plazo: scenario.plazo,
    nominal: scenario.monto,
    sourceLine: letter
      ? `${letter.ticker} · ${letter.days} días · TNA ${formatPercentPoints(letter.tna)} · TEA ${formatPercentPoints(letter.tea)}${letter.stale ? ' · foto' : ''}. ${letter.days !== scenario.plazo ? 'No vence en el plazo del cheque: la comparación de pesos usa su TNA sobre esos días. ' : ''}${flujo} ${lecapStatus}`
      : lecapStatus
  }));

  const curve = letters.map((row) => {
    const mark = letter && row.ticker === letter.ticker ? ' text-fuchsia-200' : '';
    return `<span class="inline-block mr-2${mark}">${escapeHtml(row.ticker)} ${formatPercentPoints(row.tna)}/${formatPercentPoints(row.tea)}${row.stale ? '*' : ''}</span>`;
  }).join('');
  if (curve) {
    const staleNote = letters.some((row) => row.stale) ? '* foto del último valor cargado. ' : '';
    rows.push(`<p class="text-[10px] leading-relaxed text-slate-500">Curva TNA/TEA: ${curve}<span class="block mt-1">${staleNote}${escapeHtml(flujo)}</span></p>`);
  }
  body.innerHTML = rows.join('');
}

function renderWaitAlternative(spec) {
  const pick = spec.pick;
  const verdict = typeof waitVerdict === 'function'
    ? waitVerdict(spec.quote && spec.quote.tnaCosto, pick && pick.tna, spec.title)
    : { kind: 'sin_dato', texto: 'Sin comparación.', diff: null };
  const tone = verdict.kind === 'mas_caro'
    ? 'text-amber-200'
    : (verdict.kind === 'mas_barato' ? 'text-emerald-300' : 'text-slate-300');
  let pesos = '';
  if (pick && typeof sameTermPlacement === 'function' && spec.quote && spec.quote.liquido > 0) {
    const placed = sameTermPlacement(spec.quote.liquido, spec.nominal, spec.plazo, pick.tna);
    if (placed) {
      const gap = placed.diferencia;
      const tail = gap > 0.5
        ? `Esperar el cheque deja ${formatMoneyARS(gap)} más.`
        : (gap < -0.5
          ? `Descontar y colocar deja ${formatMoneyARS(Math.abs(gap))} más que esperar el cheque.`
          : 'Al vencimiento del cheque las dos vías quedan parejas.');
      pesos = `<p class="text-[11px] text-slate-400 mt-1">Colocar el líquido a esa TNA llega a ${formatMoneyARS(placed.colocado)}. El cheque paga ${formatMoneyARS(spec.nominal)}. ${tail}</p>`;
    }
  }
  const diff = verdict.diff == null
    ? ''
    : ` · ${verdict.diff > 0 ? '+' : ''}${verdict.diff.toFixed(2).replace('.', ',')} puntos de TNA`;
  return `<article class="rounded-xl border border-slate-800 px-3 py-2">
    <p class="text-[11px] font-semibold ${tone}">${escapeHtml(verdict.texto)}${diff}</p>
    <p class="text-[10px] leading-relaxed text-slate-500 mt-1">${escapeHtml(spec.sourceLine || '')}</p>
    ${pesos}
  </article>`;
}

function chequeMoneyRow(label, amount, strong) {
  return `<div class="flex items-baseline justify-between gap-3">
    <span class="${strong ? 'text-slate-200 font-semibold' : 'text-slate-400'}">${label}</span>
    <span class="font-mono ${strong ? 'font-bold text-white' : 'text-slate-200'} text-right">${formatMoneyARS(amount)}</span>
  </div>`;
}

function chequePctRow(label, ratio) {
  return `<div class="flex items-baseline justify-between gap-3">
    <span class="text-slate-400">${label}</span>
    <span class="font-mono text-slate-200 text-right">${formatRatioPct(ratio)}</span>
  </div>`;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatPercentPoints(points) {
  const n = Number(points);
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  let digits = 2;
  if (abs > 0 && abs < 0.1) digits = 3;
  if (abs > 0 && abs < 0.01) digits = 4;
  let text = n.toFixed(digits);
  if (digits > 2) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text.replace('.', ',') + '%';
}

function formatRatioPct(ratio) {
  if (ratio == null || !isFinite(ratio)) return '—';
  return (ratio * 100).toFixed(2).replace('.', ',') + '%';
}

function formatMoneyARS(num) {
  if (num == null || !isFinite(num)) return '—';
  const negative = num < -0.004;
  const abs = Math.abs(num);
  const parts = abs.toFixed(2).split('.');
  const withDots = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negative ? '-$' : '$') + withDots + ',' + parts[1];
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Letra que se está mirando: la elegida (modo por letra) o la que corresponde al plazo.
// Tarjeta, insignias y modal usan esta, no la "referencia" del API (que puede ser otra letra).
function activeLecapLetter() {
  const rates = ZETA_CONFIG.marketRates || {};
  let letter = null;
  try { letter = currentLecapPick().letter; } catch (e) { letter = null; }
  if (letter && isFinite(Number(letter.tna))) {
    return { ticker: letter.ticker, vencimiento: letter.vencimiento || '', tna: Number(letter.tna), dias: letter.diasHoy };
  }
  const details = rates.lecapDetails || {};
  return { ticker: details.ticker || 'S30N6', vencimiento: details.vencimiento || '', tna: Number(rates.lecapTNA), dias: letraDaysFromConfig() };
}

function letraDaysFromConfig() {
  const details = ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.lecapDetails;
  if (details && typeof tradableLecaps === 'function') {
    const menu = tradableLecaps([details], new Date());
    if (menu.length) return menu[0].diasHoy;
  }
  const days = Number(details && details.diasAlVencimiento);
  if (isFinite(days) && days >= 1) return Math.round(days);
  return 35;
}

function currentLecapPick() {
  const source = (ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.lecaps) || [];
  const configured = Number(ZETA_CONFIG.macroVsLetra && ZETA_CONFIG.macroVsLetra.maxGapDays);
  const maxGapDays = isFinite(configured) && configured >= 0 ? configured : undefined;
  if (typeof resolveLecapHorizon === 'function') {
    return resolveLecapHorizon(source, {
      mode: lecapMode,
      ticker: lecapMode === 'letra' ? (selectedLecapTicker || manualLecapTicker) : manualLecapTicker,
      plazoDays: currentPlazo,
      today: new Date(),
      maxGapDays
    });
  }
  if (typeof pickLecapForPlazo !== 'function') {
    return {
      mode: lecapMode,
      menu: [],
      letter: null,
      fit: false,
      manual: false,
      plazo: currentPlazo,
      gapDays: null,
      absGap: null,
      maxGapDays: 15,
      criterion: '',
      today: ''
    };
  }
  const pick = pickLecapForPlazo(source, currentPlazo, {
    today: new Date(),
    maxGapDays,
    ticker: manualLecapTicker
  });
  pick.mode = 'plazo';
  return pick;
}

function shortVencimiento(value) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (iso) return iso[3] + '/' + iso[2];
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || '');
  if (dmy) return dmy[1] + '/' + dmy[2];
  return value || '';
}

function gapPhrase(letter, plazo) {
  const diff = letter.diasHoy - plazo;
  if (diff === 0) return 'vence en el plazo pedido';
  if (diff < 0) return Math.abs(diff) + ' días antes del plazo pedido';
  return diff + ' días después del plazo pedido';
}

function formatLetraElegida(pick) {
  if (!pick.letter) return 'No hay una letra vigente.';
  const vto = shortVencimiento(pick.letter.vencimiento || pick.letter.maturity);
  if (pick.mode === 'letra') {
    return `Modo por letra: ${pick.letter.ticker}, vence ${vto}, ${pick.letter.diasHoy} días`;
  }
  const modo = pick.manual ? 'Letra elegida a mano' : 'Letra elegida';
  return `Modo por plazo. ${modo}: ${pick.letter.ticker}, vence ${vto}, ${pick.letter.diasHoy} días`;
}

function formatLetraWarning(pick) {
  if (pick.mode === 'letra') return '';
  if (!pick.letter) {
    return 'No quedó ninguna letra vigente. Las ya vencidas se descartan.';
  }
  const vto = shortVencimiento(pick.letter.vencimiento || pick.letter.maturity);
  const cuanto = gapPhrase(pick.letter, pick.plazo);
  if (pick.manual && !pick.fit) {
    return `La elegiste a mano: ${pick.letter.ticker} vence ${vto}, ${pick.letter.diasHoy} días, ${cuanto}. La cuenta usa ese vencimiento, no los ${pick.plazo} días tipeados.`;
  }
  if (pick.fit) return '';
  return `Ninguna letra calza con ${pick.plazo} días (la tolerancia es ${pick.maxGapDays}). La más cercana es ${pick.letter.ticker}: vence ${vto}, ${pick.letter.diasHoy} días, ${cuanto}. No se la compara como si fuera un plazo de ${pick.plazo} días. Elegila y el plazo pasa a ser ese vencimiento.`;
}

let syncingLecapHorizon = false;

function selectLecapLetra(ticker) {
  lecapMode = 'letra';
  selectedLecapTicker = String(ticker || '').toUpperCase();
  manualLecapTicker = null;
  letraTnaDirty = false;
  macroPlazoFollowsVto = false;
  const horizon = currentLecapPick();
  if (!horizon.letter) {
    calculateYield();
    return;
  }
  selectedLecapTicker = horizon.letter.ticker;
  if (selectedInstrument === 'lecap') activeTNA = Number(horizon.letter.tna);
  syncingLecapHorizon = true;
  setPlazo(horizon.plazo);
  syncingLecapHorizon = false;
}

function selectMacroLetra(ticker) {
  selectLecapLetra(ticker);
}

function setLecapMode(mode) {
  if (mode === 'plazo') {
    lecapMode = 'plazo';
    selectedLecapTicker = null;
    manualLecapTicker = null;
    macroPlazoFollowsVto = false;
    const input = document.getElementById('input-plazo-macro');
    if (input) {
      input.readOnly = false;
      input.focus();
    }
    calculateYield();
    return;
  }
  selectLecapLetra(selectedLecapTicker);
}

function clearMacroLetraManual() {
  manualLecapTicker = null;
  letraTnaDirty = false;
  if (lecapMode === 'letra') setLecapMode('letra');
  else calculateYield();
}

function syncLecapHorizonUI(pick) {
  const horizon = pick || currentLecapPick();
  const porLetra = horizon.mode !== 'plazo';
  const input = document.getElementById('input-plazo-macro');
  const macroLabel = document.getElementById('label-plazo-macro');
  if (input) input.readOnly = porLetra;
  if (macroLabel) macroLabel.textContent = porLetra ? 'Días hasta el vencimiento' : 'Plazo libre (días)';
  const slider = document.getElementById('slider-plazo');
  const lockSlider = porLetra && (isMacroLetraMode() || selectedInstrument === 'lecap');
  if (slider) slider.disabled = lockSlider;
  const letraBtn = document.getElementById('btn-mode-letra');
  const plazoBtn = document.getElementById('btn-mode-plazo');
  const on = 'px-3 py-1.5 rounded-lg text-xs font-semibold border border-sky-500 bg-sky-500/15 text-sky-100';
  const off = 'px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-300';
  if (letraBtn) letraBtn.className = porLetra ? on : off;
  if (plazoBtn) plazoBtn.className = porLetra ? off : on;
  const note = document.getElementById('lecap-horizon-note');
  if (note) {
    if (!horizon.letter) {
      note.textContent = 'No hay letras vigentes.';
    } else if (porLetra) {
      note.textContent = `Modo por letra. El plazo es el vencimiento de ${horizon.letter.ticker}: ${horizon.letter.diasHoy} días.`;
    } else if (horizon.fit) {
      note.textContent = `Modo por plazo. ${horizon.letter.ticker} calza con ${horizon.plazo} días (vence en ${horizon.letter.diasHoy}).`;
    } else {
      note.textContent = `Modo por plazo. ${horizon.letter.ticker} no calza: vence en ${horizon.letter.diasHoy} días, a ${horizon.absGap} del plazo pedido.`;
    }
  }
  const plazoLabel = document.getElementById('label-plazo');
  if (plazoLabel && (isMacroLetraMode() || selectedInstrument === 'lecap')) {
    plazoLabel.textContent = porLetra ? 'Días hasta el vencimiento de la letra' : 'Plazo libre (días)';
  }
  const chips = document.getElementById('lecap-letter-chips');
  if (!chips) return;
  chips.innerHTML = (horizon.menu || []).map((letter) => {
    const active = horizon.letter && letter.ticker === horizon.letter.ticker;
    const vto = shortVencimiento(letter.vencimiento || letter.maturity);
    const cls = active
      ? 'border-sky-500 bg-sky-500/15 text-white'
      : 'border-slate-700 bg-slate-900 text-slate-300';
    return `<button type="button" data-letra="${escapeHtml(letter.ticker)}" onclick="selectLecapLetra('${escapeHtml(letter.ticker)}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border ${cls}">${escapeHtml(letter.ticker)} · ${escapeHtml(vto)} · ${letter.diasHoy}d</button>`;
  }).join('');
}

// Plazo fijo de referencia: Banco Macro según monto (y plazo, mínimo 30 días).
// En vivo vía ArgentinaDatos (tramos BCRA de Macro); si no, los tramos de config.js.
function macroPlazoFijoRef(monto, dias) {
  const live = Array.isArray(liveMacroBands) && liveMacroBands.length > 0;
  const plazo = Math.max(30, Number(dias) || 30);
  const band = typeof pickMacroBand === 'function' ? pickMacroBand(getMacroBands(), Number(monto) || 1, plazo) : null;
  const tna = band ? Number(band.tna) : Number(ZETA_CONFIG.marketRates.plazoFijoTNA);
  const cfg = ZETA_CONFIG.macroVsLetra || {};
  let when = '';
  if (live && liveMacroBandsAt) {
    const d = new Date(liveMacroBandsAt);
    if (!isNaN(d.getTime())) when = d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' });
  }
  const label = live
    ? `Banco Macro · ArgentinaDatos${when ? ' ' + when : ''}`
    : `Banco Macro · referencia al ${shortVencimiento(cfg.verificadoAl || '')}`;
  return { tna, live, label };
}

function getMacroBands() {
  if (Array.isArray(liveMacroBands) && liveMacroBands.length) return liveMacroBands;
  const cfg = ZETA_CONFIG.macroVsLetra;
  return (cfg && cfg.bands) || [];
}

function getMacroLetraConfig() {
  const cfg = (typeof ZETA_CONFIG !== 'undefined' && ZETA_CONFIG.macroVsLetra) || {};
  const costs = getBrokerCosts();
  return {
    bankLabel: cfg.bankLabel || 'Banco Macro',
    minDias: numberOr(cfg.minDias, 30),
    letra: {
      brokerLabel: costs.label,
      comisionPct: costs.lecap.comisionPct,
      aplicaIva: costs.lecap.aplicaIva,
      iva: costs.iva,
      derechosPct: costs.lecap.derechosPct
    }
  };
}

function initMacroLetraControls() {
  const cfg = getMacroLetraConfig();
  const label = document.getElementById('macro-bank-label');
  const tnaBank = document.getElementById('macro-tna-bank');
  const tnaLetra = document.getElementById('macro-tna-letra');
  const comision = document.getElementById('macro-comision');
  const derechos = document.getElementById('macro-derechos');
  const iva = document.getElementById('macro-aplica-iva');
  const ivaLabel = document.getElementById('macro-iva-label');
  const plazo = document.getElementById('input-plazo-macro');
  if (label) {
    label.value = cfg.bankLabel;
    label.placeholder = cfg.bankLabel;
  }
  if (tnaLetra) tnaLetra.value = String(ZETA_CONFIG.marketRates.lecapTNA);
  if (comision) comision.value = String(cfg.letra.comisionPct);
  if (derechos) derechos.value = String(cfg.letra.derechosPct);
  if (iva) iva.checked = cfg.letra.aplicaIva;
  if (ivaLabel) ivaLabel.textContent = formatPercentPoints(cfg.letra.iva * 100).replace(',00%', '%');
  if (plazo) plazo.value = String(macroLetraPlazoDays);
  const band = pickMacroBand(getMacroBands(), currentCapital, macroLetraPlazoDays);
  if (tnaBank) tnaBank.value = String(band ? band.tna : 19.5);
  refreshMacroVtoPill();
}

function refreshMacroVtoPill() {
  const days = letraDaysFromConfig();
  const btn = document.getElementById('macro-pill-vto');
  if (!btn) return;
  btn.setAttribute('data-days', String(days));
  const label = btn.querySelector('[data-vto-label]');
  const sub = btn.querySelector('[data-vto-sub]');
  if (label) label.textContent = days + 'd';
  if (sub) sub.textContent = 'Referencia';
}

function readSignedNumber(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const raw = String(el.value).trim().replace(',', '.');
  if (raw === '' || raw === '-' || raw === '+') return fallback;
  const n = parseFloat(raw);
  return isFinite(n) ? n : fallback;
}

function formatCompactArs(amount, edge) {
  const n = Number(amount);
  if (!isFinite(n)) return '';
  if (Math.abs(n) >= 1000000) {
    const millions = n / 1000000;
    const nextMillion = Math.ceil(millions) * 1000000;
    if (edge === 'max' && n < nextMillion && nextMillion - n < 100) {
      return 'menos de $' + Math.ceil(millions) + ' M';
    }
    const rounded = Math.round(millions * 10) / 10;
    const text = rounded % 1 === 0 ? String(rounded.toFixed(0)) : String(rounded).replace('.', ',');
    return '$' + text + ' M';
  }
  return formatMoneyARS(n);
}

function describeMacroBand(band) {
  if (!band) return '';
  const plazo = band.plazoMax != null
    ? band.plazoMin + '–' + band.plazoMax + ' días'
    : 'desde ' + band.plazoMin + ' días';
  let money = '';
  if (band.montoMax != null && (band.montoMin == null || band.montoMin <= 1)) {
    money = formatCompactArs(band.montoMax, 'max');
  } else if (band.montoMin != null && band.montoMax == null) {
    money = 'desde ' + formatCompactArs(band.montoMin, 'min');
  } else if (band.montoMin != null && band.montoMax != null) {
    money = 'desde ' + formatCompactArs(band.montoMin, 'min') + ' hasta ' + formatCompactArs(band.montoMax, 'max');
  }
  return money ? plazo + ' · ' + money : plazo;
}

function syncMacroReferenceInputs(bankDays, letter) {
  const cfg = getMacroLetraConfig();
  const marketTna = letter ? Number(letter.tna) : Number(ZETA_CONFIG.marketRates.lecapTNA);
  if (!letraTnaDirty) {
    const input = document.getElementById('macro-tna-letra');
    if (input && isFinite(marketTna)) input.value = String(marketTna);
  }
  const band = (bankDays >= cfg.minDias)
    ? pickMacroBand(getMacroBands(), currentCapital, bankDays)
    : null;
  if (!macroTnaDirty && band) {
    const input = document.getElementById('macro-tna-bank');
    if (input) input.value = String(band.tna);
  }
  return band;
}

function getMacroLetraScenario() {
  const cfg = getMacroLetraConfig();
  const labelInput = document.getElementById('macro-bank-label');
  const typedLabel = labelInput ? labelInput.value.trim() : '';
  const bankLabel = typedLabel || cfg.bankLabel;
  const pick = currentLecapPick();
  const chosen = pick.letter;
  const comparable = pick.mode === 'letra' ? !!chosen : !!(chosen && (pick.fit || pick.manual));
  const letraDays = chosen ? chosen.diasHoy : 0;
  const bankDays = comparable ? letraDays : currentPlazo;
  const band = syncMacroReferenceInputs(bankDays, chosen);
  const marketTna = chosen ? Number(chosen.tna) : Number(ZETA_CONFIG.marketRates.lecapTNA);
  const grossTna = letraTnaDirty ? readSignedNumber('macro-tna-letra', marketTna) : marketTna;
  const fees = getLecapFees();
  const letra = chosen
    ? withBankTax(calcLetraNeta(currentCapital, letraDays, grossTna, fees), getBankTax())
    : { total: null, tnaBruta: null, tnaNeta: null, interes: null, impuesto: null, impuestoExento: true, quedaEnBroker: false, comisionPct: fees.comisionPct, derechosPct: fees.derechosPct };
  const fci = withBankTax(calcFciSimple(currentCapital, bankDays, Number(ZETA_CONFIG.marketRates.fciTNA)), getBankTax());
  const ticker = chosen ? chosen.ticker : 'LECAP';
  const vtoDays = letraDays;

  let bank = null;
  let bankReason = null;
  const bankHorizon = comparable ? bankDays : currentPlazo;
  if (bankHorizon < cfg.minDias) {
    bankReason = 'min';
  } else if (!macroTnaDirty && !band) {
    bankReason = 'sin-tramo';
  } else {
    const tna = macroTnaDirty
      ? readOptionalNumber('macro-tna-bank', band ? band.tna : 0)
      : band.tna;
    bank = calcPlazoFijoSimple(currentCapital, bankDays, tna);
    if (bank.total == null) bankReason = 'sin-tramo';
  }

  const contenders = [];
  if (comparable && letra.total != null) contenders.push({ id: 'letra', total: letra.total, label: ticker });
  if (fci.total != null) contenders.push({ id: 'fci', total: fci.total, label: 'FCI liquidez' });
  if (bank && bank.total != null) contenders.push({ id: 'banco', total: bank.total, label: bankLabel });
  contenders.sort((a, b) => b.total - a.total);

  let winner = null;
  let conviene = 'No comparable';
  if (contenders.length >= 2 && Math.abs(contenders[0].total - contenders[1].total) < 0.5) {
    winner = 'empate';
    conviene = 'Empate';
  } else if (contenders.length) {
    winner = contenders[0].id;
    conviene = contenders[0].label;
  } else if (bankReason === 'min') {
    conviene = 'PF no disponible';
  } else if (bankReason === 'sin-tramo') {
    conviene = 'Falta TNA Macro';
  }

  return {
    bankLabel,
    brokerLabel: cfg.letra.brokerLabel,
    ticker,
    vtoDays,
    band,
    bankReason,
    bank,
    letra,
    fci,
    contenders,
    fees,
    winner,
    conviene,
    monto: currentCapital,
    plazo: currentPlazo,
    bankDays,
    minDias: cfg.minDias,
    pick,
    comparable,
    warning: formatLetraWarning(pick)
  };
}

function renderMacroLetraExperience() {
  const scenario = getMacroLetraScenario();
  const grid = document.getElementById('macro-comparison-grid');
  if (grid) {
    grid.innerHTML = [
      renderMacroBankCard(scenario),
      renderMacroLetraCard(scenario),
      renderMacroFciCard(scenario)
    ].join('');
  }
  const breakeven = document.getElementById('macro-breakeven');
  if (breakeven) breakeven.textContent = macroBreakEvenText(scenario);

  renderMacroLetraMenu(scenario);
  syncLecapHorizonUI(scenario.pick);

  const note = document.getElementById('macro-comparison-note');
  if (note) {
    if (!scenario.pick.letter) {
      note.textContent = 'Sin letra vigente para comparar.';
    } else if (scenario.comparable) {
      const same = scenario.plazo === scenario.vtoDays;
      note.textContent = same
        ? `Se compara a ${scenario.vtoDays} días, el vencimiento de ${scenario.ticker}.`
        : `Pediste ${scenario.plazo} días. Se compara a ${scenario.vtoDays} días, el vencimiento de ${scenario.ticker}.`;
    } else {
      note.textContent = `Pediste ${scenario.plazo} días. La letra no entra en la comparación.`;
    }
  }

  const bandHint = document.getElementById('macro-band-hint');
  if (bandHint) {
    if (scenario.bankReason === 'min') {
      bandHint.textContent = `El plazo fijo pide al menos ${scenario.minDias} días.`;
    } else if (scenario.band) {
      const using = scenario.bank ? formatPercentPoints(scenario.bank.tna) : '';
      const ref = `Referencia ${formatPercentPoints(scenario.band.tna)} · ${describeMacroBand(scenario.band)}`;
      bandHint.textContent = macroTnaDirty && scenario.bank
        ? `${ref}. En esta reunión: ${using}.`
        : ref;
    } else if (macroTnaDirty) {
      bandHint.textContent = 'Sin tramo publicado para este plazo y monto. Usando la TNA de la reunión.';
    } else {
      bandHint.textContent = 'Macro no publica TNA para este plazo y monto. Cargala para esta reunión.';
    }
  }

  const letraHint = document.getElementById('macro-letra-hint');
  if (letraHint) {
    const market = scenario.pick.letter ? Number(scenario.pick.letter.tna) : Number(ZETA_CONFIG.marketRates.lecapTNA);
    letraHint.textContent = letraTnaDirty
      ? `TNA de mercado de ${scenario.ticker}: ${formatPercentPoints(market)}. En esta reunión: ${formatPercentPoints(scenario.letra.tnaBruta)}.`
      : `TNA bruta de ${scenario.ticker}: ${formatPercentPoints(market)}.`;
  }

  const top = scenario.contenders && scenario.contenders[0];
  const bankTotal = scenario.bank && scenario.bank.total;
  const activeBadge = document.getElementById('active-instrument-badge');
  if (activeBadge && scenario.ticker) activeBadge.textContent = `Macro vs ${scenario.ticker}`;
  const macroBadge = document.getElementById('macro-letra-badge');
  if (macroBadge && scenario.letra && scenario.letra.tnaNeta != null) {
    macroBadge.textContent = `${formatLecapTna(scenario.letra.tnaNeta)}%`;
  }
  if (!scenario.comparable && scenario.warning) {
    setText('macro-hero-kicker', 'Sin letra que calce');
    setText('macro-hero-delta', scenario.pick.letter ? (scenario.pick.absGap + ' días') : '—');
    setText('macro-hero-subtitle', scenario.warning);
    setText('macro-winner-badge', 'Plazo sin letra');
  } else if (scenario.bankReason === 'min') {
    setText('macro-hero-kicker', top ? `A recibir con ${top.label}` : 'A recibir');
    setText('macro-hero-delta', top ? formatMoneyARS(top.total) : '—');
    setText('macro-hero-subtitle', `Plazo fijo no disponible bajo ${scenario.minDias} días. La letra y el FCI sí se pueden colocar.`);
    setText('macro-winner-badge', top ? top.label : 'PF no disponible');
  } else if (scenario.bankReason === 'sin-tramo' && !(scenario.bank && scenario.bank.total != null)) {
    setText('macro-hero-kicker', 'A recibir con la letra');
    setText('macro-hero-delta', formatMoneyARS(scenario.letra.total));
    setText('macro-hero-subtitle', 'Cargá la TNA de Macro para comparar. Mientras tanto, el total de la letra.');
    setText('macro-winner-badge', 'Falta TNA Macro');
  } else if (scenario.winner === 'empate') {
    setText('macro-hero-kicker', 'Diferencia a cobrar');
    setText('macro-hero-delta', formatMoneyARS(0));
    setText('macro-hero-subtitle', 'Hay dos alternativas que dejan el mismo monto.');
    setText('macro-winner-badge', 'Empate');
  } else if (top && bankTotal != null && top.id !== 'banco') {
    setText('macro-hero-kicker', 'Diferencia a cobrar');
    setText('macro-hero-delta', '+' + formatMoneyARS(top.total - bankTotal));
    setText('macro-hero-subtitle', `${top.label} deja más que ${scenario.bankLabel}.`);
    setText('macro-winner-badge', `Conviene ${top.label}`);
  } else if (top && bankTotal != null) {
    const other = scenario.contenders.find((item) => item.id !== 'banco');
    const gap = other ? bankTotal - other.total : 0;
    setText('macro-hero-kicker', 'Diferencia a cobrar');
    setText('macro-hero-delta', '+' + formatMoneyARS(Math.abs(gap)));
    setText('macro-hero-subtitle', `${scenario.bankLabel} deja más.`);
    setText('macro-winner-badge', `Conviene ${scenario.bankLabel}`);
  } else {
    setText('macro-hero-delta', '—');
    setText('macro-hero-subtitle', 'Completá capital, días y tasas.');
    setText('macro-winner-badge', 'No comparable');
  }

  setText('macro-hero-capital', formatMoneyARS(scenario.monto));
  setText('macro-hero-letra-label', `Recibe con ${scenario.ticker}`);
  setText('macro-hero-letra', formatMoneyARS(scenario.letra.total));
  setText('macro-hero-bank-label', `Recibe con ${scenario.bankLabel}`);
  setText('macro-hero-bank', scenario.bank && scenario.bank.total != null ? formatMoneyARS(scenario.bank.total) : 'N/A');
  setText('macro-hero-tna-neta', scenario.letra.tnaNeta == null
    ? '—'
    : formatPercentPoints(scenario.letra.tnaNeta) + ' neta · ' + formatPercentPoints(scenario.letra.tnaBruta) + ' bruta');

  setText('modal-instrumento', `Macro vs ${scenario.ticker}`);
  setText('modal-capital-plazo', `${formatMoneyARS(scenario.monto)} • ${scenario.plazo}d`);
  setText('modal-ganancia-label', 'Conviene');
  setText('modal-ganancia', scenario.conviene);
}

function renderMacroBankCard(scenario) {
  const won = scenario.winner === 'banco';
  const quote = scenario.bank;
  const border = won ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-950/40';
  const badge = won
    ? '<span class="shrink-0 text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">Conviene</span>'
    : '';
  const na = !quote || quote.total == null;
  const horizon = scenario.bankDays || scenario.plazo;
  const note = scenario.bankReason === 'min'
    ? `No se constituye a menos de ${scenario.minDias} días.`
    : (scenario.bankReason === 'sin-tramo' ? 'Sin TNA publicada para este plazo y monto.' : `Interés simple a ${horizon} días. En el mismo banco no paga débitos y créditos.`);

  return `
    <article class="min-w-0 rounded-2xl border p-4 ${border}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Plazo fijo</p>
          <h5 class="font-bold text-white text-sm leading-snug">${escapeHtml(scenario.bankLabel)}</h5>
          <p class="text-[11px] text-slate-400 mt-0.5">${na ? 'TNA no aplicable' : 'TNA ' + formatPercentPoints(quote.tna)}</p>
        </div>
        ${badge}
      </div>
      <div class="space-y-1.5 text-xs">
        ${chequeMoneyRow('Interés', na ? null : quote.interes)}
      </div>
      <div class="mt-3 rounded-xl ${won ? 'bg-emerald-500/15' : 'bg-slate-800/80'} px-3 py-2.5 flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wide ${won ? 'text-emerald-200' : 'text-slate-300'}">A recibir</span>
        <span class="font-mono font-bold ${won ? 'text-emerald-300' : 'text-white'} text-sm text-right">${na ? 'N/A' : formatMoneyARS(quote.total)}</span>
      </div>
      <p class="mt-3 text-[10px] text-slate-500 leading-relaxed">${escapeHtml(note)}</p>
    </article>
  `;
}

function renderMacroLetraMenu(scenario) {
  const criterion = document.getElementById('macro-letra-criterion');
  const chosen = document.getElementById('macro-letra-elegida');
  const warning = document.getElementById('macro-letra-warning');
  const list = document.getElementById('macro-letras-list');
  const pick = scenario.pick;
  if (criterion) criterion.textContent = pick.criterion || '';
  if (chosen) chosen.textContent = formatLetraElegida(pick);
  if (warning) {
    const text = scenario.warning || '';
    warning.textContent = text;
    warning.classList.toggle('hidden', !text);
  }
  if (!list) return;
  const menu = pick.menu || [];
  if (!menu.length) {
    list.innerHTML = '';
    return;
  }
  const fees = scenario.fees;
  const rows = menu.map((letter) => {
    const net = calcLetraNeta(currentCapital, letter.diasHoy, letter.tna, fees);
    const selected = pick.letter && letter.ticker === pick.letter.ticker;
    const vto = shortVencimiento(letter.vencimiento || letter.maturity);
    return `<tr class="${selected ? 'bg-sky-500/10' : ''}">
      <td class="py-1.5 pr-3 font-mono font-bold text-white">${escapeHtml(letter.ticker)}</td>
      <td class="py-1.5 pr-3 text-slate-300">${escapeHtml(vto)}</td>
      <td class="py-1.5 pr-3 font-mono text-slate-200">${letter.diasHoy}</td>
      <td class="py-1.5 pr-3 font-mono text-slate-200">${formatPercentPoints(letter.tna)}</td>
      <td class="py-1.5 pr-3 font-mono text-slate-200">${formatPercentPoints(net.tnaNeta)}</td>
      <td class="py-1.5 text-right">
        <button type="button" data-letra="${escapeHtml(letter.ticker)}" onclick="selectMacroLetra('${escapeHtml(letter.ticker)}')" class="text-[10px] font-semibold ${selected ? 'text-sky-300' : 'text-slate-400 hover:text-white'}">
          ${selected ? (pick.mode === 'letra' ? 'Elegida' : 'Más cercana') : 'Elegir'}
        </button>
      </td>
    </tr>`;
  }).join('');
  const manual = pick.manual
    ? '<button type="button" onclick="clearMacroLetraManual()" class="mt-2 text-[10px] font-semibold text-sky-400 hover:text-sky-300">Volver a la automática</button>'
    : '';
  list.innerHTML = `<div class="overflow-x-auto">
    <table class="w-full text-[11px] text-left">
      <thead>
        <tr class="text-[10px] uppercase tracking-wide text-slate-500">
          <th class="py-1 pr-3 font-semibold">Letra</th>
          <th class="py-1 pr-3 font-semibold">Vence</th>
          <th class="py-1 pr-3 font-semibold">Días</th>
          <th class="py-1 pr-3 font-semibold">TNA bruta</th>
          <th class="py-1 pr-3 font-semibold">TNA neta</th>
          <th class="py-1 font-semibold text-right"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>${manual}`;
}

function renderMacroLetraCard(scenario) {
  const won = scenario.comparable && scenario.winner === 'letra' && scenario.bank && scenario.bank.total != null;
  const quote = scenario.letra;
  const border = won ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-950/40';
  const badge = won
    ? '<span class="shrink-0 text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">Conviene</span>'
    : '';
  const ivaTxt = scenario.fees.aplicaIva ? 'con IVA' : 'sin IVA';
  const taxTxt = quote.impuestoExento
    ? 'Débitos y créditos $0 (mismo titular).'
    : `Débitos y créditos ${formatMoneyARS(quote.impuesto)}${quote.quedaEnBroker ? ', sin vuelta al banco' : ''}.`;
  const costTxt = `Comisión ${formatPercentPoints(quote.comisionPct)} ${ivaTxt} · Derechos ${formatPercentPoints(quote.derechosPct)}. ${taxTxt}`;

  return `
    <article class="min-w-0 rounded-2xl border p-4 ${border}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">${scenario.comparable ? 'Letra elegida' : 'Letra más cercana'}</p>
          <h5 class="font-bold text-white text-sm leading-snug">${escapeHtml(scenario.ticker)}${scenario.vtoDays ? ' · ' + scenario.vtoDays + ' días' : ''}</h5>
          <p class="text-[11px] text-slate-400 mt-0.5">TNA bruta ${formatPercentPoints(quote.tnaBruta)} · neta ${formatPercentPoints(quote.tnaNeta)}</p>
        </div>
        ${badge}
      </div>
      <div class="space-y-1.5 text-xs">
        ${chequePctPointsRow('TNA bruta', quote.tnaBruta)}
        ${chequePctPointsRow('TNA neta', quote.tnaNeta)}
        ${chequeMoneyRow('Interés neto', quote.interes)}
      </div>
      <div class="mt-3 rounded-xl ${won ? 'bg-emerald-500/15' : 'bg-slate-800/80'} px-3 py-2.5 flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wide ${won ? 'text-emerald-200' : 'text-slate-300'}">A recibir</span>
        <span class="font-mono font-bold ${won ? 'text-emerald-300' : 'text-white'} text-sm text-right">${formatMoneyARS(quote.total)}</span>
      </div>
      <p class="mt-3 text-[10px] text-slate-500 leading-relaxed">${escapeHtml(costTxt)} ${escapeHtml(scenario.brokerLabel)}, compra al vencimiento, sin venta. Sin membresía.</p>
    </article>
  `;
}

function renderMacroFciCard(scenario) {
  const won = scenario.winner === 'fci';
  const quote = scenario.fci || {};
  const border = won ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-950/40';
  const badge = won
    ? '<span class="shrink-0 text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">Conviene</span>'
    : '';
  const details = (ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.fciDetails) || {};
  const source = details.fuente === 'cnv' ? 'CNV' : 'config';
  const taxTxt = quote.impuestoExento
    ? 'Débitos y créditos $0.'
    : `Débitos y créditos ${formatMoneyARS(quote.impuesto)}${quote.quedaEnBroker ? ', sin vuelta al banco' : ''}.`;

  return `
    <article class="min-w-0 rounded-2xl border p-4 ${border}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">FCI liquidez</p>
          <h5 class="font-bold text-white text-sm leading-snug">Money market T+0</h5>
          <p class="text-[11px] text-slate-400 mt-0.5">TNA bruta ${formatPercentPoints(quote.tnaBruta)} · neta ${formatPercentPoints(quote.tnaNeta)}</p>
        </div>
        ${badge}
      </div>
      <div class="space-y-1.5 text-xs">
        ${chequePctPointsRow('TNA bruta', quote.tnaBruta)}
        ${chequePctPointsRow('TNA neta', quote.tnaNeta)}
        ${chequeMoneyRow('Interés neto', quote.interes)}
      </div>
      <div class="mt-3 rounded-xl ${won ? 'bg-emerald-500/15' : 'bg-slate-800/80'} px-3 py-2.5 flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wide ${won ? 'text-emerald-200' : 'text-slate-300'}">A recibir</span>
        <span class="font-mono font-bold ${won ? 'text-emerald-300' : 'text-white'} text-sm text-right">${formatMoneyARS(quote.total)}</span>
      </div>
      <p class="mt-3 text-[10px] text-slate-500 leading-relaxed">${escapeHtml(taxTxt)} Sin comisión de entrada ni de salida. Honorarios ya en la cuotaparte. ${escapeHtml(source)}${details.fecha ? ' · ' + escapeHtml(details.fecha) : ''}.</p>
    </article>
  `;
}

function macroBreakEvenText(scenario) {
  if (!scenario.comparable) return '';
  if (typeof breakEvenLecapDays !== 'function' || typeof lecapPurchaseCostFraction !== 'function') return '';
  if (!scenario.bank || scenario.bank.tna == null || scenario.letra.tnaBruta == null) {
    return 'El empate contra el plazo fijo aparece cuando Macro tiene TNA para estos días.';
  }
  const days = breakEvenLecapDays(
    scenario.letra.tnaBruta,
    scenario.bank.tna,
    lecapPurchaseCostFraction(scenario.fees),
    getBankTax()
  );
  if (days == null) return `${scenario.ticker} no alcanza la TNA del plazo fijo con estos costos.`;
  const shown = (Math.round(days * 10) / 10).toFixed(1).replace('.', ',');
  return `${scenario.ticker} empata al plazo fijo cerca de los ${shown} días, después de comisiones y del impuesto si corresponde.`;
}

function chequePctPointsRow(label, points) {
  return `<div class="flex items-baseline justify-between gap-3">
    <span class="text-slate-400">${label}</span>
    <span class="font-mono text-slate-200 text-right">${formatPercentPoints(points)}</span>
  </div>`;
}

function buildLeadPayload(contact) {
  const base = {
    studio: activeStudio ? activeStudio.name : 'Estudio Aliado',
    pin: activeStudio ? activeStudio.pin : 'N/A',
    currency: currentCurrency,
    instrument: selectedInstrument,
    company: contact.company,
    name: contact.name,
    phone: contact.phone,
    notes: contact.notes,
    capital: currentCapital,
    plazo: currentPlazo,
    fecha: new Date().toISOString()
  };

  if (isChequeMode()) {
    const scenario = getChequeScenario();
    const cftBanco = scenario.bank.cftEfectivoPct;
    const cftZeta = scenario.zeta.cftEfectivoPct;
    return {
      ...base,
      currency: 'ARS',
      instrument: 'descuento_cheques',
      monto: roundMoney(scenario.monto),
      plazo: scenario.plazo,
      bankLabel: scenario.bankLabel,
      cftNominalBanco: scenario.bank.cftNominalPct,
      cftEfectivoBanco: cftBanco,
      cftNominalZeta: scenario.zeta.cftNominalPct,
      cftEfectivoZeta: cftZeta,
      montoRecibidoBanco: roundMoney(scenario.bank.montoRecibido),
      montoRecibidoZeta: roundMoney(scenario.zeta.montoRecibido),
      conviene: scenario.conviene,
      tnaBanco: scenario.bank.tnaDesc,
      tnaZeta: scenario.zeta.tnaDesc,
      tna: scenario.zeta.tnaDesc,
      rendimiento: Math.round(scenario.zeta.montoRecibido - scenario.bank.montoRecibido),
      liquidoZeta: roundMoney(scenario.zeta.liquido),
      tnaCostoZeta: scenario.zeta.tnaCostoPct,
      teaCostoZeta: scenario.zeta.teaCostoPct,
      tnaSinIcdbZeta: scenario.zeta.tnaSinIcdbPct,
      resumen: `Descuento de cheques · ${scenario.bankLabel} TNA costo ${formatPercentPoints(scenario.bank.tnaCostoPct)} · Zeta líquido ${formatMoneyARS(scenario.zeta.liquido)} · TNA ${formatPercentPoints(scenario.zeta.tnaCostoPct)} · TEA ${formatPercentPoints(scenario.zeta.teaCostoPct)} · Conviene: ${scenario.conviene}`
    };
  }

  if (isMacroLetraMode()) {
    const scenario = getMacroLetraScenario();
    const bankTotal = scenario.bank && scenario.bank.total != null ? roundMoney(scenario.bank.total) : null;
    const letraTotal = scenario.letra.total == null ? null : roundMoney(scenario.letra.total);
    const delta = (bankTotal != null && letraTotal != null) ? Math.round((letraTotal - bankTotal) * 100) / 100 : null;
    return {
      ...base,
      currency: 'ARS',
      instrument: 'macro_vs_letra',
      monto: roundMoney(scenario.monto),
      plazo: scenario.plazo,
      letraDias: scenario.vtoDays || null,
      letraCalza: !!scenario.comparable,
      bankLabel: scenario.bankLabel,
      ticker: scenario.ticker,
      tnaMacro: scenario.bank ? scenario.bank.tna : null,
      tnaLetraBruta: scenario.letra.tnaBruta,
      tnaLetraNeta: scenario.letra.tnaNeta == null ? null : Math.round(scenario.letra.tnaNeta * 100) / 100,
      tnaFci: scenario.fci && scenario.fci.tnaNeta != null ? Math.round(scenario.fci.tnaNeta * 100) / 100 : null,
      totalFci: scenario.fci && scenario.fci.total != null ? roundMoney(scenario.fci.total) : null,
      impuestoDebCred: scenario.letra.impuesto == null ? null : roundMoney(scenario.letra.impuesto),
      comisionPct: scenario.letra.comisionPct,
      aplicaIva: scenario.fees.aplicaIva,
      derechosPct: scenario.letra.derechosPct,
      totalMacro: bankTotal,
      totalLetra: letraTotal,
      conviene: scenario.conviene,
      tna: scenario.letra.tnaNeta,
      rendimiento: delta == null ? 0 : Math.round(delta),
      resumen: `Macro vs ${scenario.ticker} · ${scenario.bankLabel} ${bankTotal == null ? 'N/A' : formatMoneyARS(bankTotal)} · Letra neta ${letraTotal == null ? 'N/A' : formatMoneyARS(letraTotal)} · Conviene: ${scenario.conviene}`
    };
  }

  const quote = netQuote(selectedInstrument, activeTNA, currentPlazo);
  const rendimiento = Math.round(quote.interes);
  return {
    ...base,
    rendimiento,
    tna: quote.tnaNeta != null ? quote.tnaNeta : activeTNA,
    tnaBruta: quote.tnaBruta,
    tnaNeta: quote.tnaNeta
  };
}

/* ==========================================================
   4. MODAL Y CONVERSIÓN DE PROSPECTO (LEADS CON MARCA)
========================================================== */

function openLeadModal() {
  const waLink = document.getElementById('link-whatsapp-opcional');
  const waPhone = String(ZETA_CONFIG.adminWhatsapp || '').replace(/\D/g, '');
  if (waLink && waPhone) {
    waLink.href = `https://wa.me/${waPhone}`;
  }

  document.getElementById('lead-modal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeLeadModal() {
  document.getElementById('lead-modal').classList.add('hidden');
}

function handleLeadSubmit(event) {
  event.preventDefault();
  const company = document.getElementById('lead-company').value.trim();
  const name = document.getElementById('lead-name').value.trim();
  const phone = document.getElementById('lead-phone').value.trim();
  const notes = document.getElementById('lead-notes').value.trim();

  saveLeadToSheet(buildLeadPayload({ company, name, phone, notes }));

  closeLeadModal();
  showToast('Listo, te contactamos por WhatsApp');
  document.getElementById('lead-form').reset();
}

function saveLeadToSheet(leadData) {
  fetch('/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leadData)
  }).then((res) => {
    if (!res.ok) console.info('[Zeta Finance] El prospecto no llegó al Sheet.');
  }).catch(() => {
    console.info('[Zeta Finance] El prospecto no llegó al Sheet.');
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  msgEl.textContent = msg;
  toast.classList.remove('hidden');
  
  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}
