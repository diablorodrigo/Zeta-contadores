/**
 * El PIN no se resuelve en el navegador.
 * /api/pin llama al Sheet y esta función devuelve solo el estudio que
 * coincide. No reenvía el mapa ni otros códigos.
 */

function publicStudio(studio) {
  var source = studio || {};
  return {
    id: source.id || '',
    name: source.name || 'Estudio',
    subtitle: source.subtitle || '',
    city: source.city || '',
    primaryColor: source.primaryColor || '#0f172a',
    accentColor: source.accentColor || '#2563eb',
    hideZetaBranding: !!source.hideZetaBranding,
    customWhatsappNote: source.customWhatsappNote || ''
  };
}

function matchStudioPin(studios, pin) {
  var code = String(pin || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(code)) return { ok: false, error: 'pin' };
  if (!studios || typeof studios !== 'object' || !studios[code]) {
    return { ok: false, error: 'desconocido' };
  }
  return { ok: true, studio: publicStudio(studios[code]) };
}

function matchStudioQuery(studios, query) {
  var needle = String(query || '').trim().toLowerCase();
  if (!needle || !studios || typeof studios !== 'object') {
    return { ok: false, error: 'desconocido' };
  }
  var codes = Object.keys(studios);
  for (var i = 0; i < codes.length; i++) {
    var studio = studios[codes[i]] || {};
    var id = String(studio.id || '').toLowerCase();
    var name = String(studio.name || '').toLowerCase();
    if (id === needle || name.indexOf(needle) !== -1) {
      return { ok: true, studio: publicStudio(studio) };
    }
  }
  return { ok: false, error: 'desconocido' };
}

var DEFAULT_SHEET_WEBHOOK = 'https://script.google.com/macros/s/AKfycby0gRVsJhZb7O47pdyYmzlCitexqvoVINYcXoUhd9oz4wLLzplihfc_h7wXtCTRssPI/exec';

function sheetWebhookUrl() {
  var fromEnv = process.env.GOOGLE_SHEET_WEBHOOK_URL || process.env.ZETA_SHEET_WEBHOOK_URL || '';
  return String(fromEnv || DEFAULT_SHEET_WEBHOOK).trim();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    publicStudio: publicStudio,
    matchStudioPin: matchStudioPin,
    matchStudioQuery: matchStudioQuery,
    sheetWebhookUrl: sheetWebhookUrl,
    DEFAULT_SHEET_WEBHOOK: DEFAULT_SHEET_WEBHOOK
  };
}
