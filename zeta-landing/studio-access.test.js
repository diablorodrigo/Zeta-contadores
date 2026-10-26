const test = require('node:test');
const assert = require('node:assert/strict');
const { matchStudioPin, matchStudioQuery } = require('./studio-access.js');

const SHEET = {
  '9081': {
    id: 'estudio-a',
    name: 'Estudio Alfa',
    subtitle: 'Contable',
    city: 'Salta',
    primaryColor: '#1e3a8a',
    accentColor: '#2563eb',
    hideZetaBranding: false,
    customWhatsappNote: 'nota'
  },
  '6704': {
    id: 'estudio-b',
    name: 'Estudio Beta',
    subtitle: 'Impuestos',
    city: 'Córdoba'
  }
};

test('un PIN válido devuelve solo ese estudio y no el resto de la lista', () => {
  const match = matchStudioPin(SHEET, '9081');
  assert.equal(match.ok, true);
  assert.equal(match.studio.name, 'Estudio Alfa');
  assert.equal(match.studio.id, 'estudio-a');
  const packed = JSON.stringify(match);
  assert.equal(packed.includes('6704'), false);
  assert.equal(packed.includes('Estudio Beta'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(match.studio, 'pin'), false);
});

test('un PIN desconocido o corto no abre el simulador', () => {
  assert.equal(matchStudioPin(SHEET, '0000').ok, false);
  assert.equal(matchStudioPin(SHEET, '908').error, 'pin');
  assert.equal(matchStudioPin(null, '9081').ok, false);
});

test('el parámetro estudio matchea por id sin devolver códigos', () => {
  const match = matchStudioQuery(SHEET, 'estudio-b');
  assert.equal(match.ok, true);
  assert.equal(match.studio.name, 'Estudio Beta');
  assert.equal(JSON.stringify(match).includes('1111'), false);
});
