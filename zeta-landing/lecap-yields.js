/**
 * LECAP en pesos: precio de mercado → TNA / TEA / TIR.
 *
 * Precio (lo que se refresca en la rueda):
 *   1. Data912 GET /live/arg_notes. Cache de ~30 s y último operado aun
 *      con el mercado cerrado. El 24/10/2026 (sábado) BYMA /free/lebacs
 *      tenía trade = 0 en todas las LECAP en pesos; Data912 seguía en el
 *      cierre del viernes (S30N6 127,09).
 *   2. BYMA POST /free/lebacs, liquidación 24 hs (settlementType "2"),
 *      solo si Data912 no trae esa especie. Misma idea que la caución:
 *      trade, si no vwap, si no el medio de bid y offer, si no el cierre.
 *
 * Payoff (no es 100). La LECAP capitaliza una TEM contractual con base
 * 30/360 y paga un solo flujo al vencimiento:
 *
 *   payoff = 100 * (1 + TEM) ^ (días30/360 / 30)
 *
 * La TEM sale de la ficha BYMA
 * POST /bnown/fichatecnica/especies/general. Si la ficha no escribe el
 * número, se usa la TEM de licitación ya contrastada contra el flujo
 * publicado (Rava / compararbonos / mercadosargentina), no un VN 100.
 *
 *   S30O6  TEM 2,55%  emite 31/10/2025  vence 30/10/2026  paga 135,28
 *   S13N6  TEM 2,10%  emite 30/06/2026  vence 13/11/2026  paga 109,65
 *   S30N6  TEM 2,30%  emite 15/12/2025  vence 30/11/2026  paga 129,89
 *   S29E7  TEM 2,25%  emite 31/08/2026  vence 29/01/2027  paga 111,68
 *
 * TNA y TEA se calculan con el payoff sin redondear (el valor técnico) y
 * el precio con los decimales de la fuente. El día cuenta desde la
 * liquidación 24 hs (próximo día hábil con liquidación) hasta el vencimiento,
 * base 365. En una letra con un solo pago, la TIR efectiva anual es la TEA.
 *
 *   TNA = (payoff / precio - 1) * 365 / días * 100
 *   TEA = TIR = ((payoff / precio) ^ (365 / días) - 1) * 100
 *
 * La curva trae cada letra con precio y payoff. La de referencia —la que
 * usa la comparación contra el plazo fijo— es la más corta que llega a
 * 30 días, porque un plazo fijo tradicional no existe por debajo de eso.
 * Si ninguna llega, queda la de vencimiento más cercano. Si no hay ninguna,
 * sigue el respaldo de config.js.
 */

var LECAP_TICKER = /^S\d{2}[A-Z]\d$/;

// Calendario BYMA 2026 (byma.com.ar/mercado/calendario-bursatil).
// Cierre: sin negociación ni liquidación. Sin liquidación: hay rueda,
// pero un T+1 no puede caer ese día.
var BYMA_CLOSED = {
  '2026-01-01': 1,
  '2026-02-16': 1,
  '2026-02-17': 1,
  '2026-03-24': 1,
  '2026-04-02': 1,
  '2026-04-03': 1,
  '2026-05-01': 1,
  '2026-05-25': 1,
  '2026-06-15': 1,
  '2026-07-09': 1,
  '2026-08-17': 1,
  '2026-10-12': 1,
  '2026-11-09': 1,
  '2026-11-10': 1,
  '2026-11-23': 1,
  '2026-12-08': 1,
  '2026-12-25': 1,
  '2026-12-31': 1,
  '2027-01-01': 1
};

var BYMA_NO_SETTLEMENT = {
  '2026-03-23': 1,
  '2026-07-10': 1,
  '2026-11-06': 1,
  '2026-12-07': 1,
  '2026-12-24': 1
};

// TEM de licitación cuando la ficha de BYMA no trae el porcentaje.
// El payoff redondeado a centavos reproduce el flujo publicado.
var LECAP_VERIFIED_TERMS = {
  S30O6: { issue: '2025-10-31', maturity: '2026-10-30', temPct: 2.55 },
  S13N6: { issue: '2026-06-30', maturity: '2026-11-13', temPct: 2.10 },
  S30N6: { issue: '2025-12-15', maturity: '2026-11-30', temPct: 2.30 },
  S29E7: { issue: '2026-08-31', maturity: '2027-01-29', temPct: 2.25 }
};

var LECAP_SOURCE_LABEL = {
  data912: 'Data912',
  byma: 'BYMA',
  config: 'config'
};

function lecapFinite(value) {
  var n = Number(value);
  return isFinite(n) ? n : null;
}

function lecapRound(value, digits) {
  var factor = Math.pow(10, digits);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isLecapTicker(symbol) {
  return LECAP_TICKER.test(String(symbol || '').toUpperCase());
}

function shiftIsoDate(iso, days) {
  var ms = Date.parse(iso + 'T00:00:00Z');
  if (!isFinite(ms)) return null;
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

function isoWeekday(iso) {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}

function isBymaSessionDay(iso) {
  var day = isoWeekday(iso);
  if (day === 0 || day === 6) return false;
  return !BYMA_CLOSED[iso];
}

function isBymaSettlementDay(iso) {
  return isBymaSessionDay(iso) && !BYMA_NO_SETTLEMENT[iso];
}

function previousSessionDay(iso) {
  var cursor = iso;
  for (var i = 0; i < 14; i++) {
    if (isBymaSessionDay(cursor)) return cursor;
    cursor = shiftIsoDate(cursor, -1);
  }
  return iso;
}

function nextSettlementDay(tradeIso) {
  var cursor = shiftIsoDate(tradeIso, 1);
  for (var i = 0; i < 16; i++) {
    if (isBymaSettlementDay(cursor)) return cursor;
    cursor = shiftIsoDate(cursor, 1);
  }
  return cursor;
}

function artParts(date) {
  var fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  var bag = {};
  fmt.formatToParts(date).forEach(function (part) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  });
  var hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    iso: bag.year + '-' + bag.month + '-' + bag.day,
    minutes: hour * 60 + Number(bag.minute)
  };
}

/**
 * La liquidación de renta fija en PPT es 24 hs. Fuera de rueda, el precio
 * que queda es el de la última sesión, y los días se cuentan desde la
 * liquidación de esa rueda (no desde el sábado).
 */
function quoteCalendar(now) {
  var art = artParts(now instanceof Date ? now : new Date(now));
  var trade = previousSessionDay(art.iso);
  var beforeOpen = art.minutes < (10 * 60 + 30);
  if (art.iso === trade && beforeOpen) {
    trade = previousSessionDay(shiftIsoDate(art.iso, -1));
  }
  var open = isBymaSessionDay(art.iso) && !beforeOpen && art.minutes < (17 * 60);
  return {
    artDate: art.iso,
    tradeDate: trade,
    settlement: nextSettlementDay(trade),
    marketOpen: open
  };
}

function daysBetweenIso(fromIso, toIso) {
  var from = Date.parse(fromIso + 'T00:00:00Z');
  var to = Date.parse(toIso + 'T00:00:00Z');
  if (!isFinite(from) || !isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}

function parseBymaTimestamp(value) {
  var match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ''));
  return match ? match[1] : null;
}

function parseTemPct(text) {
  var match = /(\d{1,2}[,.]\d{1,3})\s*%/.exec(String(text || ''));
  if (!match) return null;
  var tem = Number(match[1].replace(',', '.'));
  if (!isFinite(tem) || tem <= 0 || tem > 15) return null;
  return tem;
}

function days30360(issueIso, maturityIso) {
  var issue = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issueIso || '');
  var maturity = /^(\d{4})-(\d{2})-(\d{2})$/.exec(maturityIso || '');
  if (!issue || !maturity) return null;
  var d1 = Math.min(Number(issue[3]), 30);
  var d2 = Math.min(Number(maturity[3]), 30);
  return (Number(maturity[1]) - Number(issue[1])) * 360
    + (Number(maturity[2]) - Number(issue[2])) * 30
    + (d2 - d1);
}

function payoffExactFromTem(temPct, issueIso, maturityIso) {
  var days = days30360(issueIso, maturityIso);
  var tem = Number(temPct);
  if (days == null || days <= 0 || !isFinite(tem) || tem <= 0) return null;
  return 100 * Math.pow(1 + tem / 100, days / 30);
}

function formatVencimiento(iso) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!match) return iso || '';
  return match[3] + '/' + match[2] + '/' + match[1];
}

function fichaIsDiscountOrCer(row) {
  var text = String((row && row.interes) || '') + ' ' + String((row && row.denominacion) || '');
  if (/capitalizable/i.test(text)) return false;
  return /CER|descuento/i.test(text);
}

/**
 * Términos contractuales. La ficha pisa emisión, vencimiento y TEM cuando
 * los trae. El catálogo solo completa lo que la ficha omite.
 * Sin TEM no se inventa un payoff de 100.
 */
function resolveLecapTerms(ticker, fichaRow) {
  var symbol = String(ticker || '').toUpperCase();
  if (!isLecapTicker(symbol)) return null;
  var catalog = LECAP_VERIFIED_TERMS[symbol] || null;
  var ficha = fichaRow || null;
  if (ficha && fichaIsDiscountOrCer(ficha) && !catalog) return null;

  var tem = parseTemPct(ficha && ficha.interes);
  var temSource = tem != null ? 'byma_ficha' : null;
  if (tem == null && catalog) {
    tem = catalog.temPct;
    temSource = 'tem_verificada';
  }
  var issue = parseBymaTimestamp(ficha && ficha.fechaEmision) || (catalog && catalog.issue) || null;
  var maturity = parseBymaTimestamp(ficha && ficha.fechaVencimiento) || (catalog && catalog.maturity) || null;
  if (tem == null || !issue || !maturity) return null;

  var exact = payoffExactFromTem(tem, issue, maturity);
  if (exact == null) return null;
  return {
    ticker: symbol,
    temPct: tem,
    temSource: temSource,
    issue: issue,
    maturity: maturity,
    payoffExact: exact,
    payoffPor100: lecapRound(exact, 2)
  };
}

function usableLecapPrice(value) {
  var price = lecapFinite(value);
  if (price == null || price < 80 || price > 400) return null;
  return price;
}

function priceFromData912Row(row) {
  if (!row || !isLecapTicker(row.symbol)) return null;
  var last = usableLecapPrice(row.c);
  if (last == null) {
    var bid = lecapFinite(row.px_bid);
    var ask = lecapFinite(row.px_ask);
    if (bid != null && ask != null && bid > 0 && ask > 0) last = usableLecapPrice((bid + ask) / 2);
  }
  if (last == null) return null;
  return {
    ticker: String(row.symbol).toUpperCase(),
    price: last,
    volume: lecapFinite(row.v) || 0,
    source: 'data912'
  };
}

function priceFromBymaLebacRow(row) {
  if (!row || String(row.settlementType) !== '2') return null;
  if (row.denominationCcy && row.denominationCcy !== 'ARS') return null;
  if (!isLecapTicker(row.symbol)) return null;
  var trade = lecapFinite(row.trade);
  var vwap = lecapFinite(row.vwap);
  var bid = lecapFinite(row.bidPrice);
  var offer = lecapFinite(row.offerPrice);
  var close = lecapFinite(row.closingPrice);
  var previous = lecapFinite(row.previousClosingPrice);
  var raw = null;
  if (trade != null && trade > 0) raw = trade;
  else if (vwap != null && vwap > 0) raw = vwap;
  else if (bid != null && bid > 0 && offer != null && offer > 0) raw = (bid + offer) / 2;
  else if (close != null && close > 0) raw = close;
  else if (previous != null && previous > 0) raw = previous;
  var price = usableLecapPrice(raw);
  if (price == null) return null;
  var volume = lecapFinite(row.tradeVolume);
  if (volume == null || volume <= 0) volume = lecapFinite(row.volume) || 0;
  return {
    ticker: String(row.symbol).toUpperCase(),
    price: price,
    volume: volume,
    source: 'byma'
  };
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

/**
 * Data912 gana por especie. BYMA solo completa las que Data912 no trae
 * con un precio usable. Un trade en 0 no pisa el último operado.
 */
function mergeLecapPrices(data912Rows, bymaRows) {
  var byTicker = {};
  rowsOf(data912Rows).forEach(function (row) {
    var quote = priceFromData912Row(row);
    if (!quote) return;
    byTicker[quote.ticker] = quote;
  });
  rowsOf(bymaRows).forEach(function (row) {
    var quote = priceFromBymaLebacRow(row);
    if (!quote || byTicker[quote.ticker]) return;
    byTicker[quote.ticker] = quote;
  });
  return byTicker;
}

function yieldFromPrice(price, payoffExact, days) {
  if (!(price > 0) || !(payoffExact > 0) || !(days > 0)) return null;
  if (payoffExact <= price) return null;
  var ratio = payoffExact / price;
  var tna = (ratio - 1) * (365 / days) * 100;
  var tea = (Math.pow(ratio, 365 / days) - 1) * 100;
  if (!(tna > 0 && tna < 80 && tea > 0 && tea < 150)) return null;
  var teaRounded = lecapRound(tea, 2);
  return {
    tna: lecapRound(tna, 2),
    tea: teaRounded,
    tir: teaRounded
  };
}

function buildLecapCurve(input) {
  var source = input || {};
  var now = source.now ? new Date(source.now) : new Date();
  if (isNaN(now.getTime())) return null;
  var calendar = quoteCalendar(now);
  var prices = mergeLecapPrices(source.data912Rows, source.bymaRows);
  var fichas = source.fichas || {};
  var letters = [];

  Object.keys(prices).forEach(function (ticker) {
    var terms = resolveLecapTerms(ticker, fichas[ticker]);
    if (!terms) return;
    var days = daysBetweenIso(calendar.settlement, terms.maturity);
    var yields = yieldFromPrice(prices[ticker].price, terms.payoffExact, days);
    if (!yields) return;
    letters.push({
      ticker: ticker,
      precio: lecapRound(prices[ticker].price, 3),
      volumen: prices[ticker].volume,
      fuente: prices[ticker].source,
      temPct: terms.temPct,
      temSource: terms.temSource,
      emision: terms.issue,
      maturity: terms.maturity,
      vencimiento: formatVencimiento(terms.maturity),
      payoffPor100: terms.payoffPor100,
      settlement: calendar.settlement,
      dias: days,
      tna: yields.tna,
      tea: yields.tea,
      tir: yields.tir
    });
  });

  letters.sort(function (a, b) {
    if (a.dias !== b.dias) return a.dias - b.dias;
    return (b.volumen || 0) - (a.volumen || 0);
  });
  if (!letters.length) return null;

  var minDays = lecapFinite(source.referenceMinDays);
  if (minDays == null) minDays = 30;
  var reference = null;
  for (var i = 0; i < letters.length; i++) {
    if (letters[i].dias >= minDays) {
      reference = letters[i];
      break;
    }
  }
  if (!reference) reference = letters[0];
  return {
    letters: letters,
    reference: reference,
    source: reference.fuente,
    sourceLabel: LECAP_SOURCE_LABEL[reference.fuente] || reference.fuente,
    marketOpen: calendar.marketOpen,
    tradeDate: calendar.tradeDate,
    settlement: calendar.settlement
  };
}

function lecapDetailsFromReference(reference) {
  return {
    ticker: reference.ticker,
    vencimiento: reference.vencimiento,
    nombre: 'LECAP Vto. ' + reference.vencimiento,
    diasAlVencimiento: reference.dias,
    precio: reference.precio,
    payoffPor100: reference.payoffPor100,
    temPct: reference.temPct,
    tna: reference.tna,
    tea: reference.tea,
    tir: reference.tir,
    settlement: reference.settlement,
    maturity: reference.maturity,
    fuente: reference.fuente
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LECAP_VERIFIED_TERMS: LECAP_VERIFIED_TERMS,
    LECAP_SOURCE_LABEL: LECAP_SOURCE_LABEL,
    isLecapTicker: isLecapTicker,
    quoteCalendar: quoteCalendar,
    parseTemPct: parseTemPct,
    payoffExactFromTem: payoffExactFromTem,
    resolveLecapTerms: resolveLecapTerms,
    priceFromBymaLebacRow: priceFromBymaLebacRow,
    mergeLecapPrices: mergeLecapPrices,
    yieldFromPrice: yieldFromPrice,
    buildLecapCurve: buildLecapCurve,
    lecapDetailsFromReference: lecapDetailsFromReference,
    formatVencimiento: formatVencimiento
  };
}
