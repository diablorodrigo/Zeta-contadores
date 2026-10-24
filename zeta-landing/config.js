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
    bymaCaucionesUrl: "https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/cauciones",
    directLecapUrl: "https://data912.com/live/arg_notes",
    bymaLecapUrl: "https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/lebacs",
    bymaFichaUrl: "https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/bnown/fichatecnica/especies/general",
    directPlazoFijoUrl: "https://api.argentinadatos.com/v1/finanzas/tasas/depositos30Dias",
    directMacroPlazoFijoUrl: "https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo",
    directFciHistoricoUrl: "https://api.argentinadatos.com/v1/finanzas/fci/fondos/balanz-capital-money-market-clase-a/historico"
  },

  // TASAS DE RESPALDO. La caución en vivo sale de BYMA (ver api/rates.js).
  // Si BYMA no responde, estos cinco plazos siguen siendo editables a mano
  // y el instrumento Caución usa el del horizonte elegido (3/7/10/15/30).
  // ArgentinaDatos /cauciones/ars suele devolver [] (snapshot IOL vacío): no
  // es la fuente primaria.
  marketRates: {
    caucionByDays: {
      3: 20.5,   // Fin de semana (3 días) - respaldo editable
      7: 21.5,   // 7 días
      10: 22.0,  // 10 días
      15: 22.5,  // 15 días
      30: 23.5   // 30 días
    },
    defaultCaucionTNA: 21.5,
    plazoFijoTNA: 19.5, // Promedio grandes bancos a 30 días (~19.5% TNA)
    // Respaldo si Data912 y BYMA no traen precio. Cierre del 23/10/2026.
    // La referencia es S30N6 (35 días): la más corta que llega al mínimo
    // del plazo fijo. TNA simple 22,96%. La TIR de esa letra es 25,50%.
    // Paga 129,89 cada 100 nominales el 30/11/2026 (TEM 2,30%).
    lecapTNA: 22.96,
    lecapDetails: {
      ticker: "S30N6",
      vencimiento: "30/11/2026",
      nombre: "LECAP Vto. 30/11/2026",
      diasAlVencimiento: 35,
      precio: 127.09,
      payoffPor100: 129.89,
      temPct: 2.30,
      tna: 22.96,
      tea: 25.50,
      tir: 25.50,
      fuente: "config"
    },
    lecaps: [
      { ticker: "S30O6", tna: 19.55, tea: 21.57, tir: 21.57, dias: 4, vencimiento: "30/10/2026", precio: 134.989, payoffPor100: 135.28, fuente: "config" },
      { ticker: "S13N6", tna: 22.75, tea: 25.38, tir: 25.38, dias: 18, vencimiento: "13/11/2026", precio: 108.435, payoffPor100: 109.65, fuente: "config" },
      { ticker: "S30N6", tna: 22.96, tea: 25.50, tir: 25.50, dias: 35, vencimiento: "30/11/2026", precio: 127.09, payoffPor100: 129.89, fuente: "config" },
      { ticker: "S29E7", tna: 24.73, tea: 27.08, tir: 27.08, dias: 95, vencimiento: "29/01/2027", precio: 104.932, payoffPor100: 111.68, fuente: "config" }
    ],
    usdRateAnnual: 5.0, // Tasa fija en dólares
    // Respaldo del FCI de liquidez. Cuotaparte de Balanz Capital Money Market
    // clase A, 15/10/2026 a 22/10/2026 (7 días corridos): TNA 18,28%.
    // /api/rates lo pisa con la serie de ArgentinaDatos (CNV).
    fciTNA: 18.28,
    fciDetails: {
      nombre: "Balanz Capital Money Market - Clase A",
      tna: 18.28,
      fecha: "2026-10-22",
      fechaInicio: "2026-10-15",
      dias: 7,
      vcp: 12720.788,
      vcpInicio: 12676.343,
      plazoRescateDias: 0,
      fuente: "config"
    }
  },

  // Comisiones de referencia: Balanz, editable. Puntos (0.10 = 0,10%).
  // iva en decimal (0.21 = 21%). Las fórmulas están en broker-costs.js.
  // Letras: una sola compra, sin venta. Derechos BYMA agosto 2026, contado
  // PPT letras 0,0010%, sin IVA (título público).
  // Caución colocadora en pesos: 0,50% prorrateado cada 90 días, más IVA.
  // Derecho BYMA de caución 0,0450% proporcional hasta 90 días, sobre el
  // mayor valor, más IVA.
  brokerCosts: {
    label: "Balanz",
    nota: "Comisiones de referencia: Balanz, editable",
    iva: 0.21,
    lecap: {
      comisionPct: 0.10,
      aplicaIva: true,
      derechosPct: 0.001
    },
    caucion: {
      comisionPct90: 0.50,
      aplicaIva: true,
      derechosPct90: 0.045,
      derechosConIva: true
    },
    fci: {
      comisionSuscripcionPct: 0,
      comisionRescatePct: 0,
      // Honorarios gerente + depositaria de la clase A (ficha CAFCI). Ya
      // están en la cuotaparte: no se restan otra vez.
      honorariosAnualesPct: 2.45,
      honorariosEnCuotaparte: true
    }
  },

  // Ley 25.413. Alícuota general: Decreto 380/2001, art. 7, 6‰ y 6‰.
  // Default: transferencia entre cuentas del mismo titular, exenta
  // (Decreto 301/2021). El plazo fijo del mismo banco no se grava.
  impuestoDebCred: {
    alicuotaDebito: 0.006,
    alicuotaCredito: 0.006,
    mismoTitularExento: true,
    quedaEnBroker: false,
    nota: "Las MiPyME pueden computar una parte como pago a cuenta de Ganancias según la categoría. El porcentaje lo confirma el contador. Esta simulación no lo resta."
  },

  // Descuento de cheques: tasas de EJEMPLO, editables a mano.
  // El refresco de caución / LECAP / plazo fijo no las pisa.
  // Cambialas acá hasta conectar una fuente en vivo.
  // tnaDesc, derechosPct y tnaArancel van en puntos (27.5 = 27,5%).
  // iva va en decimal (0.21 = 21%). Las fórmulas están en cheque-discount.js.
  // Derechos y arancel ya están en esa cuenta. No se suma encima la comisión
  // de letras (0,10%), la de caución (0,50% / 90 días) ni la del FCI.
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

  // Plazo fijo Banco Macro vs letra corta. Las fórmulas están en macro-vs-letra.js.
  // Los tramos son un ejemplo editable (ArgentinaDatos, BANCO MACRO, oct 2026,
  // banda chica ~19,5% a 30 días hasta $5 M). Si /api/rates trae macroPlazoFijoBands,
  // esas filas pisan estos presets hasta que el contador edite la TNA en la reunión.
  // La TNA bruta de la letra sale de marketRates.lecapTNA (config o /api/rates).
  //
  // La comisión, el IVA y los derechos de la letra salen de brokerCosts.
  // Estos campos quedan como espejo por si algo lee macroVsLetra.letra.
  // La membresía mensual no se prorratea.
  macroVsLetra: {
    bankLabel: "Banco Macro",
    minDias: 30,
    bands: [
      { montoMin: 1, montoMax: 4999999.99, plazoMin: 30, plazoMax: 35, tna: 19.5 },
      { montoMin: 5000000, montoMax: null, plazoMin: 30, plazoMax: 35, tna: 20 },
      { montoMin: 1, montoMax: 4999999.99, plazoMin: 36, plazoMax: 44, tna: 19.5 },
      { montoMin: 5000000, montoMax: null, plazoMin: 36, plazoMax: 44, tna: 20 },
      { montoMin: 1, montoMax: 4999999.99, plazoMin: 45, plazoMax: 59, tna: 19.5 },
      { montoMin: 5000000, montoMax: null, plazoMin: 45, plazoMax: 59, tna: 20 },
      { montoMin: 1, montoMax: 4999999.99, plazoMin: 60, plazoMax: 89, tna: 20 },
      { montoMin: 5000000, montoMax: null, plazoMin: 60, plazoMax: 89, tna: 20.5 },
      { montoMin: 1, montoMax: 4999999.99, plazoMin: 90, plazoMax: 119, tna: 20 },
      { montoMin: 5000000, montoMax: null, plazoMin: 90, plazoMax: 119, tna: 20.5 },
      { montoMin: 1, montoMax: 4999999.99, plazoMin: 120, plazoMax: 179, tna: 21 },
      { montoMin: 5000000, montoMax: null, plazoMin: 120, plazoMax: 179, tna: 21.5 },
      { montoMin: 1, montoMax: 4999999.99, plazoMin: 180, plazoMax: 270, tna: 21 },
      { montoMin: 5000000, montoMax: null, plazoMin: 180, plazoMax: 270, tna: 21.5 },
      { montoMin: 1, montoMax: 4999999.99, plazoMin: 271, plazoMax: 365, tna: 21.5 },
      { montoMin: 5000000, montoMax: null, plazoMin: 271, plazoMax: 365, tna: 22 }
    ],
    letra: {
      brokerLabel: "Balanz",
      comisionPct: 0.10,
      aplicaIva: true,
      iva: 0.21,
      derechosPct: 0.001
    }
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
