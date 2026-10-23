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
 * 4. Tasa / TIR de la LECAP corta vía Rava / OpenBYMA (sin ampliar el scrapeo).
 * 5. Tasa corporativa en dólares (5% fija).
 *
 * Los baldes de caución sin fila viva no se inventan: quedan en el fallback.
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

const BYMA_CAUCIONES_URL = 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/cauciones';
const ARGENTINA_DATOS_CAUCIONES_URL = 'https://api.argentinadatos.com/v1/finanzas/cauciones/ars';
const DEPOSITOS_30_URL = 'https://api.argentinadatos.com/v1/finanzas/tasas/depositos30Dias';
const PLAZO_FIJO_ENTIDADES_URL = 'https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo';

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
    lecapTNA: 26.5,
    lecapDetails: {
      ticker: "S30N6",
      vencimiento: "30/11/2026",
      nombre: "LECAP Vto. Noviembre 2026"
    },
    usdRateAnnual: 5.0
  };

  try {
    const liveRates = { ...fallbackRates, caucionByDays: { ...fallbackRates.caucionByDays } };
    const sourcesChecked = [];

    const [bymaRows, argentinaRows, depositos, entidades, lecapHtml] = await Promise.all([
      fetchBymaCaucionesArs(),
      fetchJson(ARGENTINA_DATOS_CAUCIONES_URL, 3500),
      fetchJson(DEPOSITOS_30_URL, 3500),
      fetchJson(PLAZO_FIJO_ENTIDADES_URL, 3500),
      fetchText('https://clasico.rava.com/lib/let/let.php', 2500)
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

    if (lecapHtml) {
      const tirMatches = [...lecapHtml.matchAll(/(S\d{2}[A-Z]\d{1,2})[^<]*?(\d{2,3}[.,]\d{1,2})%/gi)];
      if (tirMatches.length > 0) {
        const detectedTicker = tirMatches[0][1].toUpperCase();
        const parsedTir = parseFloat(tirMatches[0][2].replace(',', '.'));
        if (!isNaN(parsedTir) && parsedTir > 15 && parsedTir < 90) {
          liveRates.lecapTNA = parseFloat(parsedTir.toFixed(1));
          liveRates.lecapDetails = {
            ticker: detectedTicker,
            nombre: `LECAP ${detectedTicker}`
          };
          sourcesChecked.push('lecap_rava_live');
        }
      }
    }

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      cacheDurationMinutes: 30,
      sourcesChecked,
      rates: liveRates
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      timestamp: new Date().toISOString(),
      cacheDurationMinutes: 30,
      error: error.message,
      rates: fallbackRates
    });
  }
}

async function fetchBymaCaucionesArs() {
  try {
    const res = await fetch(BYMA_CAUCIONES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://open.bymadata.com.ar',
        'Referer': 'https://open.bymadata.com.ar/',
        'User-Agent': 'Mozilla/5.0'
      },
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

async function fetchText(url, timeoutMs) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (error) {
    console.warn('[rates-api] Fallback en lecap:', error.message);
    return null;
  }
}
