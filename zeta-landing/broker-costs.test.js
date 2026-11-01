const test = require('node:test');
const assert = require('node:assert/strict');
const { calcLetraNeta, calcPlazoFijoSimple } = require('./macro-vs-letra.js');
const {
  lecapPurchaseCostFraction,
  calcCaucionNeta,
  calcFciSimple,
  withBankTax,
  breakEvenLecapDays,
  tnaFromCuotapartes
} = require('./broker-costs.js');

const CAPITAL = 5000000;
const DIAS = 35;
const TNA_LETRA = 22.96;
const TNA_MACRO = 20;

function letraFees(extra) {
  return Object.assign({
    comisionPct: 0.10,
    aplicaIva: true,
    iva: 0.21,
    derechosPct: 0.001
  }, extra || {});
}

test('S30N6 a 35 días: antes sin IVA ni derechos, después con IVA y derecho BYMA', () => {
  const antes = calcLetraNeta(CAPITAL, DIAS, TNA_LETRA, {
    comisionPct: 0.10,
    aplicaIva: false,
    iva: 0.21,
    derechosPct: 0
  });
  const despues = calcLetraNeta(CAPITAL, DIAS, TNA_LETRA, letraFees());
  const pf = calcPlazoFijoSimple(CAPITAL, DIAS, TNA_MACRO);

  assert.ok(Math.abs(antes.tnaNeta - 21.895) < 0.01);
  assert.ok(Math.abs(antes.interes - 104977.21) < 0.05);
  assert.ok(Math.abs((antes.total - pf.total) - 9086.80) < 0.05);

  assert.ok(Math.abs(despues.tnaNeta - 21.661) < 0.01);
  assert.ok(Math.abs(despues.interes - 103855.49) < 0.05);
  assert.ok(Math.abs((despues.total - pf.total) - 7965.08) < 0.05);
  assert.equal(
    lecapPurchaseCostFraction(letraFees()),
    (0.10 / 100) * 1.21 + (0.001 / 100)
  );
});

test('el impuesto queda en cero si la transferencia es del mismo titular', () => {
  const letra = calcLetraNeta(CAPITAL, DIAS, TNA_LETRA, letraFees());
  const neto = withBankTax(letra, {
    alicuotaDebito: 0.006,
    alicuotaCredito: 0.006,
    mismoTitularExento: true,
    quedaEnBroker: false
  });
  assert.equal(neto.impuesto, 0);
  assert.equal(neto.interes, letra.interes);
  assert.equal(neto.impuestoExento, true);
});

test('sin la exención, el débito y el crédito bajan la TNA y la vuelta se puede apagar', () => {
  const letra = calcLetraNeta(CAPITAL, DIAS, TNA_LETRA, letraFees());
  const idaYVuelta = withBankTax(letra, {
    alicuotaDebito: 0.006,
    alicuotaCredito: 0.006,
    mismoTitularExento: false,
    quedaEnBroker: false
  });
  const soloIda = withBankTax(letra, {
    alicuotaDebito: 0.006,
    alicuotaCredito: 0.006,
    mismoTitularExento: false,
    quedaEnBroker: true
  });
  assert.ok(Math.abs(idaYVuelta.debito - 30000) < 0.01);
  assert.ok(idaYVuelta.credito > 30000);
  assert.ok(Math.abs(idaYVuelta.tnaNeta - 9.02) < 0.02);
  assert.equal(soloIda.credito, 0);
  assert.ok(Math.abs(soloIda.impuesto - 30000) < 0.01);
  assert.ok(soloIda.tnaNeta > idaYVuelta.tnaNeta);
  assert.ok(soloIda.tnaNeta < letra.tnaNeta);
});

test('la caución descuenta la comisión 0,50% TNA y el derecho BYMA prorrateado a 90 días, con IVA', () => {
  const quote = calcCaucionNeta(CAPITAL, 7, 21.5, {
    comisionTnaPct: 0.50,
    aplicaIva: true,
    iva: 0.21,
    derechosPct90: 0.045,
    derechosConIva: true
  });
  assert.ok(Math.abs(quote.comisionPesos - CAPITAL * 0.005 * 7 / 365 * 1.21) < 0.01);
  assert.ok(Math.abs(quote.derechosPesos - 212.62) < 0.05);
  assert.ok(Math.abs(quote.tnaNeta - 20.67) < 0.02);
  // Config vieja con comisionPct90 se interpreta igual, como TNA.
  const legacy = calcCaucionNeta(CAPITAL, 7, 21.5, { comisionPct90: 0.50, aplicaIva: true, iva: 0.21, derechosPct90: 0.045, derechosConIva: true });
  assert.ok(Math.abs(legacy.comisionPesos - quote.comisionPesos) < 0.001);
  assert.ok(quote.interes < quote.interesBruto);
});

test('el empate de S30N6 contra el 20% de Macro cae cerca de los 15 días', () => {
  const taxOff = {
    alicuotaDebito: 0.006,
    alicuotaCredito: 0.006,
    mismoTitularExento: true,
    quedaEnBroker: false
  };
  const days = breakEvenLecapDays(TNA_LETRA, TNA_MACRO, lecapPurchaseCostFraction(letraFees()), taxOff);
  assert.ok(Math.abs(days - 15.17) < 0.05);

  const conImpuesto = breakEvenLecapDays(TNA_LETRA, TNA_MACRO, lecapPurchaseCostFraction(letraFees()), {
    alicuotaDebito: 0.006,
    alicuotaCredito: 0.006,
    mismoTitularExento: false,
    quedaEnBroker: false
  });
  assert.ok(conImpuesto > 150);

  const antes = Math.floor(days);
  const despues = Math.ceil(days);
  const fees = letraFees();
  const netoAntes = calcLetraNeta(CAPITAL, antes, TNA_LETRA, fees).interes;
  const netoDespues = calcLetraNeta(CAPITAL, despues, TNA_LETRA, fees).interes;
  assert.ok(netoAntes < calcPlazoFijoSimple(CAPITAL, antes, TNA_MACRO).interes);
  assert.ok(netoDespues > calcPlazoFijoSimple(CAPITAL, despues, TNA_MACRO).interes);
});

test('la TNA del FCI sale de las cuotapartes y no de un honorario aparte', () => {
  const rows = [
    { fecha: '2026-10-15', valorCuotaparte: 12676.343 },
    { fecha: '2026-10-22', valorCuotaparte: 12720.788 }
  ];
  const quote = tnaFromCuotapartes(rows, 7);
  assert.equal(quote.tna, 18.28);
  assert.equal(quote.dias, 7);
  assert.equal(quote.fecha, '2026-10-22');

  const colocado = calcFciSimple(CAPITAL, 7, quote.tna);
  assert.equal(colocado.comisionPesos, 0);
  assert.ok(Math.abs(colocado.interes - CAPITAL * (18.28 / 100) * (7 / 365)) < 0.01);
  const gravado = withBankTax(colocado, {
    alicuotaDebito: 0.006,
    alicuotaCredito: 0.006,
    mismoTitularExento: false,
    quedaEnBroker: true
  });
  assert.equal(gravado.credito, 0);
  assert.ok(gravado.debito > 0);
});
