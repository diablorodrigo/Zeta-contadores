/**
 * Curva de caución colocadora ARS → baldes del simulador (3 / 7 / 10 / 15 / 30).
 *
 * Fuente primaria: POST BYMA open.bymadata `.../free/cauciones` (filas ARS).
 * `trade`, `vwap`, `bidPrice` y `offerPrice` vienen en TNA decimal (0.212 = 21,2%).
 * Se usa `trade` si es > 0, si no `vwap`, si no el promedio de punta bid y offer.
 *
 * Cada fila cae en el balde más cercano si está a lo sumo a 3 días.
 * Si dos filas caen en el mismo balde, gana la de plazo más cercano y, en empate, la de mayor volumen.
 * Los baldes sin fila viva conservan el fallback de config.js.
 *
 * ArgentinaDatos `/v1/finanzas/cauciones/ars` es un snapshot de la rueda (IOL).
 * Cuando el worker no tiene títulos devuelve []. Esas filas, si aparecen, ya vienen en puntos de TNA.
 */

var CAUCION_BUCKETS = [3, 7, 10, 15, 30];
var CAUCION_BUCKET_WINDOW_DAYS = 3;

function finiteOrNull(value) {
  var n = Number(value);
  return isFinite(n) ? n : null;
}

function tnaPointsFromBymaRow(row) {
  if (!row) return null;
  var trade = finiteOrNull(row.trade);
  var vwap = finiteOrNull(row.vwap);
  var bid = finiteOrNull(row.bidPrice);
  var offer = finiteOrNull(row.offerPrice);
  var decimal = null;
  if (trade != null && trade > 0) decimal = trade;
  else if (vwap != null && vwap > 0) decimal = vwap;
  else if (bid != null && bid > 0 && offer != null && offer > 0) decimal = (bid + offer) / 2;
  if (decimal == null) return null;
  var points = decimal * 100;
  if (points < 5 || points > 80) return null;
  return Math.round(points * 10) / 10;
}

function tnaPointsFromArgentinaDatosRow(row) {
  if (!row) return null;
  var raw = finiteOrNull(row.tna != null ? row.tna : (row.tasaActual != null ? row.tasaActual : (row.tasaPromedio != null ? row.tasaPromedio : row.ultimo)));
  if (raw == null || raw <= 10 || raw >= 120) return null;
  return Math.round(raw * 10) / 10;
}

function nearestCaucionBucket(days) {
  var best = null;
  var bestDelta = Infinity;
  for (var i = 0; i < CAUCION_BUCKETS.length; i++) {
    var delta = Math.abs(days - CAUCION_BUCKETS[i]);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = CAUCION_BUCKETS[i];
    }
  }
  if (best == null || bestDelta > CAUCION_BUCKET_WINDOW_DAYS) return null;
  return best;
}

function bucketCaucionQuotes(quotes, fallback) {
  var out = {};
  var base = fallback || {};
  for (var i = 0; i < CAUCION_BUCKETS.length; i++) {
    var key = CAUCION_BUCKETS[i];
    var seed = finiteOrNull(base[key]);
    if (seed != null) out[key] = seed;
  }

  var bestByBucket = {};
  (quotes || []).forEach(function (quote) {
    if (!quote || quote.tna == null || quote.days == null) return;
    var bucket = nearestCaucionBucket(quote.days);
    if (bucket == null) return;
    var delta = Math.abs(quote.days - bucket);
    var volume = finiteOrNull(quote.volume) || 0;
    var current = bestByBucket[bucket];
    if (!current || delta < current.delta || (delta === current.delta && volume > current.volume)) {
      bestByBucket[bucket] = { tna: quote.tna, delta: delta, volume: volume };
    }
  });

  var filled = 0;
  CAUCION_BUCKETS.forEach(function (bucket) {
    if (!bestByBucket[bucket]) return;
    out[bucket] = bestByBucket[bucket].tna;
    filled += 1;
  });

  return { caucionByDays: out, filledBuckets: filled };
}

function quotesFromBymaRows(rows) {
  var quotes = [];
  if (!Array.isArray(rows)) return quotes;
  rows.forEach(function (row) {
    if (!row || row.denominationCcy !== 'ARS') return;
    var days = finiteOrNull(row.daysToMaturity);
    var tna = tnaPointsFromBymaRow(row);
    if (days == null || days <= 0 || tna == null) return;
    quotes.push({
      days: days,
      tna: tna,
      volume: finiteOrNull(row.tradeVolume) || 0
    });
  });
  return quotes;
}

function quotesFromArgentinaDatosRows(rows) {
  var quotes = [];
  if (!Array.isArray(rows)) return quotes;
  rows.forEach(function (row) {
    var days = finiteOrNull(row && (row.plazo != null ? row.plazo : row.dias));
    var tna = tnaPointsFromArgentinaDatosRow(row);
    if (days == null || days <= 0 || tna == null) return;
    quotes.push({ days: days, tna: tna, volume: finiteOrNull(row.montoContado) || 0 });
  });
  return quotes;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CAUCION_BUCKETS: CAUCION_BUCKETS,
    CAUCION_BUCKET_WINDOW_DAYS: CAUCION_BUCKET_WINDOW_DAYS,
    tnaPointsFromBymaRow: tnaPointsFromBymaRow,
    bucketCaucionQuotes: bucketCaucionQuotes,
    quotesFromBymaRows: quotesFromBymaRows,
    quotesFromArgentinaDatosRows: quotesFromArgentinaDatosRows
  };
}
