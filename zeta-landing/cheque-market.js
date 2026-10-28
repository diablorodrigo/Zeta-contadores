/**
 * Referencias para decidir si conviene descontar un cheque o esperar.
 *
 * BCRA Estadísticas v4.0, sin clave:
 *   GET https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?limit=3000
 * Si no responde, queda la foto del 28/10/2026 (fechas de cada serie).
 *
 * Letras: el precio sale de Data912 GET /live/arg_notes. El pago final es
 * el de la consulta del 28/10/2026 (dos calculadoras de terceros coincidían).
 * No está confirmado con la Secretaría de Finanzas. Sin precio en vivo se
 * muestra esa foto, con su fecha, y no se la presenta como cotización de hoy.
 */

var BCRA_SERIES = [
  { id: 1216, key: 'solaFirma', label: 'Documentos a sola firma', hint: 'Techo de referencia', unit: 'tna' },
  { id: 13, key: 'adelantos', label: 'Adelantos en cuenta corriente', hint: '1 a 7 días, desde $10 M', unit: 'tna' },
  { id: 44, key: 'tamar', label: 'TAMAR bancos privados', unit: 'tna' },
  { id: 7, key: 'badlar', label: 'BADLAR bancos privados', unit: 'tna' },
  { id: 1189, key: 'pfTotal', label: 'Plazo fijo en pesos, total', unit: 'tna' },
  { id: 1192, key: 'pfOtrasPj', label: 'Plazo fijo, otras personas jurídicas', unit: 'tna' },
  { id: 1207, key: 'pf30', label: 'Plazo fijo a 30 días', unit: 'tna' },
  { id: 1346, key: 'stockDescuento', label: 'Stock de descuento de documentos', hint: 'Sector privado', unit: 'millones' }
];

var BCRA_FALLBACK = {
  consultado: '2026-10-28',
  series: {
    1216: { fecha: '2026-09-30', valor: 31.35 },
    13: { fecha: '2026-10-26', valor: 25.05 },
    44: { fecha: '2026-10-26', valor: 24.125 },
    7: { fecha: '2026-10-26', valor: 22.1875 },
    1189: { fecha: '2026-10-26', valor: 21.84 },
    1192: { fecha: '2026-10-26', valor: 22.48 },
    1207: { fecha: '2026-10-26', valor: 20.92 },
    1346: { fecha: '2026-10-23', valor: 7924004 }
  }
};

var CHEQUE_LECAP_AS_OF = '2026-10-28';
var CHEQUE_LECAP_LIQUIDACION = '2026-10-29';
var CHEQUE_LECAP_FLUJO_NOTA = 'Los pagos finales salen de calculadoras de terceros (consulta del 28/10/2026) y no están confirmados con la Secretaría de Finanzas.';

var CHEQUE_LECAP_FLOWS = [
  { ticker: 'S30O6', vencimiento: '2026-10-30', pagoFinal: 135.278, dias: 1, precio: 135.2, volumen: 431912256, tna: 21.06, tea: 23.43 },
  { ticker: 'S13N6', vencimiento: '2026-11-13', pagoFinal: 109.651, dias: 15, precio: 108.61, volumen: 2272120015, tna: 23.32, tea: 26.13 },
  { ticker: 'S30N6', vencimiento: '2026-11-30', pagoFinal: 129.888, dias: 32, precio: 127.25, volumen: 1061797202, tna: 23.65, tea: 26.37 },
  { ticker: 'T15E7', vencimiento: '2027-01-15', pagoFinal: 161.104, dias: 78, precio: 152.948, volumen: 1145084143, tna: 24.95, tea: 27.52 },
  { ticker: 'S29E7', vencimiento: '2027-01-29', pagoFinal: 111.685, dias: 92, precio: 104.94, volumen: 1044106983, tna: 25.50, tea: 28.04 },
  { ticker: 'T30A7', vencimiento: '2027-04-30', pagoFinal: 157.341, dias: 183, precio: 138.35, volumen: 4024331809, tna: 27.38, tea: 29.25 },
  { ticker: 'T31Y7', vencimiento: '2027-05-31', pagoFinal: 151.563, dias: 214, precio: 130.2, volumen: 117916663, tna: 27.99, tea: 29.58 },
  { ticker: 'T30J7', vencimiento: '2027-06-30', pagoFinal: 156.037, dias: 244, precio: 132.352, volumen: 26183215, tna: 26.77, tea: 27.92 }
];

function chequeMarketFinite(value) {
  var n = Number(value);
  return isFinite(n) ? n : null;
}

function parseBcraMonetarias(payload) {
  var results = payload && payload.results;
  if (!Array.isArray(results)) return null;
  var byId = {};
  results.forEach(function (row) {
    if (!row || row.idVariable == null) return;
    var valor = chequeMarketFinite(row.ultValorInformado);
    if (valor == null) return;
    byId[row.idVariable] = {
      id: row.idVariable,
      fecha: row.ultFechaInformada || null,
      valor: valor,
      descripcion: row.descripcion || ''
    };
  });
  return byId;
}

function bcraPanelFromSources(liveById) {
  var series = BCRA_SERIES.map(function (spec) {
    var live = liveById && liveById[spec.id];
    var fallback = BCRA_FALLBACK.series[spec.id];
    var useLive = !!(live && chequeMarketFinite(live.valor) != null);
    var src = useLive ? live : fallback;
    return {
      id: spec.id,
      key: spec.key,
      label: spec.label,
      hint: spec.hint || '',
      unit: spec.unit,
      valor: src ? src.valor : null,
      fecha: src ? src.fecha : null,
      fuente: useLive ? 'bcra' : 'cargado',
      stale: !useLive
    };
  });
  var anyLive = series.some(function (row) { return row.fuente === 'bcra'; });
  var anyStale = series.some(function (row) { return row.stale; });
  var status = 'cargado';
  if (anyLive && !anyStale) status = 'bcra';
  else if (anyLive) status = 'parcial';
  return {
    status: status,
    stale: anyStale,
    asOf: anyLive ? null : BCRA_FALLBACK.consultado,
    series: series
  };
}

function bcraSeriesByKey(panel, key) {
  var series = panel && panel.series;
  if (!Array.isArray(series)) return null;
  for (var i = 0; i < series.length; i++) {
    if (series[i].key === key) return series[i];
  }
  return null;
}

function priceFromData912Row(row) {
  if (!row) return null;
  var last = chequeMarketFinite(row.c);
  if (last != null && last > 0) return last;
  var bid = chequeMarketFinite(row.px_bid);
  var ask = chequeMarketFinite(row.px_ask);
  if (bid != null && ask != null && bid > 0 && ask > 0) return (bid + ask) / 2;
  return null;
}

function chequeDaysBetween(fromIso, toIso) {
  var from = Date.parse(String(fromIso || '') + 'T00:00:00Z');
  var to = Date.parse(String(toIso || '') + 'T00:00:00Z');
  if (!isFinite(from) || !isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}

function yieldFromPayoff(precio, pagoFinal, dias) {
  var px = chequeMarketFinite(precio);
  var pago = chequeMarketFinite(pagoFinal);
  var days = chequeMarketFinite(dias);
  if (!(px > 0) || !(pago > 0) || !(days > 0)) return null;
  var growth = pago / px;
  return {
    tna: (growth - 1) * 365 / days * 100,
    tea: (Math.pow(growth, 365 / days) - 1) * 100
  };
}

function snapshotLecapLetter(flow) {
  return {
    ticker: flow.ticker,
    vencimiento: flow.vencimiento,
    pagoFinal: flow.pagoFinal,
    dias: flow.dias,
    precio: flow.precio,
    volumen: flow.volumen,
    tna: flow.tna,
    tea: flow.tea,
    fuente: 'cargado',
    stale: true,
    asOf: CHEQUE_LECAP_AS_OF,
    flujosNoConfirmados: true
  };
}

function buildChequeLecapQuotes(input) {
  var source = input || {};
  var flows = source.flows || CHEQUE_LECAP_FLOWS;
  var rows = Array.isArray(source.data912Rows) ? source.data912Rows : [];
  var priceByTicker = {};
  rows.forEach(function (row) {
    if (!row || !row.symbol) return;
    var px = priceFromData912Row(row);
    if (px == null) return;
    priceByTicker[String(row.symbol).toUpperCase()] = {
      precio: px,
      volumen: chequeMarketFinite(row.v) || 0
    };
  });

  var settlement = source.settlement || null;
  var letters = [];
  var liveCount = 0;
  var staleCount = 0;
  flows.forEach(function (flow) {
    var live = priceByTicker[String(flow.ticker).toUpperCase()];
    if (live && settlement) {
      var dias = chequeDaysBetween(settlement, flow.vencimiento);
      if (!(dias > 0)) return;
      var y = yieldFromPayoff(live.precio, flow.pagoFinal, dias);
      if (!y) return;
      liveCount += 1;
      letters.push({
        ticker: flow.ticker,
        vencimiento: flow.vencimiento,
        pagoFinal: flow.pagoFinal,
        dias: dias,
        precio: live.precio,
        volumen: live.volumen,
        tna: Math.round(y.tna * 100) / 100,
        tea: Math.round(y.tea * 100) / 100,
        fuente: 'data912',
        stale: false,
        asOf: null,
        flujosNoConfirmados: true
      });
      return;
    }
    staleCount += 1;
    letters.push(snapshotLecapLetter(flow));
  });

  var status = 'cargado';
  if (liveCount && staleCount) status = 'mixto';
  else if (liveCount) status = 'data912';
  return {
    status: status,
    stale: staleCount > 0 || liveCount === 0,
    asOf: liveCount && !staleCount ? null : CHEQUE_LECAP_AS_OF,
    liquidacion: settlement || CHEQUE_LECAP_LIQUIDACION,
    flujosNoConfirmados: true,
    flujoNota: CHEQUE_LECAP_FLUJO_NOTA,
    letters: letters
  };
}

function pickClosestByDays(targetDays, rows) {
  var target = chequeMarketFinite(targetDays);
  if (!(target > 0) || !Array.isArray(rows)) return null;
  var best = null;
  rows.forEach(function (row) {
    if (!row) return;
    var days = chequeMarketFinite(row.days != null ? row.days : row.dias);
    var tna = chequeMarketFinite(row.tna);
    if (!(days > 0) || tna == null) return;
    var delta = Math.abs(days - target);
    var volume = chequeMarketFinite(row.volume != null ? row.volume : row.volumen) || 0;
    if (!best || delta < best.delta || (delta === best.delta && volume > best.volume)) {
      best = {
        days: days,
        tna: tna,
        tea: chequeMarketFinite(row.tea),
        volume: volume,
        delta: delta,
        ticker: row.ticker || null,
        label: row.label || null,
        stale: !!row.stale,
        fuente: row.fuente || null,
        asOf: row.asOf || null,
        vencimiento: row.vencimiento || null
      };
    }
  });
  return best;
}

function caucionQuotesFromBuckets(buckets) {
  var out = [];
  if (!buckets) return out;
  Object.keys(buckets).forEach(function (key) {
    var days = chequeMarketFinite(key);
    var tna = chequeMarketFinite(buckets[key]);
    if (!(days > 0) || tna == null) return;
    out.push({ days: days, tna: tna, volume: 0, fuente: 'config' });
  });
  return out;
}

function sameTermPlacement(liquido, nominal, dias, tnaAlt) {
  var net = chequeMarketFinite(liquido);
  var vn = chequeMarketFinite(nominal);
  var days = chequeMarketFinite(dias);
  var tna = chequeMarketFinite(tnaAlt);
  if (!(net > 0) || !(vn > 0) || !(days > 0) || tna == null) return null;
  var colocado = net * (1 + (tna / 100) * (days / 365));
  return {
    colocado: colocado,
    diferencia: vn - colocado
  };
}

function waitVerdict(costTna, altTna, altLabel) {
  var cost = chequeMarketFinite(costTna);
  var alt = chequeMarketFinite(altTna);
  var name = altLabel || 'la alternativa';
  if (cost == null || alt == null) {
    return {
      kind: 'sin_dato',
      diff: null,
      texto: 'No hay tasa vigente para comparar con ' + name + '.'
    };
  }
  var diff = Math.round((cost - alt) * 100) / 100;
  if (diff > 0.05) {
    return {
      kind: 'mas_caro',
      diff: diff,
      texto: 'Descontar es más caro que esperar en ' + name
    };
  }
  if (diff < -0.05) {
    return {
      kind: 'mas_barato',
      diff: diff,
      texto: 'Descontar es más barato que esperar en ' + name
    };
  }
  return {
    kind: 'parecido',
    diff: diff,
    texto: 'Descontar y esperar en ' + name + ' salen parecidos'
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BCRA_SERIES: BCRA_SERIES,
    BCRA_FALLBACK: BCRA_FALLBACK,
    CHEQUE_LECAP_FLOWS: CHEQUE_LECAP_FLOWS,
    CHEQUE_LECAP_AS_OF: CHEQUE_LECAP_AS_OF,
    CHEQUE_LECAP_FLUJO_NOTA: CHEQUE_LECAP_FLUJO_NOTA,
    parseBcraMonetarias: parseBcraMonetarias,
    bcraPanelFromSources: bcraPanelFromSources,
    bcraSeriesByKey: bcraSeriesByKey,
    priceFromData912Row: priceFromData912Row,
    yieldFromPayoff: yieldFromPayoff,
    buildChequeLecapQuotes: buildChequeLecapQuotes,
    pickClosestByDays: pickClosestByDays,
    caucionQuotesFromBuckets: caucionQuotesFromBuckets,
    sameTermPlacement: sameTermPlacement,
    waitVerdict: waitVerdict
  };
}
