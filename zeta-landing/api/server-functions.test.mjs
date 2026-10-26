/**
 * Reproduce el empaquetado de Vercel (@vercel/node 27):
 * 1. @vercel/nft 1.10 se queda solo con los archivos que el handler referencia.
 * 2. Babel (@babel/plugin-transform-modules-commonjs 7.24.1) baja el ESM a CJS,
 *    que es lo que hace el builder cuando no hay "type": "module".
 * 3. Node carga ese CJS. Si el compilado conserva import.meta, o si falta
 *    un módulo en el trace, el require revienta: el mismo
 *    FUNCTION_INVOCATION_FAILED de producción.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { nodeFileTrace } from '@vercel/nft';
import babel from '@babel/core';
import commonjs from '@babel/plugin-transform-modules-commonjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HANDLERS = {
  'api/pin.js': {
    files: ['studio-access.js'],
    exports: { 'studio-access.js': ['matchStudioPin', 'matchStudioQuery', 'sheetWebhookUrl'] }
  },
  'api/lead.js': {
    files: ['studio-access.js'],
    exports: { 'studio-access.js': ['sheetWebhookUrl'] }
  },
  'api/rates.js': {
    files: ['caucion-buckets.js', 'macro-vs-letra.js', 'lecap-yields.js', 'broker-costs.js'],
    exports: {
      'caucion-buckets.js': ['bucketCaucionQuotes'],
      'macro-vs-letra.js': ['macroBandsFromArgentinaDatos'],
      'lecap-yields.js': ['buildLecapCurve', 'tradableLecaps'],
      'broker-costs.js': ['tnaFromCuotapartes']
    }
  }
};

function tracedFiles(result) {
  const list = result.fileList instanceof Set ? [...result.fileList] : [...result.fileList];
  return list.map((file) => {
    if (path.isAbsolute(file)) return path.relative(root, file);
    return file;
  });
}

function compileLikeVercel(filename, source) {
  const { code } = babel.transformSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    sourceType: 'module',
    compact: false,
    parserOpts: {
      plugins: [
        'asyncGenerators',
        'objectRestSpread',
        'optionalCatchBinding',
        'numericSeparator',
        'dynamicImport',
        'importMeta'
      ]
    },
    plugins: [commonjs]
  });
  return code;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

for (const [entry, spec] of Object.entries(HANDLERS)) {
  test(`el bundle de ${entry} incluye los módulos y carga como CJS`, async () => {
    const traced = await nodeFileTrace([path.join(root, entry)], {
      base: root,
      processCwd: root
    });
    const files = new Set(tracedFiles(traced));
    for (const dep of spec.files) {
      assert.ok(files.has(dep), `${entry} no traza ${dep}. Quedó: ${[...files].join(', ')}`);
    }

    const dir = await mkdtemp(path.join(tmpdir(), 'zeta-fn-'));
    try {
      for (const rel of files) {
        if (!rel || rel.startsWith('..') || rel.includes('node_modules')) continue;
        const from = path.join(root, rel);
        const to = path.join(dir, rel);
        await mkdir(path.dirname(to), { recursive: true });
        await copyFile(from, to);
      }
      for (const dep of spec.files) {
        await assert.doesNotReject(readFile(path.join(dir, dep)), `${dep} no está en el bundle`);
      }

      const source = await readFile(path.join(dir, entry), 'utf8');
      const code = compileLikeVercel(path.basename(entry), source);
      assert.doesNotMatch(stripComments(code), /import\.meta/, 'el CJS compilado todavía tiene import.meta');
      for (const dep of spec.files) {
        assert.match(code, new RegExp(dep.replace('.', '\\.')));
      }

      const compiledPath = path.join(dir, entry);
      await writeFile(compiledPath, code);
      const loaded = require(compiledPath);
      assert.equal(typeof loaded.default, 'function');

      for (const [dep, names] of Object.entries(spec.exports)) {
        const mod = require(path.join(dir, dep));
        for (const name of names) {
          assert.equal(typeof mod[name], 'function', `${dep} no exporta ${name}`);
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('getStudios que no es JSON responde 502 y no un 500', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => 'Script function not found: doGet'
  });
  try {
    const { default: handler } = await import('./pin.js');
    const res = mockRes();
    await handler({ query: { pin: '0000' } }, res);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { ok: false, error: 'sheet', missing: undefined });
  } finally {
    globalThis.fetch = original;
  }
});

test('getStudios con HTML de Google también responde 502', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<!DOCTYPE html><html><head><script>window[\'ppConfig\']</script></head></html>'
  });
  try {
    const { default: handler } = await import('./pin.js');
    const res = mockRes();
    await handler({ query: { pin: '0000' } }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'sheet');
  } finally {
    globalThis.fetch = original;
  }
});

test('un PIN del sheet responde 200 y no filtra el mapa', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      studios: {
        '9081': { id: 'estudio-a', name: 'Estudio Alfa', pin: '9081' },
        '6704': { id: 'estudio-b', name: 'Estudio Beta' }
      }
    })
  });
  try {
    const { default: handler } = await import('./pin.js');
    const res = mockRes();
    await handler({ query: { pin: '9081' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.studio.name, 'Estudio Alfa');
    assert.equal(JSON.stringify(res.body).includes('6704'), false);
    assert.equal(JSON.stringify(res.body).includes('"pin"'), false);
  } finally {
    globalThis.fetch = original;
  }
});
