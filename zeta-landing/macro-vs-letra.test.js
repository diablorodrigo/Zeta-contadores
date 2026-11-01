const test = require('node:test');
const assert = require('node:assert/strict');
const { pickMacroBand } = require('./macro-vs-letra.js');
const ZETA_CONFIG = require('vm').runInNewContext(require('fs').readFileSync(__dirname + '/config.js', 'utf8') + ';ZETA_CONFIG');

test('plazo fijo Macro a 30 días: 20% desde $5 M y 19,5% por debajo (PDF Macro 28/10/2026)', () => {
  const bands = ZETA_CONFIG.macroVsLetra.bands;
  assert.equal(pickMacroBand(bands, 5000000, 30).tna, 20);
  assert.equal(pickMacroBand(bands, 4999999, 30).tna, 19.5);
  assert.equal(ZETA_CONFIG.macroVsLetra.verificadoAl, '2026-10-28');
});
