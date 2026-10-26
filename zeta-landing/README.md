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
- La comisión, el IVA y los derechos salen de `brokerCosts` (Balanz, editable). La letra descuenta una sola compra, con IVA, y el derecho BYMA de letras. La membresía mensual no entra.

Hay dos modos, y la pantalla dice cuál está activo. **Por letra** (el que arranca): se elige una LECAP vigente y el plazo queda en los días de hoy a su vencimiento. Ese número es el que usan la TNA neta, los costos y el plazo fijo. El campo de días se muestra sincronizado y no se edita. **Por plazo**: si se escriben días a mano, vuelve la letra más cercana y el aviso cuando no calza. Las letras vencidas no entran. La misma elección vale para la LECAP suelta y para la fila de la letra cuando se la compara con la caución: la letra se cotiza hasta su vencimiento, no con los días de la caución. El descuento de cheques sigue con el plazo del cheque. La TNA bruta es la de esa letra. La neta descuenta la comisión de Balanz, el IVA y los derechos BYMA. En la reunión se pueden pisar la TNA de Macro, la TNA bruta, la comisión, el IVA y los derechos. No se guardan. El FCI de liquidez entra cuando la letra calza.

El plazo arranca en los días de hoy al vencimiento de la letra de referencia (la más corta que llega a 30 días de liquidación). Bajo 30 días el plazo fijo figura N/A. Una letra ya vencida no entra, tampoco si el respaldo de `config.js` todavía le deja un `dias` viejo.

Fórmulas en `macro-vs-letra.js`. El lead manda `instrument: "macro_vs_letra"`.

---

## Caución por plazo

`/api/rates` toma primero BYMA (`POST https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/cauciones`, body `{}`, filas `denominationCcy === "ARS"`). La TNA es `trade`, si no `vwap`, si no el promedio de bid y offer (vienen en decimal: 0,212 = 21,2%). Esos días se meten en los baldes 3 / 7 / 10 / 15 / 30 si caen a lo sumo a 3 días del balde.

ArgentinaDatos `/cauciones/ars` queda de respaldo: muchas veces responde `[]` (snapshot de IOL vacío), incluso con el mercado abierto. Si las dos fuentes fallan, siguen los valores de `marketRates.caucionByDays` en `config.js`. El instrumento Caución usa la TNA del plazo elegido. En los atajos de días se ve la TNA de cada balde.

## LECAP en vivo

`/api/rates` pide el precio a Data912 (`GET https://data912.com/live/arg_notes`, cache de unos 30 segundos, sin clave). Si una letra no viene ahí, usa BYMA (`POST .../free/lebacs`, liquidación 24 hs). Las dos se consultan desde la función: el browser no depende de CORS.

El payoff no es 100. Cada letra capitaliza su TEM con base 30/360 (`100 * (1 + TEM) ^ (días / 30)`). La TEM sale de la ficha BYMA. Si la ficha no trae el número, se usa la de licitación ya contrastada con el flujo publicado (S13N6 2,10% paga 109,65; S29E7 2,25% paga 111,68; S30O6 2,55% paga 135,28; S30N6 2,30% paga 129,89). Sin TEM conocida esa especie no entra.

TNA = `(payoff / precio - 1) * 365 / días`. TEA y TIR (un solo pago) = `(payoff / precio) ^ (365 / días) - 1`. Los días de la TNA corren desde la liquidación 24 hs. Los días que usa el comparador corren de hoy al vencimiento. La letra de referencia de la tarjeta LECAP sigue siendo la más corta con al menos 30 días de liquidación. La comparación contra el plazo fijo elige otra si el plazo pedido calza mejor con otra especie. La curva vigente se muestra abajo. La barra dice la fuente y la hora. Si Data912 y BYMA fallan, queda el respaldo de `lecap-yields.js` / `config.js`, con fecha de vencimiento, y se descarta la que ya venció. El refresco sigue cada 30 minutos. Las tasas de cheques no se modifican.

## Comisiones, impuesto al cheque y FCI

`brokerCosts` en `config.js` tiene la comisión de Balanz (letras 0,10% con IVA, una sola compra; caución colocadora en pesos 0,50% prorrateada cada 90 días, con IVA) y los derechos BYMA de agosto 2026 (letras contado PPT 0,001%, sin IVA; caución 0,045% proporcional hasta 90 días, sobre el mayor valor, más IVA). La pantalla muestra TNA bruta, TNA neta y el interés en pesos. El descuento de cheques ya trae derechos y arancel: no se le suma esta tabla.

El impuesto de la Ley 25.413 usa 0,6% de débito y 0,6% de crédito (Decreto 380/2001, art. 7). Arranca apagado porque la transferencia entre cuentas del mismo titular está exenta (Decreto 301/2021). El plazo fijo del mismo banco no lo paga. "La plata queda en el broker al vencimiento" saca el crédito de la vuelta. El pago a cuenta de Ganancias depende de la categoría de la MiPyME y no se resta.

El FCI es Balanz Capital Money Market, clase A, pesos, rescate T+0. `/api/rates` lee el histórico de cuotapartes en ArgentinaDatos (fuente CNV) y calcula la TNA de 7 días corridos. El respaldo es 18,28% al 22/10/2026. La ficha CAFCI no cobra suscripción ni rescate; los honorarios (2,45% anual en esa clase) ya están en la cuotaparte.

---

## Acceso de estudios

La pantalla de entrada no muestra PIN de ejemplo. El navegador tampoco trae la lista: manda el código a `GET /api/pin` y el servidor lo contrasta con el Google Sheet (`action=getStudios`). La respuesta es solo la ficha del estudio que coincide. Los prospectos salen por `POST /api/lead`.

En Vercel (o en el entorno), variables:

- `GOOGLE_SHEET_WEBHOOK_URL`: URL del Apps Script, solo en el servidor.
- `STUDIO_SHEET_TOKEN`: secreto que el servidor agrega al pedido. Hoy el script no lo exige.

Si `GOOGLE_SHEET_WEBHOOK_URL` no está definida, el servidor usa la URL de Apps Script que ya estaba en el proyecto (`studio-access.js`). Alcanza para que el acceso y los leads sigan andando, pero no es un secreto: quien tenga esa URL puede pedir `getStudios` y ver la lista. Falta, y no se puede cerrar desde este repo:

1. Cargar `GOOGLE_SHEET_WEBHOOK_URL` en Vercel y borrar el respaldo de `studio-access.js`.
2. Hacer que el Apps Script rechace `getStudios` si no llega `STUDIO_SHEET_TOKEN` (el mismo valor, solo en el servidor).
3. Mejor todavía: una acción `checkPin` que no devuelva el mapa completo. `/api/pin` ya está listo para mandar el token; el script todavía responde el mapa.

## 🛠️ Cómo Probar Localmente

Serví la carpeta `zeta-landing` con las funciones de `api/` (en Vercel eso es automático). Abrir el HTML suelto no valida el PIN, porque `/api/pin` no existe en `file://`.

---

## 🌐 Publicación en Vercel

URL canónica: **https://zeta-contadores-zeta-landing.vercel.app/**

El proyecto de Vercel tiene como Root Directory la carpeta `zeta-landing`. Ahí responden la home y `/api/rates`.

`zetatesoreria.vercel.app` da 404: no usarla. Si más adelante se quiere un dominio corto, se puede apuntar un alias en Vercel hacia este mismo proyecto.

1. Sube esta carpeta (`zeta-landing`) a GitHub o arrástrala a Vercel.
2. Vercel reconocerá automáticamente la carpeta `/api` y activará la función serverless de tasas en `/api/rates`.
