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
- **Descuento de cheques:** compara un banco contra la propuesta Zeta, con el costo efectivo (TNA y TEA) y el líquido. Al lado de la tasa pactada están las referencias de cheques de septiembre 2026 (cargadas a mano) y las series del BCRA. Abajo se compara, al plazo del cheque, contra caución, plazo fijo y LECAP/Boncap.

---

## Descuento de cheques

En `config.js`, bloque `ZETA_CONFIG.chequeDiscount`. La TNA pactada arranca en 27,5% para el banco y 25,73% para Zeta (avalado MAV de septiembre 2026). En la pantalla se puede pisar.

`referenciasCheques` son valores de septiembre 2026 (VetaCap vía Infobae, 21/10/2026): promedio 26,84%, avalado 25,73%, no garantizado 29,23%, garantía MAV 24,92%. MAV Data no tiene una API pública verificada, así que no los pisa el refresco. Quedan editables, con la fecha y la fuente a la vista.

`/api/rates` suma, para esta pantalla:

- BCRA Estadísticas v4.0, sin clave (`/monetarias?limit=3000`): documentos a sola firma 1216 (techo de referencia), adelantos 13, TAMAR 44, BADLAR 7, plazo fijo 1189 / 1192 / 1207 y el stock de descuento 1346. Si no responde, queda la foto del 28/10/2026 con la fecha de cada serie y un aviso.
- Caución BYMA ya integrada: para el plazo del cheque se toma la fila viva más cercana. Si BYMA no trae filas, se usan los baldes de `config.js`.
- LECAP/Boncap: precio de Data912 `GET /live/arg_notes` y, si esa especie no está en letras, `GET /live/arg_bonds`. El pago final es el de la consulta del 28/10/2026. Esos flujos salen de calculadoras de terceros y no están confirmados con la Secretaría de Finanzas. Sin precio, se muestra esa foto fechada.

Los costos compartidos están en `costos`. Puntos, salvo `iva` e `icdbAlicuota` (decimal). La fórmula está en `cheque-discount.js`.

El importe descontado es el valor actual: `VN / (1 + TNA × días / 365)`. Sobre ese importe, anual a 365 días, va el derecho MAV de venta (0,06% + IVA). La compra (0,03% + IVA) la paga el comprador y solo entra si se marca. El arancel de ALyC (0,40% + IVA, Rosval junio 2026) es anual sobre el VN. El impuesto a los créditos y débitos se calcula sobre el crédito. El ejemplo no computa nada contra Ganancias.

Verificado y usado en el ejemplo: derecho MAV de venta, arancel Rosval, IVA de ambos, y el cómputo de Ganancias (33% general, 100% micro y pequeñas, 60% industria mediana tramo 1). La alícuota de 0,6% del impuesto al cheque está a confirmar. También a confirmar, y en cero o apagados por defecto: IVA sobre el interés, comisión bancaria, aval SGR y sellos en Salta.

Caso de referencia, VN $1.000.000 al 25,73%, sin compra ni esos cargos a confirmar:

| Plazo | Líquido | TNA de costo | TNA sin impuesto |
| --- | --- | --- | --- |
| 60 días | $952.759 | 30,16% | 26,33% |
| 90 días | $933.346 | 28,96% | 26,36% |

La pantalla dice, para la propuesta Zeta, si descontar es más caro o más barato que esperar en caución, en plazo fijo y en la letra más cercana. También muestra el líquido colocado a esa TNA contra el nominal del cheque.

Hay un enlace a la API de cheques denunciados del BCRA. No se consulta desde acá.

El lead manda `instrument: "descuento_cheques"`, los CFT de siempre, el líquido y la TNA/TEA de costo de Zeta, y `conviene`. `rendimiento` sigue siendo la diferencia de líquido de Zeta contra el banco.

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

TNA = `(payoff / precio - 1) * 365 / días`. TEA y TIR (un solo pago) = `(payoff / precio) ^ (365 / días) - 1`. Los días de la TNA corren desde la liquidación 24 hs. Los días que usa el comparador corren de hoy al vencimiento. La letra de referencia de la tarjeta LECAP sigue siendo la más corta con al menos 30 días de liquidación. La comparación contra el plazo fijo elige otra si el plazo pedido calza mejor con otra especie. La curva vigente se muestra abajo. La barra dice la fuente y la hora. Si Data912 y BYMA fallan, queda el respaldo de `lecap-yields.js` / `config.js`, con fecha de vencimiento, y se descarta la que ya venció. El refresco sigue cada 30 minutos. Las tasas de cheques de septiembre no se modifican: se cargan a mano. El precio de las letras que usa el descuento sí sale de Data912, con el pago final de terceros señalado aparte de la curva LECAP de esta sección.

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
