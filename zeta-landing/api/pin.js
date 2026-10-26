/**
 * GET /api/pin?pin=1234
 * GET /api/pin?estudio=nombre
 *
 * Contrasta el código con el Google Sheet de estudios habilitados y
 * responde solo la ficha de ese estudio. No devuelve la lista.
 *
 * Hace falta GOOGLE_SHEET_WEBHOOK_URL en el servidor. Si no está, se usa
 * la URL de Apps Script que ya estaba en el proyecto (sheet-endpoint vía
 * studio-access.js). Eso no es un secreto: el script sigue respondiendo
 * getStudios sin token. Para que el PIN deje de ser público falta
 * STUDIO_SHEET_TOKEN y que el Apps Script lo exija. Ver README.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { matchStudioPin, matchStudioQuery, sheetWebhookUrl } = require('../studio-access.js');

async function loadStudios() {
  const webhook = sheetWebhookUrl();
  if (!webhook) {
    const error = new Error('sheet_no_configurado');
    error.code = 'sheet_no_configurado';
    throw error;
  }
  const url = new URL(webhook);
  url.searchParams.set('action', 'getStudios');
  const token = process.env.STUDIO_SHEET_TOKEN || '';
  if (token) url.searchParams.set('token', token);
  const upstream = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
    redirect: 'follow'
  });
  if (!upstream.ok) {
    const error = new Error('sheet');
    error.code = 'sheet';
    throw error;
  }
  const body = await upstream.json();
  return body && body.studios ? body.studios : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const studios = await loadStudios();
    const pin = req.query && req.query.pin;
    const estudio = req.query && req.query.estudio;
    const match = pin ? matchStudioPin(studios, pin) : matchStudioQuery(studios, estudio);
    res.status(match.ok ? 200 : 401).json(match);
  } catch (error) {
    const code = error && error.code === 'sheet_no_configurado' ? 'sheet_no_configurado' : 'sheet';
    const status = code === 'sheet_no_configurado' ? 503 : 502;
    res.status(status).json({
      ok: false,
      error: code,
      missing: code === 'sheet_no_configurado' ? ['GOOGLE_SHEET_WEBHOOK_URL'] : undefined
    });
  }
}
