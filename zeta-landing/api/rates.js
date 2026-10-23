/**
 * VERCEL SERVERLESS FUNCTION: /api/rates
 * 
 * Extrae y consolida en tiempo real:
 * 1. Cauciones Bursátiles en Pesos (3d, 7d, 10d, 15d, 30d) vía ArgentinaDatos / BYMA.
 * 2. Tasa de Plazo Fijo bancario (BCRA).
 * 3. Tasa / TIR de la LECAP corta de mayor liquidez vía Rava / OpenBYMA.
 * 4. Tasa corporativa en Dólares (5% fija).
 * 
 * Cache: Configurado a 30 minutos (1800 segundos) para optimizar rendimiento y cuotas.
 */

export default async function handler(req, res) {
  // Encabezados CORS y Cache de 30 minutos (1800s)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=60');

  // Valores de respaldo (Fallback) basados en el régimen de tasas actual
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
    let liveRates = { ...fallbackRates };
    let sourcesChecked = [];

    // ==========================================
    // 1. EXTRAER CAUCIONES (ArgentinaDatos / BYMA)
    // ==========================================
    try {
      const caucionRes = await fetch('https://api.argentinadatos.com/v1/finanzas/cauciones/ars', {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3500)
      });

      if (caucionRes.ok) {
        const caucionesData = await caucionRes.json();
        // caucionesData suele contener cotizaciones por plazo (dias) y tna
        if (Array.isArray(caucionesData) && caucionesData.length > 0) {
          const mapDays = { 3: 35.0, 7: 36.5, 10: 37.0, 15: 37.5, 30: 38.0 };
          
          caucionesData.forEach(item => {
            const dias = parseInt(item.plazo || item.dias, 10);
            const tna = parseFloat(item.tna || item.tasaPromedio || item.ultimo);
            if (!isNaN(dias) && !isNaN(tna) && tna > 10 && tna < 120) {
              if (dias >= 1 && dias <= 3) mapDays[3] = tna;
              else if (dias >= 4 && dias <= 7) mapDays[7] = tna;
              else if (dias >= 8 && dias <= 10) mapDays[10] = tna;
              else if (dias >= 11 && dias <= 15) mapDays[15] = tna;
              else if (dias >= 16 && dias <= 32) mapDays[30] = tna;
            }
          });

          liveRates.caucionByDays = mapDays;
          sourcesChecked.push('cauciones_live');
        }
      }
    } catch (e) {
      console.warn('[rates-api] Fallback en cauciones:', e.message);
    }

    // ==========================================
    // 2. EXTRAER PLAZO FIJO (Estadísticas BCRA)
    // ==========================================
    try {
      const pfRes = await fetch('https://api.argentinadatos.com/v1/finanzas/tasas/depositos30Dias', {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3500)
      });

      if (pfRes.ok) {
        const pfData = await pfRes.json();
        if (Array.isArray(pfData) && pfData.length > 0) {
          const latest = pfData[pfData.length - 1];
          const tnaPf = parseFloat(latest.valor || latest.tna);
          if (!isNaN(tnaPf) && tnaPf > 15 && tnaPf < 90) {
            liveRates.plazoFijoTNA = parseFloat(tnaPf.toFixed(1));
            sourcesChecked.push('plazofijo_live');
          }
        }
      }
    } catch (e) {
      console.warn('[rates-api] Fallback en plazo fijo:', e.message);
    }

    // ==========================================
    // 3. EXTRAER LECAP CORTA (TIR de mercado secundario)
    // ==========================================
    try {
      // Consultamos panel de letras en Rava / OpenBYMA
      const lecapRes = await fetch('https://clasico.rava.com/lib/let/let.php', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(4000)
      });

      if (lecapRes.ok) {
        const html = await lecapRes.text();
        // Regex para capturar tanto el TICKER de la letra (ej. S28F5) como su TIR
        const tirMatches = [...html.matchAll(/(S\d{2}[A-Z]\d{1,2})[^<]*?(\d{2,3}[.,]\d{1,2})%/gi)];
        
        if (tirMatches && tirMatches.length > 0) {
          const detectedTicker = tirMatches[0][1].toUpperCase();
          const rawTir = tirMatches[0][2].replace(',', '.');
          const parsedTir = parseFloat(rawTir);
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
    } catch (e) {
      console.warn('[rates-api] Fallback en lecap:', e.message);
    }

    // Respuesta final consolidada
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      cacheDurationMinutes: 30,
      sourcesChecked,
      rates: liveRates
    });

  } catch (error) {
    // Si ocurre un error general, devolver el fallback con status 200 para no romper la web
    return res.status(200).json({
      success: false,
      timestamp: new Date().toISOString(),
      cacheDurationMinutes: 30,
      error: error.message,
      rates: fallbackRates
    });
  }
}
