/**
 * POST /api/lead
 * Reenvía el prospecto al Apps Script. El navegador no necesita la URL.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { sheetWebhookUrl } = require('../studio-access.js');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false });
    return;
  }

  const webhook = sheetWebhookUrl();
  if (!webhook) {
    res.status(503).json({ ok: false, error: 'sheet_no_configurado', missing: ['GOOGLE_SHEET_WEBHOOK_URL'] });
    return;
  }

  const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  try {
    const upstream = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: payload,
      signal: AbortSignal.timeout(8000),
      redirect: 'follow'
    });
    res.status(upstream.ok ? 200 : 502).json({ ok: upstream.ok });
  } catch (error) {
    res.status(502).json({ ok: false, error: 'sheet' });
  }
}
