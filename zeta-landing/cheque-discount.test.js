const test = require('node:test');
const assert = require('node:assert/strict');
const { calcChequeCosto, chequeCostoEjemplo } = require('./cheque-discount.js');
const {
  parseBcraMonetarias,
  bcraPanelFromSources,
  bcraSeriesByKey,
  yieldFromPayoff,
  buildChequeLecapQuotes,
  CHEQUE_LECAP_FLOWS,
  pickClosestByDays,
  sameTermPlacement,
  waitVerdict
} = require('./cheque-market.js');

test('el ejemplo del 28/10/2026 cierra a 60 y a 90 días', () => {
  const params = chequeCostoEjemplo();
  const a60 = calcChequeCosto(1000000, 60, params);
  const a90 = calcChequeCosto(1000000, 90, params);

  assert.equal(Math.round(a60.liquido), 952759);
  assert.equal(a60.tnaCostoPct, 30.16);
  assert.equal(a60.tnaSinIcdbPct, 26.33);

  assert.equal(Math.round(a90.liquido), 933346);
  assert.equal(a90.tnaCostoPct, 28.96);
  assert.equal(a90.tnaSinIcdbPct, 26.36);

  assert.ok(a60.teaCostoPct > a60.tnaCostoPct);
  assert.ok(a90.teaCostoPct > a90.tnaCostoPct);
  assert.equal(a60.mavCompra, 0);
  assert.ok(a60.mavVenta > 0);
  assert.ok(a60.alyc > 0);
  assert.equal(a60.ivaInteresesPesos, 0);
  assert.equal(a60.comisionBanco, 0);
  assert.equal(a60.avalSgr, 0);
  assert.equal(a60.sellos, 0);
});

test('sin el impuesto al cheque el líquido es el crédito y la TNA es la de la columna sin ICDB', () => {
  const params = Object.assign(chequeCostoEjemplo(), { icdbAlicuota: 0 });
  const quote = calcChequeCosto(1000000, 60, params);
  assert.equal(quote.icdb, 0);
  assert.equal(Math.round(quote.liquido * 100) / 100, Math.round(quote.preIcdb * 100) / 100);
  assert.equal(quote.tnaCostoPct, 26.33);
});

test('computar el 100% del impuesto deja el líquido en el crédito', () => {
  const full = calcChequeCosto(1000000, 60, chequeCostoEjemplo());
  const micro = calcChequeCosto(1000000, 60, Object.assign(chequeCostoEjemplo(), { computoGanancias: 1 }));
  assert.equal(Math.round(micro.icdbNeto * 100) / 100, 0);
  assert.ok(Math.abs(micro.liquido - full.preIcdb) < 0.01);
  assert.ok(micro.liquido > full.liquido);
});

test('el BCRA que no responde deja la foto cargada y lo marca', () => {
  const panel = bcraPanelFromSources(null);
  assert.equal(panel.status, 'cargado');
  assert.equal(panel.stale, true);
  const sola = bcraSeriesByKey(panel, 'solaFirma');
  const pf = bcraSeriesByKey(panel, 'pf30');
  assert.equal(sola.id, 1216);
  assert.equal(sola.valor, 31.35);
  assert.equal(sola.fecha, '2026-09-30');
  assert.equal(pf.id, 1207);
  assert.equal(pf.valor, 20.92);
  assert.equal(pf.fecha, '2026-10-26');
});

test('una serie viva del BCRA pisa solo esa serie', () => {
  const live = parseBcraMonetarias({
    results: [
      { idVariable: 1207, ultFechaInformada: '2026-10-27', ultValorInformado: 21.1, descripcion: 'PF 30' }
    ]
  });
  const panel = bcraPanelFromSources(live);
  assert.equal(panel.status, 'parcial');
  assert.equal(bcraSeriesByKey(panel, 'pf30').fuente, 'bcra');
  assert.equal(bcraSeriesByKey(panel, 'pf30').valor, 21.1);
  assert.equal(bcraSeriesByKey(panel, 'solaFirma').fuente, 'cargado');
  assert.equal(bcraSeriesByKey(panel, 'solaFirma').stale, true);
});

test('la TNA de la foto de letras reproduce lecap_tir y sin precio queda fechada', () => {
  CHEQUE_LECAP_FLOWS.forEach((flow) => {
    const y = yieldFromPayoff(flow.precio, flow.pagoFinal, flow.dias);
    assert.equal(Math.round(y.tna * 100) / 100, flow.tna);
    assert.equal(Math.round(y.tea * 100) / 100, flow.tea);
  });

  const stale = buildChequeLecapQuotes({});
  assert.equal(stale.status, 'cargado');
  assert.equal(stale.stale, true);
  assert.equal(stale.asOf, '2026-10-28');
  assert.equal(stale.letters.length, CHEQUE_LECAP_FLOWS.length);
  assert.match(stale.flujoNota, /Secretaría de Finanzas/);

  const live = buildChequeLecapQuotes({
    settlement: '2026-10-29',
    data912Rows: [{ symbol: 'S30N6', c: 127.25, v: 10 }]
  });
  assert.equal(live.status, 'mixto');
  const s30 = live.letters.find((letter) => letter.ticker === 'S30N6');
  assert.equal(s30.fuente, 'data912');
  assert.equal(s30.stale, false);
  assert.equal(s30.tna, 23.65);
  const other = live.letters.find((letter) => letter.ticker === 'S29E7');
  assert.equal(other.fuente, 'cargado');
  assert.equal(other.stale, true);
});

test('descontar a la TNA del ejemplo es más caro que esperar en caución o plazo fijo', () => {
  const quote = calcChequeCosto(1000000, 60, chequeCostoEjemplo());
  const caucion = waitVerdict(quote.tnaCosto, 21.3, 'caución');
  const pf = waitVerdict(quote.tnaCosto, 20.92, 'plazo fijo');
  assert.equal(caucion.kind, 'mas_caro');
  assert.match(caucion.texto, /más caro/);
  assert.equal(pf.kind, 'mas_caro');

  const barato = waitVerdict(20, 26, 'la letra');
  assert.equal(barato.kind, 'mas_barato');
  assert.match(barato.texto, /más barato/);

  const closest = pickClosestByDays(60, [
    { days: 30, tna: 23 },
    { days: 62, tna: 24, volume: 10 },
    { days: 61, tna: 22, volume: 5 }
  ]);
  assert.equal(closest.days, 61);

  const pesos = sameTermPlacement(quote.liquido, quote.monto, 60, 21.3);
  assert.ok(pesos.diferencia > 0);
});
