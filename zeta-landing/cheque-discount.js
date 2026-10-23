/**
 * Descuento de cheques — definición Zeta.
 * Tasas en puntos (27.5 = 27,5%). iva en decimal (0.21).
 * descuento_financiero = monto * (tnaDesc/100) * (plazo/365)
 * derechos_iva        = monto * (derechosPct/100) * (1+iva)
 * arancel_iva         = monto * (tnaArancel/100) * (plazo/365) * (1+iva)
 * total_costos        = descuento_financiero + derechos_iva + arancel_iva
 * monto_recibido      = monto - total_costos
 * costo_periodo       = total_costos / monto_recibido
 * cft_nominal         = costo_periodo * (365/plazo)
 * cft_efectivo        = (1 + costo_periodo) ** (365/plazo) - 1
 */
function calcChequeQuote(monto, plazo, rates, iva) {
  const safeMonto = Number(monto);
  const safePlazo = Number(plazo);
  const ivaRate = Number(iva);
  const tnaDesc = Number(rates && rates.tnaDesc);
  const derechosPct = Number(rates && rates.derechosPct);
  const tnaArancel = Number(rates && rates.tnaArancel);

  const montoOk = isFinite(safeMonto) && safeMonto >= 0;
  const plazoOk = isFinite(safePlazo) && safePlazo > 0;
  const ivaOk = isFinite(ivaRate) && ivaRate >= 0;
  const ratesOk = [tnaDesc, derechosPct, tnaArancel].every(n => isFinite(n) && n >= 0);

  const base = {
    monto: montoOk ? safeMonto : 0,
    plazo: plazoOk ? safePlazo : 0,
    tnaDesc: ratesOk ? tnaDesc : 0,
    derechosPct: ratesOk ? derechosPct : 0,
    tnaArancel: ratesOk ? tnaArancel : 0,
    descuentoFinanciero: 0,
    derechosIva: 0,
    arancelIva: 0,
    totalCostos: 0,
    montoRecibido: montoOk ? safeMonto : 0,
    costoPeriodo: null,
    cftNominal: null,
    cftEfectivo: null,
    costoPeriodoPct: null,
    cftNominalPct: null,
    cftEfectivoPct: null
  };

  if (!montoOk || !plazoOk || !ivaOk || !ratesOk) return base;

  const dayFraction = safePlazo / 365;
  const descuentoFinanciero = safeMonto * (tnaDesc / 100) * dayFraction;
  const derechosIva = safeMonto * (derechosPct / 100) * (1 + ivaRate);
  const arancelIva = safeMonto * (tnaArancel / 100) * dayFraction * (1 + ivaRate);
  const totalCostos = descuentoFinanciero + derechosIva + arancelIva;
  const montoRecibido = safeMonto - totalCostos;

  let costoPeriodo = null;
  let cftNominal = null;
  let cftEfectivo = null;
  if (montoRecibido > 0) {
    costoPeriodo = totalCostos / montoRecibido;
    cftNominal = costoPeriodo * (365 / safePlazo);
    cftEfectivo = Math.pow(1 + costoPeriodo, 365 / safePlazo) - 1;
  }

  return {
    ...base,
    descuentoFinanciero,
    derechosIva,
    arancelIva,
    totalCostos,
    montoRecibido,
    costoPeriodo,
    cftNominal,
    cftEfectivo,
    costoPeriodoPct: ratioToPctNumber(costoPeriodo),
    cftNominalPct: ratioToPctNumber(cftNominal),
    cftEfectivoPct: ratioToPctNumber(cftEfectivo)
  };
}

function roundMoney(value) {
  const n = Number(value);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function ratioToPctNumber(ratio) {
  if (ratio == null || !isFinite(ratio)) return null;
  return Math.round(ratio * 10000) / 100;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calcChequeQuote, roundMoney, ratioToPctNumber };
}
