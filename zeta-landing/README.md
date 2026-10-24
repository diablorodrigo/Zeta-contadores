# Simulador de Tesorería PyME - Zeta Finance (Marca Blanca Multiactivo)

Plataforma corporativa de colocación de liquidez transitoria con control de acceso por **PIN de 4 dígitos**, **marca blanca dinámica** y **sincronización automática de tasas cada 30 minutos**.

---

## 🚀 Nuevas Funcionalidades: Tasas Automáticas cada 30 Minutos

1. **Función Serverless en Vercel ([`api/rates.js`](file:///C:/Users/crist/.gemini/antigravity/scratch/zeta-landing/api/rates.js)):**
   - Extrae en vivo:
     - **Cauciones en Pesos:** Tasas BYMA escalonadas (3d, 7d, 10d, 15d, 30d).
     - **Plazo Fijo:** Tasa promedio oficial informada al BCRA.
     - **LECAP Corta:** Precio de Data912 (`/live/arg_notes`) y, si falta esa especie, BYMA (`/free/lebacs`). Calcula TNA, TEA y TIR con el payoff capitalizado. La de referencia es la más corta que llega a 30 días.
     - **Colocación USD:** Tasa corporativa fija al 5.0% anual.
   - **Cache de 30 minutos:** Cabezal `Cache-Control: s-maxage=1800` para que Vercel sirva las tasas desde la red Edge sin sobrecargar las fuentes de datos.

2. **Sincronización en el Frontend ([`simulator.js`](file:///C:/Users/crist/.gemini/antigravity/scratch/zeta-landing/simulator.js)):**
   - **Auto-refresco:** Un temporizador actualiza las tasas automáticamente cada 30 minutos sin necesidad de recargar la página.
   - **Caché Local (`localStorage`):** Guarda la última consulta para evitar peticiones repetidas al navegar.
   - **Indicador Visual en Vivo:**
     - `🟢 LECAP en vivo` o `🟢 LECAP último cierre`, con la fuente (Data912 o BYMA) y la hora de Argentina.
     - `🟡 LECAP de referencia` cuando queda el respaldo de [`config.js`](file:///C:/Users/crist/.gemini/antigravity/scratch/zeta-landing/config.js).
   - **Botón manual `↻ Actualizar`:** Para que el asesor fuerce la sincronización en cualquier momento si está en una reunión con un cliente.

---

## 📈 Alternativas de Inversión Configuradas (Régimen Actual de Mercado)

- **Caución Bursátil:** Escalonada en ~20.5% a ~23.5% TNA (3d: 20.5%, 7d: 21.5%, 10d: 22.0%, 15d: 22.5%, 30d: 23.5%). Respaldo BYMA y liquidación T+0.
- **LECAP Corta:** La más corta que llega a 30 días, para poder compararla con un plazo fijo. El respaldo escrito es **S30N6 al 22,96% TNA** (cierre 23/10/2026; TIR 25,50%; paga 129,89 cada 100 nominales). En vivo la pisa `/api/rates`.
- **Plazo Fijo Tradicional:** **~19.5% TNA** (promedio grandes bancos BNA / Galicia / Santander, inmovilizado a 30 días).
- **Dólares (USD):** Toggle de moneda en el encabezado con colocación fija al 5.0% anual.
- **Descuento de cheques:** compara un banco contra la propuesta Zeta. Las tasas no salen del refresco de mercado; se editan en `config.js` (ver abajo).

---

## Descuento de cheques — editar tasas

En `config.js`, bloque `ZETA_CONFIG.chequeDiscount`. Son **tasas de ejemplo** hasta conectar una fuente en vivo. El refresco de caución, LECAP y plazo fijo no las modifica.

Porcentajes de tasa en puntos (`27.5` = 27,5%). `iva` en decimal (`0.21` = 21%).

Defaults de esta versión:

| Campo | Banco | Propuesta Zeta |
| --- | --- | --- |
| Nombre | Banco Macro (`bankLabel`, editable también en la simulación) | Propuesta Zeta |
| `tnaDesc` | 27,5% | 25,5% |
| `derechosPct` | 0,06% | 0,05% |
| `tnaArancel` | 1,00% | 0,70% |
| `iva` | 0,21 | 0,21 |

En la pantalla el contador carga monto y plazo, y puede pisar el nombre del banco y la TNA de descuento solo para esa simulación. Derechos, arancel e IVA siguen los de `config.js`.

Las fórmulas están comentadas en `cheque-discount.js`. Si eligen cheques, el lead al Sheet manda `instrument: "descuento_cheques"`, `monto`, `plazo`, `cftEfectivoBanco`, `cftEfectivoZeta`, `cftNominalBanco`, `cftNominalZeta` y `conviene` (más `resumen` en una línea). `rendimiento` en ese caso es la diferencia de plata neta de Zeta contra el banco, en pesos (puede ser negativa).

---

## Plazo fijo Macro vs letra corta

Instrumento **Plazo fijo Macro vs letra corta**. Misma idea que el descuento de cheques: dos columnas, capital y días, badge de quién conviene y la plata de cada lado. No reemplaza la LECAP suelta ni la caución.

En `config.js`, bloque `macroVsLetra`:

- `bankLabel`: "Banco Macro". Se puede cambiar solo para la reunión.
- `bands`: tramos de ejemplo (monto × días → TNA). El de 30 días hasta $5 M está en 19,5%. Si `/api/rates` trae `macroPlazoFijoBands` desde ArgentinaDatos, pisan estos presets hasta que el contador edite la TNA.
- `letra.comisionPct`: 0,10 (tope publicado de Balanz para letras en pesos, cargo único sobre el monto, no una TNA).
- `letra.aplicaIva`: `false`. El IVA 21% se puede prender en la reunión.
- `letra.derechosPct`: 0. La membresía mensual no entra en la cuenta.

La TNA bruta de la letra es `marketRates.lecapTNA` (y el ticker / días de `lecapDetails`). Es la TNA simple a 365 días, no la TIR. En la reunión se pueden pisar la TNA de Macro, la TNA bruta, la comisión, el IVA y los derechos. No se guardan.

El plazo arranca en los días al vencimiento de la letra. Bajo 30 días el plazo fijo figura N/A.

Fórmulas en `macro-vs-letra.js`. El lead manda `instrument: "macro_vs_letra"`.

---

## Caución por plazo

`/api/rates` toma primero BYMA (`POST https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/cauciones`, body `{}`, filas `denominationCcy === "ARS"`). La TNA es `trade`, si no `vwap`, si no el promedio de bid y offer (vienen en decimal: 0,212 = 21,2%). Esos días se meten en los baldes 3 / 7 / 10 / 15 / 30 si caen a lo sumo a 3 días del balde.

ArgentinaDatos `/cauciones/ars` queda de respaldo: muchas veces responde `[]` (snapshot de IOL vacío), incluso con el mercado abierto. Si las dos fuentes fallan, siguen los valores de `marketRates.caucionByDays` en `config.js`. El instrumento Caución usa la TNA del plazo elegido. En los atajos de días se ve la TNA de cada balde.

## LECAP en vivo

`/api/rates` pide el precio a Data912 (`GET https://data912.com/live/arg_notes`, cache de unos 30 segundos, sin clave). Si una letra no viene ahí, usa BYMA (`POST .../free/lebacs`, liquidación 24 hs). Las dos se consultan desde la función: el browser no depende de CORS.

El payoff no es 100. Cada letra capitaliza su TEM con base 30/360 (`100 * (1 + TEM) ^ (días / 30)`). La TEM sale de la ficha BYMA. Si la ficha no trae el número, se usa la de licitación ya contrastada con el flujo publicado (S13N6 2,10% paga 109,65; S29E7 2,25% paga 111,68; S30O6 2,55% paga 135,28; S30N6 2,30% paga 129,89). Sin TEM conocida esa especie no entra.

TNA = `(payoff / precio - 1) * 365 / días`. TEA y TIR (un solo pago) = `(payoff / precio) ^ (365 / días) - 1`. Los días corren desde la liquidación 24 hs. La letra que entra en la comparación es la más corta con al menos 30 días; el resto de la curva se muestra abajo. La barra dice la fuente y la hora. Si Data912 y BYMA fallan, queda `marketRates.lecapTNA` en `config.js`. El refresco sigue cada 30 minutos. Las tasas de cheques no se modifican.

---

## 🛠️ Cómo Probar Localmente

Abre el archivo [**`index.html`**](file:///C:/Users/crist/.gemini/antigravity/scratch/zeta-landing/index.html) en tu navegador.

### PINs de acceso para pruebas:
- `4829` &rarr; **Estudio Pérez & Asociados** (Salta)
- `1042` &rarr; **Gómez & Consultores** (Córdoba)
- `9999` &rarr; **Zeta Finance Demo**

---

## 🌐 Publicación en Vercel

URL canónica: **https://zeta-contadores-zeta-landing.vercel.app/**

El proyecto de Vercel tiene como Root Directory la carpeta `zeta-landing`. Ahí responden la home y `/api/rates`.

`zetatesoreria.vercel.app` da 404: no usarla. Si más adelante se quiere un dominio corto, se puede apuntar un alias en Vercel hacia este mismo proyecto.

1. Sube esta carpeta (`zeta-landing`) a GitHub o arrástrala a Vercel.
2. Vercel reconocerá automáticamente la carpeta `/api` y activará la función serverless de tasas en `/api/rates`.
