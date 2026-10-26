const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTheme, readableOn, STORAGE_KEY } = require('./theme.js');

test('la clave de localStorage es estable', () => {
  assert.equal(STORAGE_KEY, 'zeta-theme');
});

test('una elección guardada gana a la preferencia del sistema', () => {
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
});

test('sin elección, sigue prefers-color-scheme y cae en oscuro', () => {
  assert.equal(resolveTheme(null, true), 'light');
  assert.equal(resolveTheme(undefined, false), 'dark');
  assert.equal(resolveTheme('', false), 'dark');
  assert.equal(resolveTheme('auto', true), 'light');
  assert.equal(resolveTheme('auto', false), 'dark');
});

test('el texto de la marca queda legible sobre el color del estudio', () => {
  assert.equal(readableOn('#1e3a8a'), '#ffffff');
  assert.equal(readableOn('#0f172a'), '#ffffff');
  assert.equal(readableOn('#ffffff'), '#0f172a');
  assert.equal(readableOn('#f8fafc'), '#0f172a');
  assert.equal(readableOn('#facc15'), '#0f172a');
  assert.equal(readableOn('abc'), '#ffffff');
  assert.equal(readableOn('#abc'), readableOn('#aabbcc'));
});
