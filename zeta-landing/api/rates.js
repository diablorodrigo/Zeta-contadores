/**
 * VERCEL SERVERLESS FUNCTION: /api/rates
 *
 * Extrae y consolida:
 * 1. Cauciones ARS por plazo (3, 7, 10, 15, 30). Fuente primaria: BYMA
 *    open.bymadata (POST .../free/cauciones). ArgentinaDatos
 *    /v1/finanzas/cauciones/ars queda como respaldo: es un snapshot de la
 *    rueda IOL y devuelve [] cuando no hay títulos, incluso con el mercado abierto.
 * 2. Tasa de plazo fijo promedio (BCRA, depositos30Dias).
 * 3. Tramos de plazo fijo de BANCO MACRO (ArgentinaDatos /tasas/plazoFijo),
 *    para la comparación contra la letra corta. Si no viene la entidad, el
 *    cliente sigue con los presets de config.js.
 * 4. LECAP corta. Precio: Data912 /live/arg_notes y, si esa especie no viene,
 *    BYMA /free/lebacs (24 hs). TNA, TEA y TIR salen del precio, el vencimiento
 *    y el payoff capitalizado (ficha BYMA o TEM de licitación ya contrastada).
 *    Si las dos fuentes fallan, queda el respaldo de este archivo.
 * 5. FCI de liquidez inmediata (Balanz Capital Money Market, clase A,
 *    T+0, pesos). La TNA sale de la cuotaparte CNV vía ArgentinaDatos,
 *    ventana de 7 días corridos. Si falla, queda el respaldo de este archivo.
 * 6. Tasa corporativa en dólares (5% fija).
 *
 * Los baldes de caución sin fila viva no se inventan: quedan en el fallback.
 * El descuento de cheques no se toca: sigue en config.js.
 * Cache: 30 minutos (1800 segundos).
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  bucketCaucionQuotes,
  quotesFromBymaRows,
  quotesFromArgentinaDatosRows
} = require('../caucion-buckets.js');
const { macroBandsFromArgentinaDatos } = require('../macro-vs-letra.js');
const {
  LECAP_VERIFIED_TERMS,
  LECAP_CONFIG_FALLBACK,
  buildLecapCurve,
  lecapDetailsFromReference,
  mergeLecapPrices,
  quoteCalendar,
  tradableLecaps
} = require('../lecap-yields.js');
const { tnaFromCuotapartes } = require('../broker-costs.js');

const BYMA_CAUCIONES_URL = 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/cauciones';
const BYMA_LEBACS_URL = 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/lebacs';
const BYMA_FICHA_URL = 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/bnown/fichatecnica/especies/general';
const DATA912_NOTES_URL = 'https://data912.com/live/arg_notes';
const ARGENTINA_DATOS_CAUCIONES_URL = 'https://api.argentinadatos.com/v1/finanzas/cauciones/ars';
const DEPOSITOS_30_URL = 'https://api.argentinadatos.com/v1/finanzas/tasas/depositos30Dias';
const PLAZO_FIJO_ENTIDADES_URL = 'https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo';
const FCI_HISTORICO_URL = 'https://api.argentinadatos.com/v1/finanzas/fci/fondos/balanz-capital-money-market-clase-a/historico';
const FCI_NOMBRE = 'Balanz Capital Money Market - Clase A';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=60');

  const fallbackRates = {
    caucionByDays: {
      3: 20.5,
      7: 21.5,
      10: 22.0,
      15: 22.5,
      30: 23.5
    },
    plazoFijoTNA: 19.5,
    // Cierre del viernes 23/10/2026, S30N6. Mismo cálculo que lecap-yields.js.
    // Solo se ve si Data912 y BYMA no traen una letra con precio y payoff.
    lecapTNA: 22.96,
    lecapDetails: {
      ticker: "S30N6",
      maturity: "2026-11-30",
      vencimiento: "30/11/2026",
      nombre: "LECAP Vto. 30/11/2026",
      diasAlVencimiento: 35,
      precio: 127.09,
      payoffPor100: 129.89,
      temPct: 2.30,
      tna: 22.96,
      tea: 25.50,
      tir: 25.50,
      fuente: "config"
    },
    lecaps: [],
    usdRateAnnual: 5.0,
    fciTNA: 18.28,
    fciDetails: {
      nombre: FCI_NOMBRE,
      tna: 18.28,
      fecha: '2026-10-22',
      fechaInicio: '2026-10-15',
      dias: 7,
      vcp: 12720.788,
      vcpInicio: 12676.343,
      plazoRescateDias: 0,
      fuente: 'config'
    }
  };

  try {
    const liveRates = { ...fallbackRates, caucionByDays: { ...fallbackRates.caucionByDays } };
    const sourcesChecked = [];

    const [bymaRows, argentinaRows, depositos, entidades, lecapCurve, fciQuote] = await Promise.all([
      fetchBymaCaucionesArs(),
      fetchJson(ARGENTINA_DATOS_CAUCIONES_URL, 3500),
      fetchJson(DEPOSITOS_30_URL, 3500),
      fetchJson(PLAZO_FIJO_ENTIDADES_URL, 3500),
      loadLecapCurve(),
      loadFciQuote()
    ]);

    const bymaQuotes = quotesFromBymaRows(bymaRows);
    const bymaCurve = bucketCaucionQuotes(bymaQuotes, fallbackRates.caucionByDays);
    if (bymaCurve.filledBuckets > 0) {
      liveRates.caucionByDays = bymaCurve.caucionByDays;
      sourcesChecked.push('cauciones_byma');
    } else if (Array.isArray(argentinaRows) && argentinaRows.length > 0) {
      const adCurve = bucketCaucionQuotes(
        quotesFromArgentinaDatosRows(argentinaRows),
        fallbackRates.caucionByDays
      );
      if (adCurve.filledBuckets > 0) {
        liveRates.caucionByDays = adCurve.caucionByDays;
        sourcesChecked.push('cauciones_argentinadatos');
      }
    }

    if (Array.isArray(depositos) && depositos.length > 0) {
      const latest = depositos[depositos.length - 1];
      const tnaPf = parseFloat(latest.valor || latest.tna);
      if (!isNaN(tnaPf) && tnaPf > 15 && tnaPf < 90) {
        liveRates.plazoFijoTNA = parseFloat(tnaPf.toFixed(1));
        sourcesChecked.push('plazofijo_live');
      }
    }

    const macroBands = macroBandsFromArgentinaDatos(entidades);
    if (macroBands) {
      liveRates.macroPlazoFijoBands = macroBands;
      sourcesChecked.push('macro_plazofijo_live');
    }

    const lecapMeta = applyLecapCurve(liveRates, lecapCurve, sourcesChecked);
    if (lecapMeta.source !== 'config') {
      console.info(
        '[rates-api] LECAP',
        lecapMeta.reference.ticker,
        'TNA', lecapMeta.reference.tna,
        'TEA', lecapMeta.reference.tea,
        'TIR', lecapMeta.reference.tir,
        'precio', lecapMeta.reference.precio,
        'paga', lecapMeta.reference.payoffPor100,
        'dias', lecapMeta.reference.dias,
        'fuente', lecapMeta.source,
        'curva', lecapCurve.letters.map((letter) => `${letter.ticker} ${letter.tna}`).join(', ')
      );
    } else {
      console.warn('[rates-api] LECAP en respaldo de config');
    }

    if (fciQuote) {
      liveRates.fciTNA = fciQuote.tna;
      liveRates.fciDetails = {
        nombre: FCI_NOMBRE,
        tna: fciQuote.tna,
        fecha: fciQuote.fecha,
        fechaInicio: fciQuote.fechaInicio,
        dias: fciQuote.dias,
        vcp: fciQuote.vcp,
        vcpInicio: fciQuote.vcpInicio,
        plazoRescateDias: 0,
        fuente: 'cnv'
      };
      sourcesChecked.push('fci_cnv');
      console.info(
        '[rates-api] FCI',
        FCI_NOMBRE,
        'TNA', fciQuote.tna,
        'dias', fciQuote.dias,
        fciQuote.fechaInicio, '→', fciQuote.fecha,
        'vcp', fciQuote.vcpInicio, '→', fciQuote.vcp
      );
    } else {
      console.warn('[rates-api] FCI en respaldo de config');
    }

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      cacheDurationMinutes: 30,
      sourcesChecked,
      lecap: lecapMeta,
      rates: liveRates
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      timestamp: new Date().toISOString(),
      cacheDurationMinutes: 30,
      error: error.message,
      lecap: { source: 'config', sourceLabel: 'config', marketOpen: false },
      rates: fallbackRates
    });
  }
}

async function loadFciQuote() {
  try {
    const data = await fetchJson(FCI_HISTORICO_URL, 8000);
    const historico = data && Array.isArray(data.historico) ? data.historico : [];
    return tnaFromCuotapartes(historico, 7);
  } catch (error) {
    console.warn('[rates-api] FCI no disponible:', error.message);
    return null;
  }
}

async function fetchBymaCaucionesArs() {
  try {
    const res = await fetch(BYMA_CAUCIONES_URL, {
      method: 'POST',
      headers: bymaHeaders(),
      body: '{}',
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch (error) {
    console.warn('[rates-api] BYMA cauciones no disponible:', error.message);
    return null;
  }
}

async function fetchJson(url, timeoutMs) {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.warn('[rates-api] Sin datos de', url, error.message);
    return null;
  }
}

function applyLecapCurve(liveRates, curve, sourcesChecked) {
  if (!curve || !curve.reference) {
    const calendar = quoteCalendar(new Date());
    const menu = tradableLecaps(LECAP_CONFIG_FALLBACK, new Date());
    liveRates.lecaps = menu;
    const reference = menu.find((letter) => letter.diasHoy >= 30) || menu[0] || null;
    if (reference) {
      liveRates.lecapTNA = reference.tna;
      liveRates.lecapDetails = lecapDetailsFromReference({
        ...reference,
        dias: reference.diasHoy
      });
    }
    return {
      source: 'config',
      sourceLabel: 'config',
      marketOpen: calendar.marketOpen,
      tradeDate: calendar.tradeDate,
      settlement: calendar.settlement,
      reference: reference
    };
  }
  liveRates.lecapTNA = curve.reference.tna;
  liveRates.lecapDetails = lecapDetailsFromReference(curve.reference);
  liveRates.lecaps = curve.letters;
  sourcesChecked.push(curve.source === 'byma' ? 'lecap_byma' : 'lecap_data912');
  return {
    source: curve.source,
    sourceLabel: curve.sourceLabel,
    marketOpen: curve.marketOpen,
    tradeDate: curve.tradeDate,
    settlement: curve.settlement,
    reference: curve.reference
  };
}

async function loadLecapCurve() {
  try {
    const known = Object.keys(LECAP_VERIFIED_TERMS);
    const [notes, bymaRows, knownFichas] = await Promise.all([
      fetchData912Notes(),
      fetchBymaLebacs(),
      Promise.all(known.map(async (ticker) => [ticker, await fetchBymaFicha(ticker)]))
    ]);
    const data912Rows = notes && Array.isArray(notes.rows) ? notes.rows : [];
    const bymaList = Array.isArray(bymaRows) ? bymaRows : [];
    const fichas = {};
    knownFichas.forEach(([ticker, row]) => {
      fichas[ticker] = row;
    });
    const extra = Object.keys(mergeLecapPrices(data912Rows, bymaList))
      .filter((ticker) => !fichas[ticker])
      .slice(0, 6);
    if (extra.length) {
      const extraFichas = await Promise.all(extra.map(async (ticker) => [ticker, await fetchBymaFicha(ticker)]));
      extraFichas.forEach(([ticker, row]) => {
        fichas[ticker] = row;
      });
    }
    return buildLecapCurve({
      now: new Date(),
      data912Rows,
      bymaRows: bymaList,
      fichas
    });
  } catch (error) {
    console.warn('[rates-api] LECAP no disponible:', error.message);
    return null;
  }
}

async function fetchData912Notes() {
  try {
    const res = await fetch(DATA912_NOTES_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { rows: Array.isArray(data) ? data : [], asOf: res.headers.get('last-modified') };
  } catch (error) {
    console.warn('[rates-api] Data912 letras no disponible:', error.message);
    return null;
  }
}

async function fetchBymaLebacs() {
  try {
    const res = await fetch(BYMA_LEBACS_URL, {
      method: 'POST',
      headers: bymaHeaders(),
      body: JSON.stringify({ page_size: 700 }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data)) return data;
    return Array.isArray(data && data.data) ? data.data : null;
  } catch (error) {
    console.warn('[rates-api] BYMA lebacs no disponible:', error.message);
    return null;
  }
}

async function fetchBymaFicha(ticker) {
  try {
    const res = await fetch(BYMA_FICHA_URL, {
      method: 'POST',
      headers: bymaHeaders(),
      body: JSON.stringify({ symbol: ticker }),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const row = data && Array.isArray(data.data) ? data.data[0] : null;
    return row || null;
  } catch (error) {
    console.warn('[rates-api] Ficha BYMA', ticker, error.message);
    return null;
  }
}

function bymaHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Origin': 'https://open.bymadata.com.ar',
    'Referer': 'https://open.bymadata.com.ar/',
    'User-Agent': 'Mozilla/5.0'
  };
}
