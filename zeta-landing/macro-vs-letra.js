/**
 * Plazo fijo Banco Macro vs letra corta (LECAP / BONCAP).
 *
 * Hipótesis de tasa neta, alineada a ComparaTasas (lecap-calculos.ts +
 * costoCompraLetrasPct) con broker de referencia Balanz:
 *
 *   factorBruto = 1 + (tnaBruta/100) * (dias/365)
 *   costoCompra = (comisionPct/100) * (aplicaIva ? 1 + iva : 1) + (derechosPct/100)
 *   factorNeto  = factorBruto / (1 + costoCompra)
 *   interesNeto = monto * (factorNeto - 1)
 *   totalLetra  = monto * factorNeto
 *   tnaNeta     = (factorNeto - 1) * (365/dias) * 100
 *
 * La comisión de letras (Balanz, "hasta 0,10%" sobre compra/venta en pesos)
 * se carga una sola vez sobre el nocional de compra. No hay venta si se
 * mantiene al vencimiento. El IVA multiplica esa comisión cuando aplicaIva
 * está prendido (el default de config.js lo está).
 * Los derechos de mercado se suman sobre el nocional y sin IVA: en letras
 * son un título público. El default es el 0,001% del cuadro BYMA de agosto
 * de 2026. La membresía mensual no se amortiza. El impuesto a los débitos
 * y créditos se aplica aparte, en broker-costs.js.
 *
 * Plazo fijo, interés simple (la misma convención del simulador y de
 * ComparaTasas al comparar contra el PF del plazo de la letra):
 *
 *   interes = monto * (tna/100) * (dias/365)
 *   total   = monto + interes
 *
 * Solo si el plazo es de al menos 30 días y hay una TNA (tramo Macro o
 * la que el contador tipeó en la reunión). Por debajo de 30 días el lado
 * banco queda N/A: un plazo fijo tradicional no se contrata a menos días.
 */

function calcLetraNeta(monto, dias, tnaBruta, fees) {
  var safeMonto = Number(monto);
  var safeDias = Number(dias);
  var safeTna = Number(tnaBruta);
  var comisionPct = Number(fees && fees.comisionPct);
  var derechosPct = Number(fees && fees.derechosPct);
  var iva = Number(fees && fees.iva);
  var aplicaIva = !!(fees && fees.aplicaIva);

  var montoOk = isFinite(safeMonto) && safeMonto >= 0;
  var diasOk = isFinite(safeDias) && safeDias > 0;
  var tnaOk = isFinite(safeTna);
  var comisionOk = isFinite(comisionPct) && comisionPct >= 0;
  var derechosOk = isFinite(derechosPct) && derechosPct >= 0;
  var ivaOk = !aplicaIva || (isFinite(iva) && iva >= 0);

  var empty = {
    monto: montoOk ? safeMonto : 0,
    dias: diasOk ? safeDias : 0,
    tnaBruta: tnaOk ? safeTna : 0,
    tnaNeta: null,
    comisionPct: comisionOk ? comisionPct : 0,
    derechosPct: derechosOk ? derechosPct : 0,
    aplicaIva: aplicaIva,
    costoCompraPct: null,
    interes: null,
    total: null
  };

  if (!montoOk || !diasOk || !tnaOk || !comisionOk || !derechosOk || !ivaOk) return empty;

  var costoCompra = (comisionPct / 100) * (aplicaIva ? (1 + iva) : 1) + (derechosPct / 100);
  if (costoCompra < 0 || costoCompra >= 1) return empty;

  var factorBruto = 1 + (safeTna / 100) * (safeDias / 365);
  var factorNeto = factorBruto / (1 + costoCompra);
  var interes = safeMonto * (factorNeto - 1);

  return {
    monto: safeMonto,
    dias: safeDias,
    tnaBruta: safeTna,
    tnaNeta: (factorNeto - 1) * (365 / safeDias) * 100,
    comisionPct: comisionPct,
    derechosPct: derechosPct,
    aplicaIva: aplicaIva,
    costoCompraPct: costoCompra * 100,
    interes: interes,
    total: safeMonto + interes
  };
}

function calcPlazoFijoSimple(monto, dias, tna) {
  var safeMonto = Number(monto);
  var safeDias = Number(dias);
  var safeTna = Number(tna);
  var montoOk = isFinite(safeMonto) && safeMonto >= 0;
  var diasOk = isFinite(safeDias) && safeDias > 0;
  var tnaOk = isFinite(safeTna);

  if (!montoOk || !diasOk || !tnaOk) {
    return {
      monto: montoOk ? safeMonto : 0,
      dias: diasOk ? safeDias : 0,
      tna: tnaOk ? safeTna : 0,
      interes: null,
      total: null
    };
  }

  var interes = safeMonto * (safeTna / 100) * (safeDias / 365);
  return {
    monto: safeMonto,
    dias: safeDias,
    tna: safeTna,
    interes: interes,
    total: safeMonto + interes
  };
}

/**
 * Tramo publicado por Macro que contiene plazo y monto.
 * montoMax null = sin tope. Los bordes son inclusivos.
 * Si dos tramos matchean, gana el de monto mínimo más alto (la banda del capital).
 */
function pickMacroBand(bands, monto, dias) {
  var safeMonto = Number(monto);
  var safeDias = Number(dias);
  if (!isFinite(safeMonto) || !isFinite(safeDias)) return null;

  var match = null;
  (bands || []).forEach(function (band) {
    if (!band) return;
    var tna = Number(band.tna);
    var plazoMin = Number(band.plazoMin);
    var plazoMax = band.plazoMax == null ? null : Number(band.plazoMax);
    var montoMin = band.montoMin == null ? null : Number(band.montoMin);
    var montoMax = band.montoMax == null ? null : Number(band.montoMax);
    if (!isFinite(tna) || !isFinite(plazoMin)) return;
    if (safeDias < plazoMin) return;
    if (plazoMax != null && safeDias > plazoMax) return;
    if (montoMin != null && safeMonto < montoMin) return;
    if (montoMax != null && safeMonto > montoMax) return;
    if (!match || (montoMin || 0) > (match.montoMin || 0)) match = band;
  });
  return match;
}

/**
 * ArgentinaDatos `/v1/finanzas/tasas/plazoFijo` publica BANCO MACRO con
 * tna en decimal (0.195 = 19,5%) y tramos por monto y días.
 */
function macroBandsFromArgentinaDatos(entities) {
  var list = Array.isArray(entities) ? entities : [];
  var macro = null;
  for (var i = 0; i < list.length; i++) {
    var name = String((list[i] && list[i].entidad) || '');
    if (/MACRO/i.test(name)) {
      macro = list[i];
      break;
    }
  }
  if (!macro || !Array.isArray(macro.tasas)) return null;

  var bands = [];
  macro.tasas.forEach(function (tasa) {
    var raw = Number(tasa && tasa.tna);
    if (!isFinite(raw) || raw <= 0) return;
    var points = raw <= 1.5 ? raw * 100 : raw;
    var plazoMin = Number(tasa.plazoMinDias);
    if (!isFinite(plazoMin)) return;
    bands.push({
      montoMin: tasa.montoMinimo == null ? null : Number(tasa.montoMinimo),
      montoMax: tasa.montoMaximo == null ? null : Number(tasa.montoMaximo),
      plazoMin: plazoMin,
      plazoMax: tasa.plazoMaxDias == null ? null : Number(tasa.plazoMaxDias),
      tna: Math.round(points * 10) / 10
    });
  });
  return bands.length ? bands : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calcLetraNeta: calcLetraNeta,
    calcPlazoFijoSimple: calcPlazoFijoSimple,
    pickMacroBand: pickMacroBand,
    macroBandsFromArgentinaDatos: macroBandsFromArgentinaDatos
  };
}
