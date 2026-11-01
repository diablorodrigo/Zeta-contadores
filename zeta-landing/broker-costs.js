/**
 * Costos de broker y del impuesto a los débitos y créditos.
 *
 * Letras (tenencia al vencimiento, una sola compra, sin venta):
 *   costo = (comision/100) * (1+IVA si aplica) + (derechos/100)
 *   Los derechos de letras en el contado PPT no llevan IVA: BYMA,
 *   "Derechos de Mercado sobre Operaciones", agosto 2026, dice que el IVA
 *   se suma salvo en valores negociables públicos y obligaciones negociables.
 *   Letras: 0,0010%. Caución (públicos y privados): 0,0450%, referencia 06,
 *   proporcional al plazo hasta 90 días y sobre el mayor valor, más IVA.
 *
 * Caución colocadora en pesos: comisión de 0,50% expresada como TNA
 * (anual), según el criterio operativo de Zeta Finance. Se devenga por días:
 *   comision = monto * (0,50/100) * (dias/365) * (1+IVA)
 * Ojo: el tarifario web de Balanz dice "hasta 0.50% con detalle de prorrata
 * (cada 90 días)". Si el boleto real cobrara por 90 días, cambiar la base.
 * El derecho BYMA sí es proporcional al plazo hasta 90 días (ver arriba).
 *
 * FCI de mercado de dinero: sin comisión de suscripción ni de rescate
 * (ficha CAFCI de Balanz Capital Money Market, clase A: 0% / 0% / 0%).
 * Los honorarios de la gerente y la depositaria ya están en la cuotaparte.
 * La TNA sale de la variación de esa cuotaparte, no se le resta el honorario.
 *
 * Impuesto Ley 25.413. Alícuota general: Decreto 380/2001, art. 7, seis por
 * mil en créditos y seis por mil en débitos. La transferencia entre cuentas
 * del mismo titular está exenta (Decreto 301/2021, que incorpora el inciso
 * al art. 10 del anexo del Decreto 380/2001). El plazo fijo en el mismo
 * banco no mueve la plata y no entra en esta cuenta.
 * El cómputo como pago a cuenta de Ganancias no se resta: el porcentaje
 * depende de la categoría y lo define el contador.
 */

function lecapPurchaseCostFraction(fees) {
  var comisionPct = Number(fees && fees.comisionPct);
  var derechosPct = Number(fees && fees.derechosPct);
  var iva = Number(fees && fees.iva);
  var aplicaIva = !!(fees && fees.aplicaIva);
  var comisionOk = isFinite(comisionPct) && comisionPct >= 0;
  var derechosOk = isFinite(derechosPct) && derechosPct >= 0;
  var ivaOk = !aplicaIva || (isFinite(iva) && iva >= 0);
  if (!comisionOk || !derechosOk || !ivaOk) return null;
  var fraction = (comisionPct / 100) * (aplicaIva ? (1 + iva) : 1) + (derechosPct / 100);
  if (fraction < 0 || fraction >= 1) return null;
  return fraction;
}

function calcCaucionNeta(monto, dias, tnaBruta, fees) {
  var safeMonto = Number(monto);
  var safeDias = Number(dias);
  var safeTna = Number(tnaBruta);
  var comisionTnaPct = Number(fees && (fees.comisionTnaPct != null ? fees.comisionTnaPct : fees.comisionPct90));
  var derechosPct90 = Number(fees && fees.derechosPct90);
  var iva = Number(fees && fees.iva);
  var aplicaIva = !!(fees && fees.aplicaIva);
  var derechosConIva = !!(fees && fees.derechosConIva);

  var montoOk = isFinite(safeMonto) && safeMonto >= 0;
  var diasOk = isFinite(safeDias) && safeDias > 0;
  var tnaOk = isFinite(safeTna);
  var comisionOk = isFinite(comisionTnaPct) && comisionTnaPct >= 0;
  var derechosOk = isFinite(derechosPct90) && derechosPct90 >= 0;
  var ivaOk = (!aplicaIva && !derechosConIva) || (isFinite(iva) && iva >= 0);

  var empty = {
    monto: montoOk ? safeMonto : 0,
    dias: diasOk ? safeDias : 0,
    tnaBruta: tnaOk ? safeTna : 0,
    tnaNeta: null,
    interesBruto: null,
    interes: null,
    total: null,
    comisionPesos: null,
    derechosPesos: null
  };
  if (!montoOk || !diasOk || !tnaOk || !comisionOk || !derechosOk || !ivaOk) return empty;

  var interesBruto = safeMonto * (safeTna / 100) * (safeDias / 365);
  var comisionPesos = safeMonto * (comisionTnaPct / 100) * (safeDias / 365) * (aplicaIva ? (1 + iva) : 1);
  var mayor = Math.max(safeMonto, safeMonto + interesBruto);
  var diasDerecho = Math.min(safeDias, 90);
  var derechosPesos = mayor * (derechosPct90 / 100) * (diasDerecho / 90) * (derechosConIva ? (1 + iva) : 1);
  var interes = interesBruto - comisionPesos - derechosPesos;

  return {
    monto: safeMonto,
    dias: safeDias,
    tnaBruta: safeTna,
    tnaNeta: (interes / safeMonto) * (365 / safeDias) * 100,
    interesBruto: interesBruto,
    interes: interes,
    total: safeMonto + interes,
    comisionPesos: comisionPesos,
    derechosPesos: derechosPesos,
    comisionTnaPct: comisionTnaPct,
    derechosPct90: derechosPct90
  };
}

function calcFciSimple(monto, dias, tnaBruta) {
  var safeMonto = Number(monto);
  var safeDias = Number(dias);
  var safeTna = Number(tnaBruta);
  var montoOk = isFinite(safeMonto) && safeMonto >= 0;
  var diasOk = isFinite(safeDias) && safeDias > 0;
  var tnaOk = isFinite(safeTna);
  if (!montoOk || !diasOk || !tnaOk) {
    return {
      monto: montoOk ? safeMonto : 0,
      dias: diasOk ? safeDias : 0,
      tnaBruta: tnaOk ? safeTna : 0,
      tnaNeta: null,
      interesBruto: null,
      interes: null,
      total: null
    };
  }
  var interes = safeMonto * (safeTna / 100) * (safeDias / 365);
  return {
    monto: safeMonto,
    dias: safeDias,
    tnaBruta: safeTna,
    tnaNeta: safeTna,
    interesBruto: interes,
    interes: interes,
    total: safeMonto + interes,
    comisionPesos: 0,
    derechosPesos: 0
  };
}

/**
 * Débito al salir del banco hacia el broker y crédito al volver.
 * mismoTitularExento (default de la simulación) deja el impuesto en cero.
 * quedaEnBroker saca la pierna de vuelta.
 */
function applyImpuestoBancario(monto, interesBroker, tax) {
  var safeMonto = Number(monto);
  var interes = Number(interesBroker);
  var aliqD = Number(tax && tax.alicuotaDebito);
  var aliqC = Number(tax && tax.alicuotaCredito);
  var exento = !tax || tax.mismoTitularExento !== false;
  var queda = !!(tax && tax.quedaEnBroker);
  if (!isFinite(safeMonto) || safeMonto < 0 || !isFinite(interes)) {
    return { debito: 0, credito: 0, impuesto: 0, interes: null, exento: exento, quedaEnBroker: queda };
  }
  if (exento || !(aliqD >= 0) || !(aliqC >= 0)) {
    return { debito: 0, credito: 0, impuesto: 0, interes: interes, exento: true, quedaEnBroker: queda };
  }
  var debito = safeMonto * aliqD;
  var credito = queda ? 0 : (safeMonto + interes) * aliqC;
  return {
    debito: debito,
    credito: credito,
    impuesto: debito + credito,
    interes: interes - debito - credito,
    exento: false,
    quedaEnBroker: queda
  };
}

function withBankTax(quote, tax) {
  if (!quote || quote.interes == null || !(Number(quote.monto) >= 0)) return quote;
  var applied = applyImpuestoBancario(quote.monto, quote.interes, tax || {});
  if (applied.interes == null) return quote;
  var dias = Number(quote.dias);
  var tnaNeta = (quote.monto > 0 && dias > 0)
    ? (applied.interes / quote.monto) * (365 / dias) * 100
    : null;
  var next = {};
  var key;
  for (key in quote) {
    if (Object.prototype.hasOwnProperty.call(quote, key)) next[key] = quote[key];
  }
  next.interesBroker = quote.interes;
  next.tnaNetaBroker = quote.tnaNeta;
  next.debito = applied.debito;
  next.credito = applied.credito;
  next.impuesto = applied.impuesto;
  next.impuestoExento = applied.exento;
  next.quedaEnBroker = applied.quedaEnBroker;
  next.interes = applied.interes;
  next.total = quote.monto + applied.interes;
  next.tnaNeta = tnaNeta;
  next.pricedNet = true;
  return next;
}

/**
 * Días en que el interés neto de la letra empata al plazo fijo.
 * null si la letra no lo alcanza.
 */
function breakEvenLecapDays(tnaLetra, tnaPf, costoFraccion, tax) {
  var c = Number(costoFraccion);
  var tL = Number(tnaLetra);
  var tP = Number(tnaPf);
  if (!(c >= 0 && c < 1) || !isFinite(tL) || !isFinite(tP)) return null;
  var aliqD = 0;
  var aliqC = 0;
  if (tax && tax.mismoTitularExento === false) {
    aliqD = Number(tax.alicuotaDebito);
    if (!(aliqD >= 0)) return null;
    if (!tax.quedaEnBroker) {
      aliqC = Number(tax.alicuotaCredito);
      if (!(aliqC >= 0) || aliqC >= 1) return null;
    }
  }
  var k = 1 / (1 + c);
  var r = (tL / 100) / 365;
  var g = (tP / 100) / 365;
  var oneMinus = 1 - aliqC;
  var fixed = (k - 1) * oneMinus - aliqD - aliqC;
  var slope = k * r * oneMinus;
  var denom = slope - g;
  if (!(denom > 0)) return null;
  var days = -fixed / denom;
  if (!isFinite(days) || days < 0) return null;
  return days;
}

function parseIsoUtc(iso) {
  var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * TNA simple de un FCI a partir de dos valores cuota.
 * TNA = (vcpFin / vcpInicio - 1) * 365 / días * 100.
 * La ventana pedida es de 7 días corridos; se acepta el último punto
 * en o antes de esa fecha si el hueco queda entre 5 y 10 días.
 */
function tnaFromCuotapartes(rows, windowDays) {
  var window = Number(windowDays);
  if (!isFinite(window) || window < 1) window = 7;
  var series = [];
  (rows || []).forEach(function (row) {
    if (!row) return;
    var fecha = row.fecha;
    var vcp = Number(row.valorCuotaparte != null ? row.valorCuotaparte : row.vcp);
    var utc = parseIsoUtc(fecha);
    if (!utc || !(vcp > 0)) return;
    series.push({ fecha: String(fecha).slice(0, 10), utc: utc, vcp: vcp });
  });
  series.sort(function (a, b) { return a.utc - b.utc; });
  if (series.length < 2) return null;
  var end = series[series.length - 1];
  var target = end.utc - window * 86400000;
  var start = null;
  series.forEach(function (row) {
    if (row.utc <= target) start = row;
  });
  if (!start || start.utc >= end.utc) return null;
  var days = Math.round((end.utc - start.utc) / 86400000);
  if (days < 5 || days > 10) return null;
  var tna = (end.vcp / start.vcp - 1) * (365 / days) * 100;
  if (!(tna > 0 && tna < 80)) return null;
  return {
    tna: Math.round(tna * 100) / 100,
    vcp: end.vcp,
    vcpInicio: start.vcp,
    fecha: end.fecha,
    fechaInicio: start.fecha,
    dias: days
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    lecapPurchaseCostFraction: lecapPurchaseCostFraction,
    calcCaucionNeta: calcCaucionNeta,
    calcFciSimple: calcFciSimple,
    applyImpuestoBancario: applyImpuestoBancario,
    withBankTax: withBankTax,
    breakEvenLecapDays: breakEvenLecapDays,
    tnaFromCuotapartes: tnaFromCuotapartes
  };
}
