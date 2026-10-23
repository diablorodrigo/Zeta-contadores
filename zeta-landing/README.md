# Simulador de Tesorería PyME - Zeta Finance (Marca Blanca Multiactivo)

Plataforma corporativa de colocación de liquidez transitoria con control de acceso por **PIN de 4 dígitos**, **marca blanca dinámica** y **sincronización automática de tasas cada 30 minutos**.

---

## 🚀 Nuevas Funcionalidades: Tasas Automáticas cada 30 Minutos

1. **Función Serverless en Vercel ([`api/rates.js`](file:///C:/Users/crist/.gemini/antigravity/scratch/zeta-landing/api/rates.js)):**
   - Extrae en vivo:
     - **Cauciones en Pesos:** Tasas BYMA escalonadas (3d, 7d, 10d, 15d, 30d).
     - **Plazo Fijo:** Tasa promedio oficial informada al BCRA.
     - **LECAP Corta:** Extrae la **TIR** de la letra con vencimiento más cercano y mayor volumen negociado en el mercado secundario.
     - **Colocación USD:** Tasa corporativa fija al 5.0% anual.
   - **Cache de 30 minutos:** Cabezal `Cache-Control: s-maxage=1800` para que Vercel sirva las tasas desde la red Edge sin sobrecargar las fuentes de datos.

2. **Sincronización en el Frontend ([`simulator.js`](file:///C:/Users/crist/.gemini/antigravity/scratch/zeta-landing/simulator.js)):**
   - **Auto-refresco:** Un temporizador actualiza las tasas automáticamente cada 30 minutos sin necesidad de recargar la página.
   - **Caché Local (`localStorage`):** Guarda la última consulta para evitar peticiones repetidas al navegar.
   - **Indicador Visual en Vivo:**
     - `🟢 Tasas en vivo sincronizadas • Actualizado: HH:MM hs`
     - `🟡 Tasas de referencia (mercado cerrado)` (con fallback seguro en [`config.js`](file:///C:/Users/crist/.gemini/antigravity/scratch/zeta-landing/config.js)).
   - **Botón manual `↻ Actualizar`:** Para que el asesor fuerce la sincronización en cualquier momento si está en una reunión con un cliente.

---

## 📈 Alternativas de Inversión Configuradas (Régimen Actual de Mercado)

- **Caución Bursátil:** Escalonada en ~20.5% a ~23.5% TNA (3d: 20.5%, 7d: 21.5%, 10d: 22.0%, 15d: 22.5%, 30d: 23.5%). Respaldo BYMA y liquidación T+0.
- **LECAP Corta:** Tasa de mayor rendimiento en pesos en torno al **~26.5% TNA** (TIR de mercado secundario).
- **Plazo Fijo Tradicional:** **~19.5% TNA** (promedio grandes bancos BNA / Galicia / Santander, inmovilizado a 30 días).
- **Dólares (USD):** Toggle de moneda en el encabezado con colocación fija al 5.0% anual.

---

## 🛠️ Cómo Probar Localmente

Abre el archivo [**`index.html`**](file:///C:/Users/crist/.gemini/antigravity/scratch/zeta-landing/index.html) en tu navegador.

### PINs de acceso para pruebas:
- `4829` &rarr; **Estudio Pérez & Asociados** (Salta)
- `1042` &rarr; **Gómez & Consultores** (Córdoba)
- `9999` &rarr; **Zeta Finance Demo**

---

## 🌐 Publicación en Vercel

1. Sube esta carpeta (`zeta-landing`) a GitHub o arrástrala a Vercel.
2. Vercel reconocerá automáticamente la carpeta `/api` y activará la función serverless de tasas en `/api/rates`.
