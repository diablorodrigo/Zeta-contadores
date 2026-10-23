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
let macroTnaDirty = false;
let letraTnaDirty = false;
let liveMacroBands = null;
let activeTNA = 21.5;

// Inicialización al cargar la página
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  // Cargar estudios dinámicos desde Google Sheets (con caché local)
  loadStudiosFromCache();
  fetchStudiosFromGoogleSheets();

  setupPinBoxes();
  macroLetraPlazoDays = letraDaysFromConfig();
  setupEventListeners();
  initChequeControls();
  initMacroLetraControls();
  renderQuickCapitalButtons();
  updateInstrumentRates();
  checkUrlParams();

  // Sincronización de tasas de mercado (con renovación cada 30 min)
  fetchLiveRates();
  startRatesAutoRefresh();
});

/* ==========================================================
   0. GESTIÓN DINÁMICA DE ESTUDIOS DESDE GOOGLE SHEETS
========================================================== */

function loadStudiosFromCache() {
  try {
    const cached = localStorage.getItem('zeta_studios_cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        ZETA_CONFIG.studios = { ...ZETA_CONFIG.studios, ...parsed };
      }
    }
  } catch (e) {
    console.warn('[Zeta Finance] Error leyendo caché de estudios:', e);
  }
}

async function fetchStudiosFromGoogleSheets() {
  if (!ZETA_CONFIG.googleSheetWebhookUrl) return;

  try {
    const url = `${ZETA_CONFIG.googleSheetWebhookUrl}?action=getStudios&t=${Date.now()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });

    if (res.ok) {
      const json = await res.json();
      if (json.success && json.studios && Object.keys(json.studios).length > 0) {
        // Combinar estudios de Google Sheets con los de respaldo
        ZETA_CONFIG.studios = { ...ZETA_CONFIG.studios, ...json.studios };
        localStorage.setItem('zeta_studios_cache', JSON.stringify(json.studios));
        console.log(`[Zeta Finance] ${Object.keys(json.studios).length} estudios sincronizados desde Google Sheets.`);
        
        // Re-verificar URL si vino con parámetro ?pin= o ?estudio=
        checkUrlParams();
      }
    }
  } catch (err) {
    console.info('[Zeta Finance] Usando estudios de config.js / caché local (offline o timeout).');
  }
}

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

  const cacheKey = 'zeta_market_rates_cache';
  const ttlMs = (ZETA_CONFIG.ratesConfig?.refreshIntervalMinutes || 30) * 60 * 1000;

  // 1. Revisar si hay datos en caché válidos por menos de 30 minutos
  if (!force) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        const age = Date.now() - parsed.timestamp;
        // Si el caché tiene tasas viejas o tickers vencidos (ej. S28F5 de 2025), descartarlo
        if (parsed.rates && (parsed.rates.lecapTNA > 35 || parsed.rates.lecapDetails?.ticker === 'S28F5')) {
          localStorage.removeItem(cacheKey);
        } else if (age < ttlMs && parsed.rates) {
          applyFetchedRates(parsed.rates, new Date(parsed.timestamp), 'cache');
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
        applyFetchedRates(json.rates, new Date(), 'api');
        saveRatesToCache(json.rates);
        success = true;
      }
    }
  } catch (err) {
    // Si corre localmente por file:/// o sin server, intentar ArgentinaDatos directo
    console.info('[Zeta Finance] Intentando conexión directa a ArgentinaDatos...');
    success = await fetchDirectArgentinaDatos();
  }

  if (!success) {
    // Si no hubo conexión o el mercado está cerrado, se usan las tasas base de config.js
    updateRatesStatusUI(new Date(), 'fallback');
  }

  if (icon) {
    setTimeout(() => icon.classList.remove('animate-spin'), 600);
  }
}

async function fetchDirectArgentinaDatos() {
  try {
    let updated = false;
    const fallbackCurve = { ...(ZETA_CONFIG.marketRates.caucionByDays || {}) };

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
        const curve = bucketCaucionQuotes(quotesFromBymaRows(bymaRows), fallbackCurve);
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

    if (updated) {
      const payload = { ...ZETA_CONFIG.marketRates };
      if (macroBands) payload.macroPlazoFijoBands = macroBands;
      applyFetchedRates(payload, new Date(), 'direct');
      saveRatesToCache(payload);
      return true;
    }
  } catch (e) {
    console.warn('[Zeta Finance] Mercado offline o CORS local:', e.message);
  }
  return false;
}

function applyFetchedRates(newRates, timestamp, origin) {
  if (newRates.caucionByDays) {
    ZETA_CONFIG.marketRates.caucionByDays = { ...ZETA_CONFIG.marketRates.caucionByDays, ...newRates.caucionByDays };
  }
  if (newRates.plazoFijoTNA) ZETA_CONFIG.marketRates.plazoFijoTNA = newRates.plazoFijoTNA;
  if (newRates.lecapTNA) ZETA_CONFIG.marketRates.lecapTNA = newRates.lecapTNA;
  if (newRates.lecapDetails) {
    // Merge: el scrapeo de Rava no trae días al vencimiento y no debe pisar el de config.
    ZETA_CONFIG.marketRates.lecapDetails = {
      ...(ZETA_CONFIG.marketRates.lecapDetails || {}),
      ...newRates.lecapDetails
    };
  }
  if (Array.isArray(newRates.macroPlazoFijoBands) && newRates.macroPlazoFijoBands.length) {
    liveMacroBands = newRates.macroPlazoFijoBands;
  }
  if (newRates.usdRateAnnual) ZETA_CONFIG.marketRates.usdRateAnnual = newRates.usdRateAnnual;

  updateInstrumentRates();
  if (currentCurrency === 'ARS') {
    selectInstrument(selectedInstrument);
  } else {
    calculateYield();
  }

  updateRatesStatusUI(timestamp, origin);
}

function saveRatesToCache(rates) {
  try {
    localStorage.setItem('zeta_market_rates_cache', JSON.stringify({
      timestamp: Date.now(),
      rates
    }));
  } catch (e) {}
}

function updateRatesStatusUI(date, origin) {
  const dot = document.getElementById('rate-status-dot');
  const text = document.getElementById('rate-status-text');
  const lastUpdate = document.getElementById('rate-last-update');
  if (!dot || !text || !lastUpdate) return;

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (origin === 'api' || origin === 'direct' || origin === 'cache') {
    dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse";
    text.textContent = "Tasas en vivo sincronizadas";
    text.className = "font-medium text-emerald-300";
    lastUpdate.textContent = `Actualizado: ${timeStr} hs`;
  } else {
    dot.className = "w-2.5 h-2.5 rounded-full bg-amber-400";
    text.textContent = "Tasas de referencia (mercado cerrado)";
    text.className = "font-medium text-amber-300";
    lastUpdate.textContent = `Referencia activa: ${timeStr} hs`;
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
  
  // 1. Verificar si ya está en memoria / caché
  if (ZETA_CONFIG.studios && ZETA_CONFIG.studios[pin]) {
    errorEl.classList.add('hidden');
    const studio = ZETA_CONFIG.studios[pin];
    unlockSimulator(studio, pin);
    return;
  }

  // 2. Si no está, consultar rápidamente a Google Sheets por si es un PIN recién creado
  if (ZETA_CONFIG.googleSheetWebhookUrl) {
    try {
      const res = await fetch(`${ZETA_CONFIG.googleSheetWebhookUrl}?action=getStudios&t=${Date.now()}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.studios && json.studios[pin]) {
          ZETA_CONFIG.studios = { ...ZETA_CONFIG.studios, ...json.studios };
          localStorage.setItem('zeta_studios_cache', JSON.stringify(json.studios));
          errorEl.classList.add('hidden');
          unlockSimulator(json.studios[pin], pin);
          return;
        }
      }
    } catch (e) {}
  }

  // 3. Si no existe, mostrar error
  errorEl.classList.remove('hidden');
  const pinBoxes = document.getElementById('pin-boxes');
  pinBoxes.classList.add('animate-bounce');
  setTimeout(() => pinBoxes.classList.remove('animate-bounce'), 500);
}

function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const pinParam = urlParams.get('pin');
  const estudioParam = urlParams.get('estudio');

  if (pinParam && ZETA_CONFIG.studios[pinParam]) {
    unlockSimulator(ZETA_CONFIG.studios[pinParam], pinParam);
    return;
  }

  if (estudioParam) {
    for (const [pin, studio] of Object.entries(ZETA_CONFIG.studios)) {
      if (studio.id.toLowerCase() === estudioParam.toLowerCase() || 
          studio.name.toLowerCase().includes(estudioParam.toLowerCase())) {
        unlockSimulator(studio, pin);
        return;
      }
    }
  }
}

function unlockSimulator(studio, pin) {
  activeStudio = { ...studio, pin };
  applyStudioBranding(activeStudio);

  document.getElementById('gatekeeper-screen').classList.add('hidden');
  document.getElementById('simulator-screen').classList.remove('hidden');

  calculateYield();

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
  else if (currentCurrency === 'ARS') liquidityPlazo = currentPlazo;
}

function plazoForInstrument(inst) {
  if (inst === 'cheques') return chequePlazoDays;
  if (inst === 'macroLetra') return macroLetraPlazoDays;
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
  } else if (inst === 'lecap') {
    activeTNA = ZETA_CONFIG.marketRates.lecapTNA;
  } else if (inst === 'plazofijo') {
    activeTNA = ZETA_CONFIG.marketRates.plazoFijoTNA;
  }

  if (inst !== 'cheques' && inst !== 'macroLetra') {
    document.getElementById('input-active-tna').value = activeTNA;
  }

  syncChequeMode();
  renderQuickCapitalButtons();
  updateInstrumentVisuals();
  setPlazo(currentPlazo);
}

function updateCaucionRateForDays(days) {
  const rates = ZETA_CONFIG.marketRates.caucionByDays;
  let tna = rates[days];
  
  if (!tna) {
    if (days <= 3) tna = rates[3];
    else if (days <= 7) tna = rates[7];
    else if (days <= 10) tna = rates[10];
    else if (days <= 15) tna = rates[15];
    else tna = rates[30];
  }

  document.getElementById('rate-badge-caucion').textContent = `${Number(tna).toFixed(1)}%`;
  // Solo la caución toma la TNA del plazo. LECAP y plazo fijo conservan la suya.
  if (selectedInstrument === 'caucion') {
    activeTNA = tna;
    document.getElementById('input-active-tna').value = tna;
  }
}

function updateInstrumentRates() {
  const rates = ZETA_CONFIG.marketRates;
  document.getElementById('rate-badge-lecap').textContent = `${rates.lecapTNA.toFixed(1)}%`;
  document.getElementById('rate-badge-plazofijo').textContent = `${rates.plazoFijoTNA.toFixed(1)}%`;

  // Actualizar detalles visibles del Ticker de la LECAP activa
  if (rates.lecapDetails) {
    const pill = document.getElementById('lecap-ticker-pill');
    const vto = document.getElementById('lecap-vto-label');
    if (pill && rates.lecapDetails.ticker) pill.textContent = rates.lecapDetails.ticker;
    if (vto && rates.lecapDetails.vencimiento) vto.textContent = rates.lecapDetails.vencimiento;
  }

  const curveDays = (selectedInstrument === 'cheques' || selectedInstrument === 'macroLetra')
    ? liquidityPlazo
    : currentPlazo;
  updateCaucionRateForDays(curveDays);
  updateCaucionPillRates();
  refreshMacroVtoPill();

  const macroBadge = document.getElementById('macro-letra-badge');
  if (macroBadge) macroBadge.textContent = `${Number(rates.lecapTNA).toFixed(1)}%`;
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
  const btnPlazo = document.getElementById('btn-inst-plazofijo');
  const btnCheques = document.getElementById('btn-inst-cheques');
  const btnMacro = document.getElementById('btn-inst-macro-letra');
  const badge = document.getElementById('active-instrument-badge');
  const idle = "p-3.5 rounded-2xl border text-left transition relative bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700";

  [btnCaucion, btnLecap, btnPlazo, btnCheques].forEach(b => {
    if (!b) return;
    b.className = idle + (b === btnCheques ? " min-w-0" : "");
  });
  if (btnMacro) btnMacro.className = idle + " sm:col-span-2 min-w-0";

  if (selectedInstrument === 'caucion') {
    btnCaucion.className = "p-3.5 rounded-2xl border text-left transition relative bg-blue-500/10 border-blue-500 text-white";
    badge.textContent = "Caución Bursátil (BYMA)";
    badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30";
  } else if (selectedInstrument === 'lecap') {
    const ticker = ZETA_CONFIG.marketRates?.lecapDetails?.ticker || "S30N6";
    btnLecap.className = "p-3.5 rounded-2xl border text-left transition relative bg-emerald-500/10 border-emerald-500 text-white";
    badge.textContent = `LECAP Corta (${ticker})`;
    badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
  } else if (selectedInstrument === 'plazofijo') {
    btnPlazo.className = "p-3.5 rounded-2xl border text-left transition relative bg-amber-500/10 border-amber-500 text-white";
    badge.textContent = "Plazo Fijo Tradicional";
    badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30";
  } else if (selectedInstrument === 'cheques' && btnCheques) {
    btnCheques.className = "p-3.5 rounded-2xl border text-left transition relative bg-violet-500/10 border-violet-500 text-white min-w-0";
    badge.textContent = "Descuento de cheques";
    badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30";
  } else if (selectedInstrument === 'macroLetra' && btnMacro) {
    btnMacro.className = "sm:col-span-2 min-w-0 p-3.5 rounded-2xl border text-left transition relative bg-sky-500/10 border-sky-500 text-white";
    const ticker = ZETA_CONFIG.marketRates?.lecapDetails?.ticker || "LECAP";
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

  ['cheque-bank-label', 'cheque-tna-bank', 'cheque-tna-zeta'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (isChequeMode()) calculateYield();
    });
  });

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
      if (!isNaN(n)) setPlazo(n);
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

function setCapital(amount) {
  currentCapital = amount;
  document.getElementById('input-capital').value = formatNumber(amount);
  calculateYield();
}

function setPlazo(days) {
  const max = isChequeMode() ? 180 : (isMacroLetraMode() ? 365 : 35);
  let safe = parseInt(days, 10);
  if (!isFinite(safe) || safe < 1) safe = 1;
  if (safe > max) safe = max;
  currentPlazo = safe;
  if (isChequeMode()) chequePlazoDays = safe;
  else if (isMacroLetraMode()) macroLetraPlazoDays = safe;
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
  const activeBorder = isChequeMode() ? 'border-violet-500' : (isMacroLetraMode() ? 'border-sky-500' : 'border-blue-500');
  const activeBg = isChequeMode() ? 'bg-violet-500/10' : (isMacroLetraMode() ? 'bg-sky-500/10' : 'bg-blue-500/10');
  document.querySelectorAll('.plazo-pill').forEach(btn => {
    const d = parseInt(btn.getAttribute('data-days'), 10);
    btn.classList.remove('border-blue-500', 'bg-blue-500/10', 'border-violet-500', 'bg-violet-500/10', 'border-sky-500', 'bg-sky-500/10', 'border-slate-700', 'bg-slate-800');
    if (d === currentPlazo) {
      btn.classList.add(activeBorder, activeBg);
    } else {
      btn.classList.add('border-slate-700', 'bg-slate-800');
    }
  });
}

/**
 * Fórmula Financiera Base:
 * Rendimiento = Capital * (TNA / 100) * (Días / 365)
 */
function calculateYield() {
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
  const rendimiento = Math.round(currentCapital * (activeTNA / 100) * (currentPlazo / 365));
  const capitalFinal = currentCapital + rendimiento;
  const rendimientoDiario = currentPlazo > 0 ? Math.round(rendimiento / currentPlazo) : 0;

  // Actualizar Tarjeta Principal
  document.getElementById('display-rendimiento').textContent = `+${currPrefix}${formatNumber(rendimiento)}`;
  document.getElementById('display-resumen-capital').textContent = `${currPrefix}${formatNumber(currentCapital)}`;
  document.getElementById('display-capital-final').textContent = `${currPrefix}${formatNumber(capitalFinal)}`;
  document.getElementById('display-diario').textContent = `+${currPrefix}${formatNumber(rendimientoDiario)} / día`;
  document.getElementById('display-opportunity-cost').textContent = `+${currPrefix}${formatNumber(rendimiento)}`;

  // Actualizar Modal
  const lecapTicker = ZETA_CONFIG.marketRates?.lecapDetails?.ticker || "S30N6";
  const instNames = {
    caucion: "Caución Bursátil",
    lecap: `LECAP (${lecapTicker})`,
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

  // Cálculos para cada alternativa en Pesos
  const rates = ZETA_CONFIG.marketRates;
  const tnaCaucion = rates.caucionByDays[currentPlazo] || activeTNA;
  const yieldCaucion = Math.round(currentCapital * (tnaCaucion / 100) * (currentPlazo / 365));
  const yieldLecap = Math.round(currentCapital * (rates.lecapTNA / 100) * (currentPlazo / 365));
  
  // Plazo fijo: requiere min 30 días
  const pfEligible = currentPlazo >= 30;
  const yieldPlazoFijo = Math.round(currentCapital * (rates.plazoFijoTNA / 100) * (currentPlazo / 365));
  const lecapTicker = rates.lecapDetails?.ticker || "S30N6";
  const lecapVto = rates.lecapDetails?.vencimiento || "30/11";

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
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 font-mono font-bold">${rates.lecapTNA}% TNA</span>
            <span class="text-[9px] px-1 py-0.2 rounded bg-emerald-900/60 text-emerald-300">Vto: ${lecapVto}</span>
          </div>
          <span class="text-[11px] text-slate-400">Título de referencia de mayor liquidez &bull; Mercado secundario</span>
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
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-400 font-mono font-bold">${tnaCaucion}% TNA</span>
            <span class="text-[9px] px-1 py-0.2 rounded bg-blue-900/60 text-blue-300">Garantía BYMA</span>
          </div>
          <span class="text-[11px] text-slate-400">Liquidez a medida (${currentPlazo} días) &bull; Riesgo cero de crédito</span>
        </div>
      </div>
      <span class="font-mono font-bold text-blue-400 text-sm">+${currPrefix}${formatNumber(yieldCaucion)}</span>
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
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono font-bold">${rates.plazoFijoTNA}% TNA</span>
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
  toggle('macro-comparison-card', macro);
  toggle('macro-result-stack', macro);
  toggle('plazo-pills-liquidity', single);
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
    if (plazoLabel) plazoLabel.textContent = 'Días al vencimiento de la letra';
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
    slider.max = cheque ? '180' : (macro ? '365' : '35');
    slider.classList.toggle('accent-violet-500', cheque);
    slider.classList.toggle('accent-sky-500', macro);
    slider.classList.toggle('accent-blue-500', !cheque && !macro);
  }
}

function getChequeConfig() {
  const cfg = (typeof ZETA_CONFIG !== 'undefined' && ZETA_CONFIG.chequeDiscount) || {};
  return {
    bankLabel: cfg.bankLabel || 'Banco',
    bank: {
      tnaDesc: numberOr(cfg.bank && cfg.bank.tnaDesc, 27.5),
      derechosPct: numberOr(cfg.bank && cfg.bank.derechosPct, 0.06),
      tnaArancel: numberOr(cfg.bank && cfg.bank.tnaArancel, 1)
    },
    zeta: {
      tnaDesc: numberOr(cfg.zeta && cfg.zeta.tnaDesc, 25.5),
      derechosPct: numberOr(cfg.zeta && cfg.zeta.derechosPct, 0.05),
      tnaArancel: numberOr(cfg.zeta && cfg.zeta.tnaArancel, 0.7)
    },
    iva: numberOr(cfg.iva, 0.21)
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

  const bankExtras = document.getElementById('cheque-bank-extras');
  const zetaExtras = document.getElementById('cheque-zeta-extras');
  if (bankExtras) {
    bankExtras.textContent = `Derechos ${formatPercentPoints(cfg.bank.derechosPct)} · Arancel ${formatPercentPoints(cfg.bank.tnaArancel)} TNA (config.js)`;
  }
  if (zetaExtras) {
    zetaExtras.textContent = `Derechos ${formatPercentPoints(cfg.zeta.derechosPct)} · Arancel ${formatPercentPoints(cfg.zeta.tnaArancel)} TNA (config.js)`;
  }

  const plazoExact = document.getElementById('input-plazo-cheque');
  if (plazoExact) plazoExact.value = String(chequePlazoDays);
}

function getChequeScenario() {
  const cfg = getChequeConfig();
  const labelInput = document.getElementById('cheque-bank-label');
  const typedLabel = labelInput ? labelInput.value.trim() : '';
  const bankLabel = typedLabel || cfg.bankLabel;
  const bankRates = { ...cfg.bank, tnaDesc: readOptionalNumber('cheque-tna-bank', cfg.bank.tnaDesc) };
  const zetaRates = { ...cfg.zeta, tnaDesc: readOptionalNumber('cheque-tna-zeta', cfg.zeta.tnaDesc) };
  const bank = calcChequeQuote(currentCapital, currentPlazo, bankRates, cfg.iva);
  const zeta = calcChequeQuote(currentCapital, currentPlazo, zetaRates, cfg.iva);

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

  const winnerQuote = scenario.winner === 'banco' ? scenario.bank : scenario.zeta;
  const winnerName = scenario.winner === 'banco'
    ? scenario.bankLabel
    : (scenario.winner === 'empate' ? 'Empate' : 'Propuesta Zeta');

  setText('cheque-hero-cft', scenario.winner === 'empate'
    ? formatRatioPct(scenario.zeta.cftEfectivo)
    : formatRatioPct(winnerQuote.cftEfectivo));
  setText('cheque-hero-subtitle', scenario.winner === 'empate'
    ? 'Mismo CFT efectivo. El indicador para comparar las dos propuestas.'
    : `${winnerName} · indicador para comparar las dos propuestas.`);
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
  const pct = scenario.winner === 'banco' ? scenario.bank.cftEfectivoPct : scenario.zeta.cftEfectivoPct;
  setText('modal-ganancia', pct == null ? scenario.conviene : `${scenario.conviene} · ${formatPercentPoints(pct)}`);
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
        ${chequeMoneyRow('Descuento financiero', quote.descuentoFinanciero)}
        ${chequeMoneyRow('Derechos de mercado + IVA', quote.derechosIva)}
        ${chequeMoneyRow('Arancel + IVA', quote.arancelIva)}
        ${chequeMoneyRow('Total costos', quote.totalCostos, true)}
      </div>
      <div class="mt-3 rounded-xl ${won ? 'bg-emerald-500/15' : 'bg-slate-800/80'} px-3 py-2.5 flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wide ${won ? 'text-emerald-200' : 'text-slate-300'}">Monto recibido</span>
        <span class="font-mono font-bold ${won ? 'text-emerald-300' : 'text-white'} text-sm text-right">${formatMoneyARS(quote.montoRecibido)}</span>
      </div>
      <div class="mt-3 space-y-1.5 text-xs">
        ${chequePctRow('Costo del período', quote.costoPeriodo)}
        ${chequePctRow('CFT nominal anual', quote.cftNominal)}
      </div>
      <div class="mt-3 pt-3 border-t border-slate-800/80">
        <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">CFT efectivo anual</p>
        <p class="text-2xl sm:text-3xl font-extrabold font-mono tracking-tight ${cftClass}">${formatRatioPct(quote.cftEfectivo)}</p>
        <p class="text-[10px] text-slate-500">Indicador para comparar</p>
      </div>
    </article>
  `;
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
  return n.toFixed(2).replace('.', ',') + '%';
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

function letraDaysFromConfig() {
  const details = ZETA_CONFIG.marketRates && ZETA_CONFIG.marketRates.lecapDetails;
  const days = Number(details && details.diasAlVencimiento);
  if (isFinite(days) && days >= 1) return Math.round(days);
  return 38;
}

function getMacroBands() {
  if (Array.isArray(liveMacroBands) && liveMacroBands.length) return liveMacroBands;
  const cfg = ZETA_CONFIG.macroVsLetra;
  return (cfg && cfg.bands) || [];
}

function getMacroLetraConfig() {
  const cfg = (typeof ZETA_CONFIG !== 'undefined' && ZETA_CONFIG.macroVsLetra) || {};
  const letra = cfg.letra || {};
  return {
    bankLabel: cfg.bankLabel || 'Banco Macro',
    minDias: numberOr(cfg.minDias, 30),
    letra: {
      brokerLabel: letra.brokerLabel || 'Balanz',
      comisionPct: numberOr(letra.comisionPct, 0.1),
      aplicaIva: !!letra.aplicaIva,
      iva: numberOr(letra.iva, 0.21),
      derechosPct: numberOr(letra.derechosPct, 0)
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
  if (sub) sub.textContent = 'Vto. letra';
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

function syncMacroReferenceInputs() {
  const cfg = getMacroLetraConfig();
  const marketTna = Number(ZETA_CONFIG.marketRates.lecapTNA);
  if (!letraTnaDirty) {
    const input = document.getElementById('macro-tna-letra');
    if (input && isFinite(marketTna)) input.value = String(marketTna);
  }
  const band = (currentPlazo >= cfg.minDias)
    ? pickMacroBand(getMacroBands(), currentCapital, currentPlazo)
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
  const band = syncMacroReferenceInputs();
  const grossTna = readSignedNumber('macro-tna-letra', ZETA_CONFIG.marketRates.lecapTNA);
  const fees = {
    comisionPct: readOptionalNumber('macro-comision', cfg.letra.comisionPct),
    derechosPct: readOptionalNumber('macro-derechos', cfg.letra.derechosPct),
    aplicaIva: !!(document.getElementById('macro-aplica-iva') && document.getElementById('macro-aplica-iva').checked),
    iva: cfg.letra.iva
  };
  const letra = calcLetraNeta(currentCapital, currentPlazo, grossTna, fees);
  const details = ZETA_CONFIG.marketRates.lecapDetails || {};
  const ticker = details.ticker || 'LECAP';
  const vtoDays = letraDaysFromConfig();

  let bank = null;
  let bankReason = null;
  if (currentPlazo < cfg.minDias) {
    bankReason = 'min';
  } else if (!macroTnaDirty && !band) {
    bankReason = 'sin-tramo';
  } else {
    const tna = macroTnaDirty
      ? readOptionalNumber('macro-tna-bank', band ? band.tna : 0)
      : band.tna;
    bank = calcPlazoFijoSimple(currentCapital, currentPlazo, tna);
    if (bank.total == null) bankReason = 'sin-tramo';
  }

  let winner = null;
  let conviene = 'No comparable';
  if (bank && bank.total != null && letra.total != null) {
    const delta = letra.total - bank.total;
    if (Math.abs(delta) < 0.5) {
      winner = 'empate';
      conviene = 'Empate';
    } else if (delta > 0) {
      winner = 'letra';
      conviene = 'Letra corta';
    } else {
      winner = 'banco';
      conviene = bankLabel;
    }
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
    fees,
    winner,
    conviene,
    monto: currentCapital,
    plazo: currentPlazo,
    minDias: cfg.minDias
  };
}

function renderMacroLetraExperience() {
  const scenario = getMacroLetraScenario();
  const grid = document.getElementById('macro-comparison-grid');
  if (grid) {
    grid.innerHTML = [
      renderMacroBankCard(scenario),
      renderMacroLetraCard(scenario)
    ].join('');
  }

  const note = document.getElementById('macro-comparison-note');
  if (note) {
    const vtoNote = scenario.plazo === scenario.vtoDays
      ? `Plazo del vencimiento de ${scenario.ticker} (${scenario.vtoDays} días).`
      : `Estás simulando ${scenario.plazo} días. ${scenario.ticker} vence en ${scenario.vtoDays}.`;
    note.textContent = vtoNote + ' Mismo capital de los dos lados.';
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
    const market = formatPercentPoints(ZETA_CONFIG.marketRates.lecapTNA);
    letraHint.textContent = letraTnaDirty
      ? `TNA de mercado ${market}. En esta reunión: ${formatPercentPoints(scenario.letra.tnaBruta)}.`
      : `TNA bruta de ${scenario.ticker}: ${market}.`;
  }

  const delta = (scenario.bank && scenario.bank.total != null && scenario.letra.total != null)
    ? scenario.letra.total - scenario.bank.total
    : null;

  if (scenario.bankReason === 'min') {
    setText('macro-hero-kicker', 'A recibir con la letra');
    setText('macro-hero-delta', formatMoneyARS(scenario.letra.total));
    setText('macro-hero-subtitle', `Plazo fijo no disponible bajo ${scenario.minDias} días. Esto es lo que deja la letra.`);
    setText('macro-winner-badge', 'PF no disponible');
  } else if (scenario.bankReason === 'sin-tramo' && !(scenario.bank && scenario.bank.total != null)) {
    setText('macro-hero-kicker', 'A recibir con la letra');
    setText('macro-hero-delta', formatMoneyARS(scenario.letra.total));
    setText('macro-hero-subtitle', 'Cargá la TNA de Macro para comparar. Mientras tanto, el total de la letra.');
    setText('macro-winner-badge', 'Falta TNA Macro');
  } else if (scenario.winner === 'empate') {
    setText('macro-hero-kicker', 'Diferencia a cobrar');
    setText('macro-hero-delta', formatMoneyARS(0));
    setText('macro-hero-subtitle', 'Los dos lados dejan el mismo monto.');
    setText('macro-winner-badge', 'Empate');
  } else if (delta != null && delta > 0) {
    setText('macro-hero-kicker', 'Diferencia a cobrar');
    setText('macro-hero-delta', '+' + formatMoneyARS(delta));
    setText('macro-hero-subtitle', `La letra deja más que ${scenario.bankLabel}.`);
    setText('macro-winner-badge', 'Conviene la letra');
  } else if (delta != null) {
    setText('macro-hero-kicker', 'Diferencia a cobrar');
    setText('macro-hero-delta', '+' + formatMoneyARS(Math.abs(delta)));
    setText('macro-hero-subtitle', `${scenario.bankLabel} deja más que la letra.`);
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
  const note = scenario.bankReason === 'min'
    ? `No se constituye a menos de ${scenario.minDias} días.`
    : (scenario.bankReason === 'sin-tramo' ? 'Sin TNA publicada para este plazo y monto.' : 'Interés simple, sin comisión.');

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

function renderMacroLetraCard(scenario) {
  const won = scenario.winner === 'letra' && scenario.bank && scenario.bank.total != null;
  const quote = scenario.letra;
  const border = won ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-950/40';
  const badge = won
    ? '<span class="shrink-0 text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">Conviene</span>'
    : '';
  const ivaTxt = scenario.fees.aplicaIva ? 'con IVA' : 'sin IVA';
  const costTxt = `Comisión ${formatPercentPoints(quote.comisionPct)} ${ivaTxt} · Derechos ${formatPercentPoints(quote.derechosPct)}`;

  return `
    <article class="min-w-0 rounded-2xl border p-4 ${border}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Letra corta</p>
          <h5 class="font-bold text-white text-sm leading-snug">${escapeHtml(scenario.ticker)}</h5>
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
      <p class="mt-3 text-[10px] text-slate-500 leading-relaxed">${escapeHtml(costTxt)}. ${escapeHtml(scenario.brokerLabel)}, compra al vencimiento. Sin membresía.</p>
    </article>
  `;
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
      resumen: `Descuento de cheques · ${scenario.bankLabel} CFT ef. ${formatRatioPct(scenario.bank.cftEfectivo)} · Zeta CFT ef. ${formatRatioPct(scenario.zeta.cftEfectivo)} · Conviene: ${scenario.conviene}`
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
      bankLabel: scenario.bankLabel,
      ticker: scenario.ticker,
      tnaMacro: scenario.bank ? scenario.bank.tna : null,
      tnaLetraBruta: scenario.letra.tnaBruta,
      tnaLetraNeta: scenario.letra.tnaNeta == null ? null : Math.round(scenario.letra.tnaNeta * 100) / 100,
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

  const rendimiento = Math.round(currentCapital * (activeTNA / 100) * (currentPlazo / 365));
  return { ...base, rendimiento, tna: activeTNA };
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
  if (!ZETA_CONFIG.googleSheetWebhookUrl) {
    console.log("[Zeta Finance] Lead guardado localmente:", leadData);
    return;
  }

  // Mismo JSON de siempre. text/plain es un header simple: con no-cors el browser
  // deja salir el POST. application/json lo rechaza antes de llegar al Sheet.
  fetch(ZETA_CONFIG.googleSheetWebhookUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(leadData)
  }).then(() => {
    console.log("[Zeta Finance] Lead sincronizado con Google Sheets.");
  }).catch(err => {
    console.error("[Zeta Finance] Error al sincronizar:", err);
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
