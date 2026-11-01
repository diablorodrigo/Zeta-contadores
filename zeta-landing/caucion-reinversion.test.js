const test = require('node:test');
const assert = require('node:assert/strict');
const { calcCaucionNeta, caucionTramos, calcCaucionReinversion } = require('./broker-costs.js');

const IOL = { arancelTnaPct: 1.80, aplicaIva: true, iva: 0.21, derechosPct90: 0.045, derechosConIva: true, derechosBase: 'contado' };

test('reproduce la boleta IOL: 1 día, $6.023.776 al 19,60%', () => {
  const q = calcCaucionNeta(6023776, 1, 19.6, IOL);
  assert.ok(Math.abs(q.comisionPesos / 1.21 - 297.06) < 0.01);
  assert.ok(Math.abs(q.derechosPesos / 1.21 - 30.12) < 0.01);
  assert.ok(Math.abs((q.interesBruto - q.interes) - 395.88) < 0.02);
  assert.ok(Math.abs(q.interes - 2838.81) < 0.02);
});

test('esquema de tramos', () => {
  assert.deepEqual(caucionTramos(3), [3]);
  assert.deepEqual(caucionTramos(7), [7]);
  assert.deepEqual(caucionTramos(10), [7, 3]);
  assert.deepEqual(caucionTramos(15), [7, 7, 1]);
  assert.deepEqual(caucionTramos(30), [7, 7, 7, 7, 2]);
});

test('la reinversión capitaliza y cada tramo usa la TNA de su plazo', () => {
  const curve = { 3: 21, 7: 20.5, 10: 20.1, 15: 19.2, 30: 22.8 };
  const r = calcCaucionReinversion(5000000, 15, curve, IOL);
  assert.equal(r.esquema, '7+7+1');
  assert.deepEqual(r.tramos.map(t => t.tnaBruta), [20.5, 20.5, 21]);
  assert.ok(r.tramos[1].capital > r.tramos[0].capital);
  const simple = calcCaucionNeta(5000000, 15, 19.2, IOL);
  assert.ok(r.tnaNeta > simple.tnaNeta);
  assert.ok(r.tea > r.tnaNeta);
  // Con la misma TNA en todos los tramos, compuesto > simple.
  const flat = calcCaucionReinversion(5000000, 14, { 7: 20 }, IOL);
  assert.ok(flat.interes > calcCaucionNeta(5000000, 14, 20, IOL).interes);
});
