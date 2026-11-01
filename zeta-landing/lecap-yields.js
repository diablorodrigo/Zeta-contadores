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
 * La curva trae cada letra con precio y payoff. La de referencia de la
 * tarjeta LECAP (la más corta que llega a 30 días de liquidación) sigue
 * siendo el default de esa tarjeta. La comparación contra el plazo fijo
 * no queda atada a esa letra: pickLecapForPlazo elige, para el plazo
 * pedido, la vigente cuyo vencimiento cae más cerca. Los días de ese
 * calce se cuentan de hoy (ART) al vencimiento real. La TNA publicada
 * sigue saliendo de la liquidación 24 hs y no se recalcula.
 * Si no hay ninguna letra, sigue el respaldo de config.js. Una letra
 * con vencimiento anterior a hoy no entra.
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

// Respaldo si Data912 y BYMA no traen precio. Mismos números que config.js
// (cierre del 23/10/2026). El menú descarta la que ya venció: no se usa el
// campo dias, que es una foto de aquella liquidación.
var LECAP_CONFIG_FALLBACK = [
  { ticker: 'S30O6', tna: 19.55, tea: 21.57, tir: 21.57, dias: 4, maturity: '2026-10-30', vencimiento: '30/10/2026', precio: 134.989, payoffPor100: 135.28, temPct: 2.55, fuente: 'config' },
  { ticker: 'S13N6', tna: 22.75, tea: 25.38, tir: 25.38, dias: 18, maturity: '2026-11-13', vencimiento: '13/11/2026', precio: 108.435, payoffPor100: 109.65, temPct: 2.10, fuente: 'config' },
  { ticker: 'S30N6', tna: 22.96, tea: 25.50, tir: 25.50, dias: 35, maturity: '2026-11-30', vencimiento: '30/11/2026', precio: 127.09, payoffPor100: 129.89, temPct: 2.30, fuente: 'config' },
  { ticker: 'S29E7', tna: 24.73, tea: 27.08, tir: 27.08, dias: 95, maturity: '2027-01-29', vencimiento: '29/01/2027', precio: 104.932, payoffPor100: 111.68, temPct: 2.25, fuente: 'config' }
];

// Diferencia máxima, en días corridos, para tratar el calce como comparable.
var LECAP_MAX_GAP_DAYS = 15;

var LECAP_PICK_CRITERION = 'Modo por plazo: entre las letras que todavía no vencieron, se elige la de vencimiento más cercano a los días pedidos. Los días corren de hoy al vencimiento real. Si dos quedan a la misma distancia, queda la que no se pasa. Calza si la diferencia es de hasta 15 días. Si no calza, no se compara contra esa letra como si fuera el plazo pedido.';

var LECAP_LETTER_MODE = 'Modo por letra: el plazo es la cantidad de días de hoy al vencimiento de la letra elegida. La TNA neta, los costos y el plazo fijo usan esos días.';

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
    var diasHoy = daysBetweenIso(calendar.artDate, terms.maturity);
    if (!(diasHoy >= 1)) return;
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
      diasHoy: diasHoy,
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
    if (letters[i].diasHoy >= minDays) {
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

function lecapTodayIso(now) {
  if (typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now)) return now;
  var date = now instanceof Date ? now : new Date(now || Date.now());
  if (isNaN(date.getTime())) return null;
  return artParts(date).iso;
}

function maturityIsoOf(letter) {
  if (!letter) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(letter.maturity || '')) return letter.maturity;
  var match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(letter.vencimiento || ''));
  if (!match) return null;
  return match[3] + '-' + match[2] + '-' + match[1];
}

function tradableLecaps(letters, now) {
  var today = lecapTodayIso(now || new Date());
  if (!today) return [];
  var menu = [];
  (letters || []).forEach(function (letter) {
    var maturity = maturityIsoOf(letter);
    if (!maturity) return;
    var diasHoy = daysBetweenIso(today, maturity);
    if (!(diasHoy >= 1)) return;
    var copy = {};
    Object.keys(letter).forEach(function (key) {
      copy[key] = letter[key];
    });
    copy.ticker = String(letter.ticker || '').toUpperCase();
    copy.maturity = maturity;
    copy.vencimiento = letter.vencimiento || formatVencimiento(maturity);
    copy.diasHoy = diasHoy;
    menu.push(copy);
  });
  menu.sort(function (a, b) {
    if (a.diasHoy !== b.diasHoy) return a.diasHoy - b.diasHoy;
    return String(a.ticker).localeCompare(String(b.ticker));
  });
  return menu;
}

function preferLecap(candidate, incumbent, plazo) {
  var gapC = Math.abs(candidate.diasHoy - plazo);
  var gapI = Math.abs(incumbent.diasHoy - plazo);
  if (gapC !== gapI) return gapC < gapI;
  var withinC = candidate.diasHoy <= plazo;
  var withinI = incumbent.diasHoy <= plazo;
  if (withinC !== withinI) return withinC;
  if (candidate.diasHoy !== incumbent.diasHoy) return candidate.diasHoy > incumbent.diasHoy;
  return String(candidate.ticker) < String(incumbent.ticker);
}

/**
 * Elige la letra del plazo pedido.
 * Hoy es la fecha ART (o la que se inyecte). Se descarta vencimiento < hoy.
 * Gana la de menor |días al vencimiento − plazo|. Empate: la que no se pasa.
 * fit es false si esa diferencia supera maxGapDays (15).
 */
function pickLecapForPlazo(letters, plazoDays, options) {
  var opts = options || {};
  var maxGap = lecapFinite(opts.maxGapDays);
  if (maxGap == null || maxGap < 0) maxGap = LECAP_MAX_GAP_DAYS;
  var today = lecapTodayIso(opts.today || new Date());
  var menu = tradableLecaps(letters, today);
  var plazo = Math.round(Number(plazoDays));
  var base = {
    menu: menu,
    letter: null,
    plazo: isFinite(plazo) ? plazo : null,
    gapDays: null,
    absGap: null,
    fit: false,
    manual: false,
    maxGapDays: maxGap,
    reason: 'sin-letras',
    criterion: LECAP_PICK_CRITERION,
    today: today
  };
  if (!menu.length || !isFinite(plazo) || plazo < 1) return base;

  var forced = null;
  var ticker = String(opts.ticker || '').toUpperCase();
  if (ticker) {
    for (var i = 0; i < menu.length; i++) {
      if (menu[i].ticker === ticker) forced = menu[i];
    }
  }

  var chosen = forced;
  if (!chosen) {
    chosen = menu[0];
    for (var j = 1; j < menu.length; j++) {
      if (preferLecap(menu[j], chosen, plazo)) chosen = menu[j];
    }
  }

  var gapDays = chosen.diasHoy - plazo;
  var absGap = Math.abs(gapDays);
  return {
    menu: menu,
    letter: chosen,
    plazo: plazo,
    gapDays: gapDays,
    absGap: absGap,
    fit: absGap <= maxGap,
    manual: !!forced,
    maxGapDays: maxGap,
    reason: forced ? (absGap <= maxGap ? 'manual' : 'manual-lejos') : (absGap <= maxGap ? 'calza' : 'lejos'),
    criterion: LECAP_PICK_CRITERION,
    today: today
  };
}

function defaultLecapLetter(menu) {
  var rows = menu || [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].diasHoy >= 30) return rows[i];
  }
  return rows[0] || null;
}

/**
 * Dos modos. "letra": el plazo es diasHoy de la especie elegida.
 * "plazo": el usuario escribió días y se busca la más cercana.
 * Una letra vencida no se puede elegir.
 */
function resolveLecapHorizon(letters, options) {
  var opts = options || {};
  var mode = opts.mode === 'plazo' ? 'plazo' : 'letra';
  var maxGap = lecapFinite(opts.maxGapDays);
  if (maxGap == null || maxGap < 0) maxGap = LECAP_MAX_GAP_DAYS;
  if (mode === 'plazo') {
    var pick = pickLecapForPlazo(letters, opts.plazoDays, opts);
    pick.mode = 'plazo';
    return pick;
  }

  var today = lecapTodayIso(opts.today || new Date());
  var menu = tradableLecaps(letters, today);
  var ticker = String(opts.ticker || '').toUpperCase();
  var letter = null;
  if (ticker) {
    for (var i = 0; i < menu.length; i++) {
      if (menu[i].ticker === ticker) letter = menu[i];
    }
  }
  if (!letter) letter = defaultLecapLetter(menu);
  if (!letter) {
    return {
      mode: 'letra',
      menu: menu,
      letter: null,
      plazo: null,
      gapDays: null,
      absGap: null,
      fit: false,
      manual: false,
      maxGapDays: maxGap,
      reason: 'sin-letras',
      criterion: LECAP_LETTER_MODE,
      today: today
    };
  }
  return {
    mode: 'letra',
    menu: menu,
    letter: letter,
    plazo: letter.diasHoy,
    gapDays: 0,
    absGap: 0,
    fit: true,
    manual: false,
    maxGapDays: maxGap,
    reason: 'por-letra',
    criterion: LECAP_LETTER_MODE,
    today: today
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
    LECAP_CONFIG_FALLBACK: LECAP_CONFIG_FALLBACK,
    LECAP_MAX_GAP_DAYS: LECAP_MAX_GAP_DAYS,
    LECAP_PICK_CRITERION: LECAP_PICK_CRITERION,
    LECAP_LETTER_MODE: LECAP_LETTER_MODE,
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
    tradableLecaps: tradableLecaps,
    pickLecapForPlazo: pickLecapForPlazo,
    resolveLecapHorizon: resolveLecapHorizon,
    lecapDetailsFromReference: lecapDetailsFromReference,
    formatVencimiento: formatVencimiento
  };
}
