/**
 * LÓGICA DEL SIMULADOR MULTIACTIVO Y CONTROL DE ACCESO
 */

let activeStudio = null;
let currentCurrency = 'ARS'; // 'ARS' o 'USD'
let selectedInstrument = 'caucion'; // 'caucion', 'lecap', 'plazofijo', 'usd'
let currentCapital = 5000000;
let currentPlazo = 7;
let activeTNA = 21.5;

// Inicialización al cargar la página
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  setupPinBoxes();
  setupEventListeners();
  renderQuickCapitalButtons();
  updateInstrumentRates();
  checkUrlParams();

  // Sincronización de tasas de mercado (con renovación cada 30 min)
  fetchLiveRates();
  startRatesAutoRefresh();
});

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
      signal: AbortSignal.timeout(4000)
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

    // Cauciones ARS
    const cRes = await fetch(ZETA_CONFIG.ratesConfig?.directCaucionesUrl || 'https://api.argentinadatos.com/v1/finanzas/cauciones/ars', {
      signal: AbortSignal.timeout(3500)
    });
    if (cRes.ok) {
      const data = await cRes.json();
      if (Array.isArray(data) && data.length > 0) {
        data.forEach(item => {
          const d = parseInt(item.plazo || item.dias, 10);
          const t = parseFloat(item.tna || item.ultimo);
          if (!isNaN(d) && !isNaN(t) && t > 10 && t < 120) {
            if (d <= 3) ZETA_CONFIG.marketRates.caucionByDays[3] = t;
            else if (d <= 7) ZETA_CONFIG.marketRates.caucionByDays[7] = t;
            else if (d <= 10) ZETA_CONFIG.marketRates.caucionByDays[10] = t;
            else if (d <= 15) ZETA_CONFIG.marketRates.caucionByDays[15] = t;
            else if (d <= 32) ZETA_CONFIG.marketRates.caucionByDays[30] = t;
          }
        });
        updated = true;
      }
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

    if (updated) {
      applyFetchedRates(ZETA_CONFIG.marketRates, new Date(), 'direct');
      saveRatesToCache(ZETA_CONFIG.marketRates);
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
  if (newRates.lecapDetails) ZETA_CONFIG.marketRates.lecapDetails = newRates.lecapDetails;
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

function validatePin(pin) {
  const errorEl = document.getElementById('pin-error');
  
  if (ZETA_CONFIG.studios && ZETA_CONFIG.studios[pin]) {
    errorEl.classList.add('hidden');
    const studio = ZETA_CONFIG.studios[pin];
    unlockSimulator(studio, pin);
  } else {
    errorEl.classList.remove('hidden');
    const pinBoxes = document.getElementById('pin-boxes');
    pinBoxes.classList.add('animate-bounce');
    setTimeout(() => pinBoxes.classList.remove('animate-bounce'), 500);
  }
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
  calculateYield();
}

function renderQuickCapitalButtons() {
  const container = document.getElementById('quick-capital-container');
  container.innerHTML = '';

  const options = currentCurrency === 'USD' 
    ? [5000, 10000, 25000, 50000, 100000]
    : [1000000, 5000000, 10000000, 25000000, 50000000];

  options.forEach(amount => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition';
    const label = currentCurrency === 'USD'
      ? `+US$${amount >= 1000 ? (amount/1000) + 'K' : amount}`
      : `+$${amount >= 1000000 ? (amount/1000000) + 'M' : amount}`;
    btn.textContent = label;
    btn.onclick = () => setCapital(amount);
    container.appendChild(btn);
  });
}

function selectInstrument(inst) {
  if (currentCurrency === 'USD') return;
  selectedInstrument = inst;

  if (inst === 'caucion') {
    updateCaucionRateForDays(currentPlazo);
  } else if (inst === 'lecap') {
    activeTNA = ZETA_CONFIG.marketRates.lecapTNA;
  } else if (inst === 'plazofijo') {
    activeTNA = ZETA_CONFIG.marketRates.plazoFijoTNA;
  }

  document.getElementById('input-active-tna').value = activeTNA;
  updateInstrumentVisuals();
  calculateYield();
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

  activeTNA = tna;
  document.getElementById('rate-badge-caucion').textContent = `${tna.toFixed(1)}%`;
  if (selectedInstrument === 'caucion') {
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

  updateCaucionRateForDays(currentPlazo);
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
  const badge = document.getElementById('active-instrument-badge');

  [btnCaucion, btnLecap, btnPlazo].forEach(b => {
    b.className = "p-3.5 rounded-2xl border text-left transition relative bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700";
  });

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
}

function setCapital(amount) {
  currentCapital = amount;
  document.getElementById('input-capital').value = formatNumber(amount);
  calculateYield();
}

function setPlazo(days) {
  currentPlazo = days;
  document.getElementById('slider-plazo').value = days;
  document.getElementById('display-plazo').textContent = `${days} días`;

  // Actualizar estilo visual de las píldoras de plazo
  document.querySelectorAll('.plazo-pill').forEach(btn => {
    const d = parseInt(btn.getAttribute('data-days'), 10);
    if (d === days) {
      btn.classList.add('border-blue-500', 'bg-blue-500/10');
      btn.classList.remove('border-slate-700', 'bg-slate-800');
    } else {
      btn.classList.remove('border-blue-500', 'bg-blue-500/10');
      btn.classList.add('border-slate-700', 'bg-slate-800');
    }
  });

  // Si está en ARS y el instrumento es caución, actualizar su tasa escalonada
  if (currentCurrency === 'ARS') {
    updateCaucionRateForDays(days);
  }

  calculateYield();
}

/**
 * Fórmula Financiera Base:
 * Rendimiento = Capital * (TNA / 100) * (Días / 365)
 */
function calculateYield() {
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
   4. MODAL Y CONVERSIÓN DE PROSPECTO (LEADS CON MARCA)
========================================================== */

function openLeadModal() {
  document.getElementById('lead-modal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeLeadModal() {
  document.getElementById('lead-modal').classList.add('hidden');
}

function sendToWhatsapp() {
  const company = document.getElementById('lead-company').value.trim();
  const name = document.getElementById('lead-name').value.trim();
  const phone = document.getElementById('lead-phone').value.trim();
  const notes = document.getElementById('lead-notes').value.trim();

  if (!company || !name || !phone) {
    alert("Por favor complete los campos obligatorios (Empresa, Contacto y Teléfono) antes de enviar.");
    return;
  }

  const studioName = activeStudio ? activeStudio.name : "Estudio Aliado";
  const studioPin = activeStudio ? activeStudio.pin : "N/A";
  const currPrefix = currentCurrency === 'USD' ? 'US$' : '$';
  const rendimiento = Math.round(currentCapital * (activeTNA / 100) * (currentPlazo / 365));

  const lecapTicker = ZETA_CONFIG.marketRates?.lecapDetails?.ticker || "S30N6";
  const lecapVto = ZETA_CONFIG.marketRates?.lecapDetails?.vencimiento || "30/11/2026";

  const instNames = {
    caucion: "Caución Bursátil (Garantía BYMA)",
    lecap: `LECAP Corta - Ticker ${lecapTicker} (Vto: ${lecapVto})`,
    plazofijo: "Plazo Fijo Tradicional",
    usd: "Renta Corporativa en USD (5% Fijo)"
  };

  const message = 
`💼 *SOLICITUD DE APERTURA & COLOCACIÓN DE LIQUIDEZ*
────────────────────────────────
📌 *Derivado por:* ${studioName} (PIN: ${studioPin})
🏢 *Empresa / PyME:* ${company}
👤 *Contacto:* ${name}
📞 *Teléfono:* ${phone}
${notes ? `📝 *Detalle:* ${notes}\n` : ''}────────────────────────────────
📊 *PARÁMETROS DE LA ESTRATEGIA:*
• *Moneda:* ${currentCurrency}
• *Instrumento:* ${instNames[selectedInstrument] || selectedInstrument}
• *Capital a Colocar:* ${currPrefix}${formatNumber(currentCapital)}
• *Plazo Sugerido:* ${currentPlazo} días
• *TNA de Referencia:* ${activeTNA}%
• *Rendimiento Calculado:* +${currPrefix}${formatNumber(rendimiento)}
────────────────────────────────
_Generado desde la plataforma de tesorería corporativa para estudios aliados._`;

  const phoneDestino = ZETA_CONFIG.adminWhatsapp || "5491100000000";
  const waUrl = `https://wa.me/${phoneDestino}?text=${encodeURIComponent(message)}`;

  saveLeadToSheet({
    studio: studioName,
    pin: studioPin,
    currency: currentCurrency,
    instrument: selectedInstrument,
    company,
    name,
    phone,
    notes,
    capital: currentCapital,
    plazo: currentPlazo,
    rendimiento,
    tna: activeTNA,
    fecha: new Date().toISOString()
  });

  window.open(waUrl, '_blank');
  closeLeadModal();
  showToast("Redirigiendo a WhatsApp de Mesa de Operaciones...");
}

function handleLeadSubmit(event) {
  event.preventDefault();
  const company = document.getElementById('lead-company').value.trim();
  const name = document.getElementById('lead-name').value.trim();
  const phone = document.getElementById('lead-phone').value.trim();
  const notes = document.getElementById('lead-notes').value.trim();

  const studioName = activeStudio ? activeStudio.name : "Estudio Aliado";
  const studioPin = activeStudio ? activeStudio.pin : "N/A";
  const rendimiento = Math.round(currentCapital * (activeTNA / 100) * (currentPlazo / 365));

  saveLeadToSheet({
    studio: studioName,
    pin: studioPin,
    currency: currentCurrency,
    instrument: selectedInstrument,
    company,
    name,
    phone,
    notes,
    capital: currentCapital,
    plazo: currentPlazo,
    rendimiento,
    tna: activeTNA,
    fecha: new Date().toISOString()
  });

  closeLeadModal();
  showToast(`Prospecto de ${company} guardado exitosamente`);
  document.getElementById('lead-form').reset();
}

function saveLeadToSheet(leadData) {
  if (!ZETA_CONFIG.googleSheetWebhookUrl) {
    console.log("[Zeta Finance] Lead guardado localmente:", leadData);
    return;
  }

  fetch(ZETA_CONFIG.googleSheetWebhookUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
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
