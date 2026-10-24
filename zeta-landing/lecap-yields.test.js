const test = require('node:test');
const assert = require('node:assert/strict');
const {
  payoffExactFromTem,
  resolveLecapTerms,
  buildLecapCurve,
  quoteCalendar,
  mergeLecapPrices,
  parseTemPct
} = require('./lecap-yields.js');

const FRIDAY_CLOSE = new Date('2026-10-24T15:30:00.000Z');

const DATA912_FRIDAY = [
  { symbol: 'S30O6', c: 134.989, v: 2003653702, px_bid: 134.96, px_ask: 134.989 },
  { symbol: 'S13N6', c: 108.435, v: 52681184620, px_bid: 108.435, px_ask: 108.438 },
  { symbol: 'S30N6', c: 127.09, v: 48797594850, px_bid: 127.07, px_ask: 127.09 },
  { symbol: 'S29E7', c: 104.932, v: 4051084049, px_bid: 104.932, px_ask: 104.95 },
  { symbol: 'S2N6D', c: 0.07, v: 20000 },
  { symbol: 'X30N6', c: 129, v: 1000 },
  { symbol: 'D30O6', c: 152800, v: 1000 }
];

test('el payoff contractual redondeado coincide con el flujo publicado', () => {
  const cases = [
    ['S30O6', 2.55, '2025-10-31', '2026-10-30', 135.28],
    ['S13N6', 2.10, '2026-06-30', '2026-11-13', 109.65],
    ['S30N6', 2.30, '2025-12-15', '2026-11-30', 129.89],
    ['S29E7', 2.25, '2026-08-31', '2027-01-29', 111.68]
  ];
  cases.forEach(([ticker, tem, issue, maturity, cents]) => {
    const exact = payoffExactFromTem(tem, issue, maturity);
    assert.equal(Math.round(exact * 100) / 100, cents, ticker);
  });
});

test('la ficha sin TEM usa la tasa verificada y no asume VN 100', () => {
  const s13 = resolveLecapTerms('S13N6', {
    fechaEmision: '2026-06-30 00:00:00.0',
    fechaVencimiento: '2026-11-13 00:00:00.0',
    interes: 'Pagarán una tasa efectiva mensual capitalizable mensualmente hasta el vencimiento del instrumento.',
    denominacion: 'LETRA DEL TESORO NACIONAL CAPITALIZABLE EN PESOS'
  });
  assert.equal(s13.temPct, 2.10);
  assert.equal(s13.temSource, 'tem_verificada');
  assert.equal(s13.payoffPor100, 109.65);

  const unknown = resolveLecapTerms('S31Z9', {
    fechaEmision: '2026-01-01 00:00:00.0',
    fechaVencimiento: '2026-06-30 00:00:00.0',
    interes: 'A descuento.',
    denominacion: 'LETRA'
  });
  assert.equal(unknown, null);

  const parsed = parseTemPct('Tasa efectiva mensual: 2,30 %');
  assert.equal(parsed, 2.30);
  const fromFicha = resolveLecapTerms('S30N6', {
    fechaEmision: '2025-12-15 00:00:00.0',
    fechaVencimiento: '2026-11-30 00:00:00.0',
    interes: 'Tasa efectiva mensual: 2,30 %',
    denominacion: 'LETRA DEL TESORO NACIONAL CAPITALIZABLE EN PESOS'
  });
  assert.equal(fromFicha.temSource, 'byma_ficha');
  assert.equal(fromFicha.payoffPor100, 129.89);
});

test('un sábado usa el cierre del viernes y la liquidación del lunes', () => {
  const calendar = quoteCalendar(FRIDAY_CLOSE);
  assert.equal(calendar.artDate, '2026-10-24');
  assert.equal(calendar.tradeDate, '2026-10-23');
  assert.equal(calendar.settlement, '2026-10-26');
  assert.equal(calendar.marketOpen, false);

  const mondayOpen = quoteCalendar(new Date('2026-10-26T15:00:00.000Z'));
  assert.equal(mondayOpen.artDate, '2026-10-26');
  assert.equal(mondayOpen.tradeDate, '2026-10-26');
  assert.equal(mondayOpen.settlement, '2026-10-27');
  assert.equal(mondayOpen.marketOpen, true);

  const beforeBell = quoteCalendar(new Date('2026-10-26T13:00:00.000Z'));
  assert.equal(beforeBell.marketOpen, false);
  assert.equal(beforeBell.tradeDate, '2026-10-23');

  const bancario = quoteCalendar(new Date('2026-11-06T15:00:00.000Z'));
  assert.equal(bancario.tradeDate, '2026-11-06');
  assert.equal(bancario.marketOpen, true);
  assert.equal(bancario.settlement, '2026-11-11');
});

test('Data912 manda el precio y un trade en cero de BYMA no lo pisa', () => {
  const merged = mergeLecapPrices(DATA912_FRIDAY, [
    {
      symbol: 'S30N6',
      settlementType: '2',
      denominationCcy: 'ARS',
      trade: 0,
      vwap: 0,
      bidPrice: 0,
      offerPrice: 0,
      closingPrice: 0,
      previousClosingPrice: 0
    },
    {
      symbol: 'S10N5',
      settlementType: '2',
      denominationCcy: 'ARS',
      trade: 101.5,
      closingPrice: 101.5,
      tradeVolume: 10
    }
  ]);
  assert.equal(merged.S30N6.price, 127.09);
  assert.equal(merged.S30N6.source, 'data912');
  assert.equal(merged.S10N5.source, 'byma');
  assert.equal(merged.S2N6D, undefined);
  assert.equal(merged.X30N6, undefined);
});

test('la curva del 24/10/2026 calcula TNA, TEA y TIR de cada letra', () => {
  const curve = buildLecapCurve({
    now: FRIDAY_CLOSE,
    data912Rows: DATA912_FRIDAY,
    bymaRows: [],
    fichas: {}
  });
  assert.ok(curve);
  assert.equal(curve.marketOpen, false);
  assert.equal(curve.source, 'data912');
  assert.equal(curve.reference.ticker, 'S30N6');
  assert.equal(curve.reference.dias, 35);
  assert.equal(curve.reference.tna, 22.96);
  assert.deepEqual(
    curve.letters.map((letter) => letter.ticker),
    ['S30O6', 'S13N6', 'S30N6', 'S29E7']
  );

  const byTicker = Object.fromEntries(curve.letters.map((letter) => [letter.ticker, letter]));
  assert.equal(byTicker.S30O6.dias, 4);
  assert.equal(byTicker.S30O6.payoffPor100, 135.28);
  assert.equal(byTicker.S30O6.tna, 19.55);
  assert.equal(byTicker.S30O6.tea, 21.57);
  assert.equal(byTicker.S30O6.tir, 21.57);

  assert.equal(byTicker.S13N6.dias, 18);
  assert.equal(byTicker.S13N6.payoffPor100, 109.65);
  assert.equal(byTicker.S13N6.tna, 22.75);
  assert.equal(byTicker.S13N6.tea, 25.38);
  assert.equal(byTicker.S13N6.tir, byTicker.S13N6.tea);

  assert.equal(byTicker.S30N6.dias, 35);
  assert.equal(byTicker.S30N6.payoffPor100, 129.89);
  assert.equal(byTicker.S30N6.tna, 22.96);
  assert.equal(byTicker.S30N6.tea, 25.50);
  assert.equal(byTicker.S30N6.tir, 25.50);

  assert.equal(byTicker.S29E7.dias, 95);
  assert.equal(byTicker.S29E7.payoffPor100, 111.68);
  assert.equal(byTicker.S29E7.tna, 24.73);
  assert.equal(byTicker.S29E7.tea, 27.08);
});

test('bajo 30 días no se usa como referencia si hay una letra que llega al plazo fijo', () => {
  const onlyShort = buildLecapCurve({
    now: FRIDAY_CLOSE,
    data912Rows: DATA912_FRIDAY.filter((row) => row.symbol === 'S30O6' || row.symbol === 'S13N6'),
    bymaRows: [],
    fichas: {}
  });
  assert.equal(onlyShort.reference.ticker, 'S30O6');
  assert.equal(onlyShort.letters.length, 2);

  const nearest = buildLecapCurve({
    now: FRIDAY_CLOSE,
    referenceMinDays: 0,
    data912Rows: DATA912_FRIDAY,
    bymaRows: [],
    fichas: {}
  });
  assert.equal(nearest.reference.ticker, 'S30O6');
});

test('si las dos fuentes vienen vacías no se inventa una curva', () => {
  const curve = buildLecapCurve({
    now: FRIDAY_CLOSE,
    data912Rows: [{ symbol: 'S30N6', c: 0, px_bid: 0, px_ask: 0 }],
    bymaRows: [{ symbol: 'S30N6', settlementType: '2', denominationCcy: 'ARS', trade: 0 }],
    fichas: {}
  });
  assert.equal(curve, null);
});
