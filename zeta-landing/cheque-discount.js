/**
 * Descuento de cheques — costo de quien vende el cheque.
 *
 * Tasa pactada en puntos (25.73 = 25,73%). IVA e impuesto al cheque en decimal.
 *
 * El importe descontado es el valor actual del nominal a la tasa pactada:
 *   P = VN / (1 + TNA * días / 365)
 *   interés = VN - P
 *
 * Derecho MAV (mav-sa.com.ar, cheques de pago diferido), anual a 365 días,
 * sobre ese importe, más IVA:
 *   venta 0,06% (la paga quien vende; entra en el ejemplo)
 *   compra 0,03% (la paga el comprador, salvo que se marque aplicarla)
 * Arancel de ALyC: anual a 365 días sobre el VN, más IVA.
 *   Default 0,40% (Rosval, junio 2026, un solo agente).
 * Impuesto a los créditos y débitos: alícuota sobre el crédito (P menos los
 * gastos), antes de retenerlo. El ejemplo usa 0,6%. La alícuota está a
 * confirmar. El cómputo contra Ganancias (0, 33%, 100% o 60%) reduce el
 * impuesto que queda a cargo; el ejemplo no lo computa.
 *
 * Líquido = P - gastos - impuesto neto
 * TNA de costo = (VN / líquido - 1) * 365 / días
 * TNA sin impuesto = (VN / P_antes_de_impuesto - 1) * 365 / días
 * TEA = (VN / neto) ^ (365 / días) - 1
 *
 * Caso de referencia (28/10/2026), solo costos verificados, VN $1.000.000,
 * TNA 25,73%, sin compra, sin aval, sin sellos, sin IVA sobre intereses:
 *   60 días → líquido $952.759, TNA 30,16%, sin impuesto 26,33%
 *   90 días → líquido $933.346, TNA 28,96%, sin impuesto 26,36%
 */

function chequeCostoEjemplo() {
  return {
    tna: 25.73,
    iva: 0.21,
    mavVentaPct: 0.06,
    mavCompraPct: 0.03,
    aplicarCompra: false,
    alycPct: 0.40,
    icdbAlicuota: 0.006,
    computoGanancias: 0,
    ivaIntereses: false,
    ivaInteresesAlicuota: 0.21,
    comisionBancoPct: 0,
    comisionBancoIva: false,
    avalSgrPct: 0,
    avalSgrIva: false,
    sellosPct: 0
  };
}

function chequeNum(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? n : fallback;
}

function chequeAnnualFee(base, pctPoints, days, withIva, iva) {
  var pct = Number(pctPoints);
  if (!(base > 0) || !(pct > 0) || !(days > 0)) return 0;
  var fee = base * (pct / 100) * (days / 365);
  if (withIva) fee *= (1 + iva);
  return fee;
}

function chequeTnaFromNet(nominal, net, days) {
  if (!(net > 0) || !(nominal >= 0) || !(days > 0)) return null;
  return ((nominal / net) - 1) * (365 / days) * 100;
}

function chequeTeaFromNet(nominal, net, days) {
  if (!(net > 0) || !(nominal > 0) || !(days > 0)) return null;
  return (Math.pow(nominal / net, 365 / days) - 1) * 100;
}

function calcChequeCosto(monto, plazo, params) {
  var p = params || {};
  var safeMonto = Number(monto);
  var safePlazo = Number(plazo);
  var tna = chequeNum(p.tna != null ? p.tna : p.tnaDesc, NaN);
  var iva = chequeNum(p.iva, 0.21);
  var mavVentaPct = chequeNum(p.mavVentaPct, 0.06);
  var mavCompraPct = chequeNum(p.mavCompraPct, 0.03);
  var aplicarCompra = !!p.aplicarCompra;
  var alycPct = chequeNum(p.alycPct, 0.40);
  var icdbAlicuota = chequeNum(p.icdbAlicuota, 0.006);
  var computo = chequeNum(p.computoGanancias, 0);
  var ivaInteresesOn = !!p.ivaIntereses;
  var ivaInteresesAlicuota = chequeNum(p.ivaInteresesAlicuota, 0.21);
  var comisionBancoPct = chequeNum(p.comisionBancoPct, 0);
  var comisionBancoIva = !!p.comisionBancoIva;
  var avalSgrPct = chequeNum(p.avalSgrPct, 0);
  var avalSgrIva = !!p.avalSgrIva;
  var sellosPct = chequeNum(p.sellosPct, 0);

  var montoOk = isFinite(safeMonto) && safeMonto >= 0;
  var plazoOk = isFinite(safePlazo) && safePlazo > 0;
  var tnaOk = isFinite(tna) && tna >= 0;
  var ivaOk = isFinite(iva) && iva >= 0;
  var ratesOk = [mavVentaPct, mavCompraPct, alycPct, icdbAlicuota, computo, ivaInteresesAlicuota, comisionBancoPct, avalSgrPct, sellosPct]
    .every(function (n) { return isFinite(n) && n >= 0; });
  if (computo > 1) ratesOk = false;

  var base = {
    monto: montoOk ? safeMonto : 0,
    plazo: plazoOk ? safePlazo : 0,
    tna: tnaOk ? tna : 0,
    tnaDesc: tnaOk ? tna : 0,
    iva: ivaOk ? iva : 0,
    importeDescontado: montoOk ? safeMonto : 0,
    interes: 0,
    descuentoFinanciero: 0,
    mavVenta: 0,
    mavCompra: 0,
    derechosIva: 0,
    alyc: 0,
    arancelIva: 0,
    ivaInteresesPesos: 0,
    comisionBanco: 0,
    avalSgr: 0,
    sellos: 0,
    preIcdb: montoOk ? safeMonto : 0,
    icdb: 0,
    icdbComputado: 0,
    icdbNeto: 0,
    liquido: montoOk ? safeMonto : 0,
    liquidoSinIcdb: montoOk ? safeMonto : 0,
    montoRecibido: montoOk ? safeMonto : 0,
    totalCostos: 0,
    costoPeriodo: null,
    tnaCosto: null,
    teaCosto: null,
    tnaSinIcdb: null,
    teaSinIcdb: null,
    tnaCostoPct: null,
    teaCostoPct: null,
    tnaSinIcdbPct: null,
    teaSinIcdbPct: null,
    cftNominal: null,
    cftEfectivo: null,
    cftNominalPct: null,
    cftEfectivoPct: null,
    costoPeriodoPct: null
  };

  if (!montoOk || !plazoOk || !tnaOk || !ivaOk || !ratesOk) return base;

  var factor = (tna / 100) * (safePlazo / 365);
  var importe = safeMonto / (1 + factor);
  var interes = safeMonto - importe;
  var mavVenta = chequeAnnualFee(importe, mavVentaPct, safePlazo, true, iva);
  var mavCompra = aplicarCompra ? chequeAnnualFee(importe, mavCompraPct, safePlazo, true, iva) : 0;
  var alyc = chequeAnnualFee(safeMonto, alycPct, safePlazo, true, iva);
  var comisionBanco = chequeAnnualFee(safeMonto, comisionBancoPct, safePlazo, comisionBancoIva, iva);
  var avalSgr = chequeAnnualFee(safeMonto, avalSgrPct, safePlazo, avalSgrIva, iva);
  var ivaInteresesPesos = ivaInteresesOn ? interes * ivaInteresesAlicuota : 0;
  var sellos = safeMonto * (sellosPct / 100);
  var gastos = mavVenta + mavCompra + alyc + comisionBanco + avalSgr + ivaInteresesPesos + sellos;
  var pre = importe - gastos;
  var icdb = pre > 0 ? pre * icdbAlicuota : 0;
  var icdbComputado = icdb * computo;
  var icdbNeto = icdb - icdbComputado;
  var liquido = pre - icdbNeto;

  var tnaCosto = chequeTnaFromNet(safeMonto, liquido, safePlazo);
  var teaCosto = chequeTeaFromNet(safeMonto, liquido, safePlazo);
  var tnaSin = chequeTnaFromNet(safeMonto, pre, safePlazo);
  var teaSin = chequeTeaFromNet(safeMonto, pre, safePlazo);
  var costoPeriodo = liquido > 0 ? (safeMonto - liquido) / liquido : null;

  return {
    monto: safeMonto,
    plazo: safePlazo,
    tna: tna,
    tnaDesc: tna,
    iva: iva,
    aplicarCompra: aplicarCompra,
    importeDescontado: importe,
    interes: interes,
    descuentoFinanciero: interes,
    mavVenta: mavVenta,
    mavCompra: mavCompra,
    derechosIva: mavVenta + mavCompra,
    alyc: alyc,
    arancelIva: alyc,
    ivaInteresesPesos: ivaInteresesPesos,
    comisionBanco: comisionBanco,
    avalSgr: avalSgr,
    sellos: sellos,
    preIcdb: pre,
    icdb: icdb,
    icdbComputado: icdbComputado,
    icdbNeto: icdbNeto,
    computoGanancias: computo,
    liquido: liquido,
    liquidoSinIcdb: pre,
    montoRecibido: liquido,
    totalCostos: safeMonto - liquido,
    costoPeriodo: costoPeriodo,
    tnaCosto: tnaCosto,
    teaCosto: teaCosto,
    tnaSinIcdb: tnaSin,
    teaSinIcdb: teaSin,
    tnaCostoPct: pointsPct(tnaCosto),
    teaCostoPct: pointsPct(teaCosto),
    tnaSinIcdbPct: pointsPct(tnaSin),
    teaSinIcdbPct: pointsPct(teaSin),
    cftNominal: tnaCosto == null ? null : tnaCosto / 100,
    cftEfectivo: teaCosto == null ? null : teaCosto / 100,
    cftNominalPct: pointsPct(tnaCosto),
    cftEfectivoPct: pointsPct(teaCosto),
    costoPeriodoPct: ratioToPctNumber(costoPeriodo)
  };
}

function calcChequeQuote(monto, plazo, rates, iva) {
  var merged = {};
  var key;
  for (key in (rates || {})) {
    if (Object.prototype.hasOwnProperty.call(rates, key)) merged[key] = rates[key];
  }
  if (merged.tna == null && merged.tnaDesc != null) merged.tna = merged.tnaDesc;
  if (iva != null && merged.iva == null) merged.iva = iva;
  return calcChequeCosto(monto, plazo, merged);
}

function roundMoney(value) {
  var n = Number(value);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function ratioToPctNumber(ratio) {
  if (ratio == null || !isFinite(ratio)) return null;
  return Math.round(ratio * 10000) / 100;
}

function pointsPct(points) {
  if (points == null || !isFinite(points)) return null;
  return Math.round(points * 100) / 100;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    chequeCostoEjemplo: chequeCostoEjemplo,
    calcChequeCosto: calcChequeCosto,
    calcChequeQuote: calcChequeQuote,
    roundMoney: roundMoney,
    ratioToPctNumber: ratioToPctNumber,
    pointsPct: pointsPct
  };
}
