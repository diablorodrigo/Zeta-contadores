/**
 * CONFIGURACIÓN CENTRAL DE ESTUDIOS, TASAS DE MERCADO Y CONTROL DE ACCESO
 */
const ZETA_CONFIG = {
  platformName: "Zeta Finance",
  adminWhatsapp: "5493496462977", // Teléfono de Zeta Finance (formato internacional sin +)
  googleSheetWebhookUrl: "https://script.google.com/macros/s/AKfycby0gRVsJhZb7O47pdyYmzlCitexqvoVINYcXoUhd9oz4wLLzplihfc_h7wXtCTRssPI/exec", // URL de Google Apps Script para sincronización de leads

  // Sincronización automática de tasas de mercado
  ratesConfig: {
    refreshIntervalMinutes: 30, // Se actualiza automáticamente cada 30 minutos
    apiEndpoint: "/api/rates",   // Endpoint serverless de Vercel
    directCaucionesUrl: "https://api.argentinadatos.com/v1/finanzas/cauciones/ars",
    directPlazoFijoUrl: "https://api.argentinadatos.com/v1/finanzas/tasas/depositos30Dias"
  },

  // TASAS DE RESPALDO ACTUALIZADAS AL MERCADO REAL
  marketRates: {
    caucionByDays: {
      3: 20.5,   // Fin de semana (3 días) - ~20.5% TNA
      7: 21.5,   // 7 días - ~21.5% TNA
      10: 22.0,  // 10 días - ~22.0% TNA
      15: 22.5,  // 15 días - ~22.5% TNA
      30: 23.5   // 30 días - ~23.5% TNA
    },
    defaultCaucionTNA: 21.5,
    plazoFijoTNA: 19.5, // Promedio grandes bancos a 30 días (~19.5% TNA)
    lecapTNA: 26.5,     // LECAP corta de referencia de mercado (~26.5% TNA)
    lecapDetails: {
      ticker: "S30N6",                       // Ticker de la letra activa vigente
      vencimiento: "30/11/2026",              // Fecha de vencimiento (30 de Noviembre)
      nombre: "LECAP Vencimiento Noviembre 2026",
      diasAlVencimiento: 38                  // Días remanentes aproximados
    },
    usdRateAnnual: 5.0  // Tasa fija en dólares
  },

  // Descuento de cheques: tasas de EJEMPLO, editables a mano.
  // El refresco de caución / LECAP / plazo fijo no las pisa.
  // Cambialas acá hasta conectar una fuente en vivo.
  // tnaDesc, derechosPct y tnaArancel van en puntos (27.5 = 27,5%).
  // iva va en decimal (0.21 = 21%). Las fórmulas están en cheque-discount.js.
  chequeDiscount: {
    bankLabel: "Banco Macro",
    bank: {
      tnaDesc: 27.5,      // referencia de mercado del ejemplo (TNA de descuento)
      derechosPct: 0.06,  // derechos de mercado, % sobre el nominal
      tnaArancel: 1.0     // TNA de arancel
    },
    zeta: {
      tnaDesc: 25.5,      // un poco más competitiva que el banco de ejemplo
      derechosPct: 0.05,
      tnaArancel: 0.7
    },
    iva: 0.21
  },

  // Listado de Estudios Aliados y sus PINs
  studios: {
    "4829": {
      id: "estudio-perez",
      name: "Estudio Pérez & Asociados",
      subtitle: "Asesoramiento Contable & Financiero PyME",
      city: "Salta, Argentina",
      primaryColor: "#1e3a8a",
      accentColor: "#2563eb",
      hideZetaBranding: false,
      customWhatsappNote: "Canal preferencial Estudio Pérez"
    },
    "1042": {
      id: "estudio-gomez",
      name: "Gómez & Consultores",
      subtitle: "Auditoría y Gestión Tributaria",
      city: "Córdoba, Argentina",
      primaryColor: "#065f46",
      accentColor: "#059669",
      hideZetaBranding: false,
      customWhatsappNote: "Derivado por Gómez & Consultores"
    },
    "9999": {
      id: "zeta-demo",
      name: "Zeta Finance Partner Demo",
      subtitle: "Entorno de Demostración para Contadores",
      city: "Argentina",
      primaryColor: "#0f172a",
      accentColor: "#6366f1",
      hideZetaBranding: false,
      customWhatsappNote: "Demo comercial"
    }
  }
};
