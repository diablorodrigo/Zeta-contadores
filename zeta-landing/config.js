/**
 * CONFIGURACIÓN CENTRAL DE ESTUDIOS, TASAS DE MERCADO Y CONTROL DE ACCESO
 */
const ZETA_CONFIG = {
  platformName: "Zeta Finance",
  // Marca visible de la herramienta. Nombre y logo en un solo lugar (colores en theme.css).
  brand: {
    name: "ZCONTADORES",
    tagline: "Tesorería para estudios contables",
    logoText: "Z",
    accent: "#5B21B6", // violeta profundo del logo B2; la escala completa está en theme.css (--zc-50 … --zc-950)
    logo: {
      light: "assets/brand/zc-icono-claro.svg", // ícono para modo claro
      dark: "assets/brand/zc-icono-oscuro.svg"  // ícono para modo oscuro
    },
    favicon: "assets/brand/favicon.svg"
  },
  adminWhatsapp: "5493496462977", // Teléfono de Zeta Finance (formato internacional sin +)
  // El Sheet de estudios y de leads lo llama el servidor (/api/pin y /api/lead).
  // No va la URL ni la lista de PIN en el navegador. Ver README, "Acceso".
  googleSheetWebhookUrl: "",

  // Sincronización automática de tasas de mercado
  ratesConfig: {
    refreshIntervalMinutes: 30, // Se actualiza automáticamente cada 30 minutos
    apiEndpoint: "/api/rates",   // Endpoint serverless de Vercel
    directCaucionesUrl: "https://api.argentinadatos.com/v1/finanzas/cauciones/ars",
    bymaCaucionesUrl: "https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/cauciones",
    directLecapUrl: "https://data912.com/live/arg_notes",
    directLecapBondsUrl: "https://data912.com/live/arg_bonds",
    bymaLecapUrl: "https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/lebacs",
    bymaFichaUrl: "https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/bnown/fichatecnica/especies/general",
    directPlazoFijoUrl: "https://api.argentinadatos.com/v1/finanzas/tasas/depositos30Dias",
    directMacroPlazoFijoUrl: "https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo",
    directFciHistoricoUrl: "https://api.argentinadatos.com/v1/finanzas/fci/fondos/balanz-capital-money-market-clase-a/historico",
    directBcraMonetariasUrl: "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?limit=3000"
  },

  // TASAS DE RESPALDO. La caución en vivo sale de BYMA (ver api/rates.js).
  // Si BYMA no responde, estos cinco plazos siguen siendo editables a mano
  // y el instrumento Caución usa el del horizonte elegido (3/7/10/15/30).
  // ArgentinaDatos /cauciones/ars suele devolver [] (snapshot IOL vacío): no
  // es la fuente primaria.
  marketRates: {
    // Referencia: último cierre 30/10/2026 (ArgentinaDatos, snapshot IOL). Sin
    // plazos exactos 7/10/15/30: 3d 21,0; 5-6d 20,5; 12d 20,1; 14d 19,2;
    // 28d 20,7; 31d 22,8; 60d 20,0. Los baldes toman el plazo más cercano,
    // como el código en vivo (30 -> 31d, 22,8%).
    caucionByDays: {
      3: 21.0,
      7: 20.5,
      10: 20.1,
      15: 19.2,
      30: 22.8
    },
    caucionDetails: { fuente: "referencia", fecha: "2026-10-30" },
    defaultCaucionTNA: 21.5,
    plazoFijoTNA: 19.5, // Referencia: Banco Macro vigente 30-59 días, 19,5% (< $5M) / 20% (>= $5M)
    // Respaldo ("referencia") si Data912 y BYMA no traen precio. Cierre del
    // 30/10/2026, Data912, precio ask, liquidación 02/11. Referencia S30N6
    // (28 días): TNA 23,08%, TEA 25,71%, TEM de mercado 1,90% (la de emisión
    // es 2,30%). Paga 129,89 cada 100 nominales el 30/11/2026.
    lecapTNA: 23.08,
    lecapDetails: {
      ticker: "S30N6",
      maturity: "2026-11-30",
      vencimiento: "30/11/2026",
      nombre: "LECAP Vto. 30/11/2026",
      diasAlVencimiento: 28,
      settlement: "2026-11-02",
      precio: 127.63,
      precioFuente: "ask",
      payoffPor100: 129.89,
      temPct: 2.30,
      temMercado: 1.90,
      tna: 23.08,
      tea: 25.71,
      tir: 25.71,
      fuente: "config"
    },
    lecaps: [
      { ticker: "S13N6", tna: 22.64, tea: 25.31, tir: 25.31, temMercado: 1.87, dias: 11, settlement: "2026-11-02", maturity: "2026-11-13", vencimiento: "13/11/2026", precio: 108.907, precioFuente: "ask", payoffPor100: 109.65, fuente: "config" },
      { ticker: "S30N6", tna: 23.08, tea: 25.71, tir: 25.71, temMercado: 1.90, dias: 28, settlement: "2026-11-02", maturity: "2026-11-30", vencimiento: "30/11/2026", precio: 127.63, precioFuente: "ask", payoffPor100: 129.89, fuente: "config" },
      { ticker: "S29E7", tna: 24.80, tea: 27.23, tir: 27.23, temMercado: 2.00, dias: 88, settlement: "2026-11-02", maturity: "2027-01-29", vencimiento: "29/01/2027", precio: 105.38, precioFuente: "ask", payoffPor100: 111.68, fuente: "config" }
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
  // Caución colocadora en pesos: arancel del broker como TNA (anual, por
  // días/365), más IVA. Se elige con caucion.broker; cada broker tiene su valor
  // en caucion.porBroker.
  // Derecho BYMA de caución 0,0450% proporcional hasta 90 días, más IVA.
  // La boleta IOL lo aplica sobre el capital contado (derechosBase "contado").
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
      broker: "IOL",
      porBroker: {
        // Boleta IOL: 1 día, $6.023.776 -> arancel $297,06 (0,0049% = 1,80%/365).
        IOL: { arancelTnaPct: 1.80, nota: "Confirmado con boleta IOL, 1,80% TNA + IVA" },
        // Tarifario web: "hasta 0.50% con detalle de prorrata (cada 90 días)".
        Balanz: { arancelTnaPct: 0.50, nota: "Pendiente de confirmar con boleta" }
      },
      reinversion: true,
      derechosBase: "contado",
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

  // Descuento de cheques. La TNA pactada se edita en la simulación.
  // Los costos verificados están en `costos` (puntos, salvo iva e icdbAlicuota).
  // La fórmula está en cheque-discount.js. No se suma la comisión de letras,
  // la de caución ni la del FCI.
  //
  // referenciasCheques es septiembre 2026 (VetaCap / Infobae). MAV Data no
  // tiene API pública verificada: no las pisa el refresco.
  // BCRA, caución y letras sí se refrescan. Si una fuente falla, queda la
  // última foto fechada (cheque-market.js).
  chequeDiscount: {
    bankLabel: "Banco Macro",
    // Tramos verificados en el PDF oficial de Macro (Banca Internet/App), "Fecha Vigencia: 28/10/2026":
    // https://www.macro.com.ar/1517360615001/tasas_plazo_fijo.pdf  ·  30-35 días: 19,5% hasta $4.999.999,99; 20% desde $5 M.
    verificadoAl: "2026-10-28",
    bank: {
      tnaDesc: 27.5
    },
    zeta: {
      tnaDesc: 25.73
    },
    costos: {
      iva: 0.21,
      mavVentaPct: 0.06,
      mavCompraPct: 0.03,
      aplicarCompra: false,
      alycPct: 0.40,
      icdbAlicuota: 0.006,
      computoGanancias: 0,
      cobroFciMoneyMarket: false,
      ivaIntereses: false,
      ivaInteresesAlicuota: 0.21,
      comisionBancoPct: 0,
      comisionBancoIva: false,
      avalSgrPct: 0,
      avalSgrIva: false,
      sellosPct: 0
    },
    referenciasCheques: {
      periodo: "septiembre 2026",
      fuente: "VetaCap vía Infobae, 21/10/2026",
      nota: "MAV Data es una web. No hay API pública verificada: estos valores se cargan a mano.",
      promedio: 26.84,
      avalado: 25.73,
      noGarantizado: 29.23,
      garantiaMav: 24.92
    }
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
    // Tramos verificados en el PDF oficial de Macro (Banca Internet/App), "Fecha Vigencia: 28/10/2026":
    // https://www.macro.com.ar/1517360615001/tasas_plazo_fijo.pdf  ·  30-35 días: 19,5% hasta $4.999.999,99; 20% desde $5 M.
    verificadoAl: "2026-10-28",
    minDias: 30,
    // La letra calza si el vencimiento queda a lo sumo a estos días del plazo.
    maxGapDays: 15,
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

  // Los estudios habilitados salen del Google Sheet, vía /api/pin.
  // El navegador no guarda PIN ni la ficha de otros estudios.
  studios: {}
};
