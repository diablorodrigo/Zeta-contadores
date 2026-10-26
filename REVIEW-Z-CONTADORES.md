# Revisión Z Contadores — estado y cierre a producción

Fecha: 23 de octubre de 2026.  
Repo: [diablorodrigo/Zeta-contadores](https://github.com/diablorodrigo/Zeta-contadores).  
App: carpeta `zeta-landing/`.  
URL en vivo: [zeta-contadores-zeta-landing.vercel.app](https://zeta-contadores-zeta-landing.vercel.app/).  
URL vieja, no usar: [zetatesoreria.vercel.app](https://zetatesoreria.vercel.app) da 404. El Website del repo en GitHub ya apunta a la URL canónica.

Este documento es un diagnóstico de producto y de código. No cambia la lógica del simulador. No se publicó nada en Vercel y no se escribió ningún lead en el Google Sheet.

## Veredicto

La terminal ya está armada de punta a punta en el código, y **el deploy bueno ya responde**. En [zeta-contadores-zeta-landing.vercel.app](https://zeta-contadores-zeta-landing.vercel.app/) abre el simulador (HTTP 200) y `/api/rates` devuelve JSON. El Root Directory de ese proyecto es `zeta-landing`.

Lo que todavía no cierra para un estudio real:

- El Website del repo ya es la URL canónica. `zetatesoreria.vercel.app` sigue en **404**: es otro proyecto de Vercel, con la raíz del repo como Root Directory. La página quedó colgada en `/zeta-landing/` y `/api/rates` ahí no existe. No usarla. Un dominio corto, si hace falta, se resuelve con un alias de Vercel sobre el proyecto bueno.
- En la URL buena, `/api/rates` marcó una sola fuente viva: plazo fijo **22,4%**. Caución y LECAP salieron del fallback (caución 20,5–23,5%; LECAP **S30N6 al 26,5%**). El front, con un 200, pinta igual el cartel verde de “tasas en vivo” para las tres.
- El número de aviso es `5493496462977`. El canal de la solicitud es el Sheet: «Enviar solicitud» guarda el lead y muestra «Listo, te contactamos por WhatsApp». No abre `wa.me` solo. El Apps Script, en el GET de solo lectura de esta revisión, contestó que no tiene `doGet`. El POST ahora sale como `text/plain` con el mismo JSON.

## 1. Qué hay en el repo

Dos commits, ambos del 23/10/2026, mensaje `Add files via upload`. No hay `package.json`, tests, CI ni `README` en la raíz. Todo vive en `zeta-landing/`:

| Archivo | Rol |
| --- | --- |
| `index.html` | Tres pantallas en un solo HTML: PIN, simulador, modal del prospecto. Tailwind por CDN y iconos Lucide desde `unpkg` sin versión fija. |
| `simulator.js` | PIN, marca blanca, cálculo, refresco de tasas, WhatsApp y POST al Sheet. |
| `config.js` | Estudios, PIN, tasas de respaldo, WhatsApp, URL del Apps Script, intervalo de 30 minutos. |
| `api/rates.js` | Función serverless pensada para `/api/rates`. Caución y plazo fijo vía ArgentinaDatos; LECAP por scrape de Rava; USD fijo al 5%. |
| `vercel.json` | Config vieja (`version: 2` y `routes` que reescriben cada path a sí mismo). Solo aplica si el Root Directory de Vercel es `zeta-landing`. |
| `README.md` | Describe el producto y los PIN de prueba. Los links internos apuntan a una carpeta local de Windows (`C:/Users/crist/.gemini/...`). |

El README dice “tasas cada 30 minutos”. En `config.js` el intervalo es `refreshIntervalMinutes: 30` y la función pide cache de 1800 segundos. Eso es el doble de seguido que “cada hora”, pero las fuentes que el código consulta no se mueven cada hora (detalle en la sección de tasas).

## 2. Flujo real (el que ejecuta el código)

```text
URL
  → pantalla de PIN (4 dígitos)
  → si el PIN está en config.js, o el Sheet responde estudios, se abre el simulador
  → también abre directo con ?pin= o ?estudio= en la URL
  → el contador carga capital, plazo (1 a 35 días) e instrumento
  → rendimiento = capital × (TNA / 100) × (días / 365), redondeado
  → "Solicitar Asesoramiento / Apertura"
  → modal: empresa, contacto, teléfono, notas
       → botón principal: "Enviar solicitud" (Sheet + toast «Listo, te contactamos por WhatsApp»)
       → link chico, opcional: "Si preferís, escribir por WhatsApp" (wa.me del número de config, sin guardar solo)
```

Instrumentos en pesos: caución bursátil (tasa según el plazo), LECAP corta, plazo fijo. En dólares: una tasa comercial fija del 5% anual. No hay FCI en la pantalla, aunque el circuito de negocio que describiste incluye caución, letra corta y FCI.

No hay un paso separado de “el cliente acepta”. Quien tiene el PIN hace la simulación y carga los datos en la misma pantalla. El contador puede además pisar la TNA a mano.

Marca blanca: cada PIN trae nombre, ciudad, colores y un flag `hideZetaBranding`. Los tres estudios del archivo lo tienen en `false`, así que Zeta queda visible como “Operado por Zeta Finance”. En el celular esa pastilla del header está oculta (`hidden sm:flex`).

## 3. Qué se probó (sin secretos y sin writes)

### Deploy — hay dos proyectos

El nombre `zeta-contadores-zeta-landing` es el proyecto cuyo Root Directory ya es la carpeta de la app. Ese es el que hay que compartir.

| URL | Resultado el 23/10/2026 |
| --- | --- |
| `https://zeta-contadores-zeta-landing.vercel.app/` | **200**. Sirve `index.html` (32.124 bytes, el mismo archivo del repo). |
| `.../api/rates` en esa URL | **200, JSON**. La función corre. Detalle abajo. |
| `.../config.js` y `.../simulator.js` | 200, JavaScript público (ahí están los PIN). |
| `.../api/rates.js` | 404. El fuente de la función no se publica, que es lo correcto. |
| `.../index.html` | 308 a `/` (`cleanUrls` del `vercel.json`: ese archivo sí está aplicado). |
| `https://zetatesoreria.vercel.app/` | **404**, `x-vercel-error: NOT_FOUND`. |
| `https://zetatesoreria.vercel.app/api/rates` | 404. |
| `https://zetatesoreria.vercel.app/zeta-landing/` | 200, el HTML estático. |
| `https://zetatesoreria.vercel.app/zeta-landing/api/rates.js` | 200 como `application/javascript`. En ese proyecto el archivo no se ejecuta. |

`zetatesoreria.vercel.app` es otro proyecto, con Root Directory en la raíz del repo. En la raíz no hay `index.html` ni `api/`, por eso la home da 404 y la función nunca se construye. El front de `/zeta-landing/` llama a `/api/rates` (path absoluto), recibe 404, y no cae al camino directo de ArgentinaDatos (ese camino solo corre si el `fetch` revienta). Ahí el cartel queda ámbar, “mercado cerrado”, con los números de `config.js`.

El campo **Website** del repo en GitHub (`homepage`) quedó en `https://zeta-contadores-zeta-landing.vercel.app/` (confirmado por la API del repo el 23/10/2026, después de que Cristian lo actualizó). `zetatesoreria.vercel.app` da 404: no usarla. Si más adelante se quiere un dominio corto, se puede apuntar un alias en Vercel hacia el proyecto canónico.

### Tasas — vivo contra fallback

Consulté las mismas fuentes que nombra el código, el 23/10/2026.

**Qué devolvió `/api/rates` en la URL buena**, a las 17:27 UTC del 23/10/2026:

```json
{
  "success": true,
  "sourcesChecked": ["plazofijo_live"],
  "rates": {
    "caucionByDays": { "3": 20.5, "7": 21.5, "10": 22, "15": 22.5, "30": 23.5 },
    "plazoFijoTNA": 22.4,
    "lecapTNA": 26.5,
    "lecapDetails": {
      "ticker": "S30N6",
      "vencimiento": "30/11/2026",
      "nombre": "LECAP Vto. Noviembre 2026"
    },
    "usdRateAnnual": 5
  }
}
```

Un segundo GET, 19 segundos después, volvió `x-vercel-cache: HIT` con el mismo timestamp: el edge está guardando la respuesta. Al browser le llega `cache-control: public, max-age=0`. No medí si el TTL llega a los 30 minutos que pide el código.

Como el HTTP es 200 y viene `rates`, el simulador de la URL buena pinta verde “Tasas en vivo sincronizadas” para el paquete entero. La única fuente que la función declaró es el plazo fijo.

**Cauciones.** `https://api.argentinadatos.com/v1/finanzas/cauciones/ars` y `.../cauciones/usd` respondieron 200 con `[]`. En la función en vivo la caución quedó en la escala escrita a mano (3d 20,5% · 7d 21,5% · 10d 22,0% · 15d 22,5% · 30d 23,5%) y no entró en `sourcesChecked`. No contrasté esa escala contra BYMA por otro canal.

Hay un bug dormido en `api/rates.js`: antes de leer la respuesta, el mapa de plazos arranca en 35 / 36,5 / 37 / 37,5 / 38. Si el array vuelve a traer datos y algún plazo no entra en los cortes, ese número inventado pisa el fallback y puede mostrarse como tasa en vivo. El camino directo del browser (`fetchDirectArgentinaDatos`) no tiene esa semilla.

**Plazo fijo.** `depositos30Dias` trae serie diaria. Último punto: **20/10/2026, valor 22,41**. La función en vivo ya lo está usando: devolvió **22,4** (un decimal). El fallback escrito en el archivo, que se vería si la serie falla, sigue en **19,5**. El comentario del README habla de un promedio BNA / Galicia / Santander; la función usa el último `valor` de esa serie, con el filtro “entre 15 y 90”.

**LECAP.** El scrape de `clasico.rava.com` no respondió en 20 segundos desde este entorno, y la función en vivo tampoco lo marcó en `sourcesChecked`: se quedó con **S30N6 al 26,5%** y vencimiento 30/11/2026.

ArgentinaDatos sí publica letras en JSON, actualizadas el **23/10/2026 00:51 UTC** (`/v1/finanzas/letras`). El código no usa ese endpoint. Lectura de hoy:

| Ticker | Vencimiento | Días | TNA | Lectura |
| --- | --- | --- | --- | --- |
| S30O6 | 30/10/2026 | 7 | **20,05%** | La más corta del panel. |
| S13N6 | 13/11/2026 | 21 | 22,66% | |
| S30N6 | 30/11/2026 | 38 | **23,00%** | Mismo ticker que el fallback. Volumen nominal alto entre las S. |
| T30A7 | 30/04/2027 | 189 | 26,59% | Se parece al 26,5% escrito a mano. No es letra corta. |

El fallback de 26,5% en S30N6 queda **3,5 puntos arriba** de la TNA de ese ticker hoy (23,0%). La letra que vence en 7 días está en 20,05%. El regex de Rava, además, se queda con el **primer** match del HTML. El comentario dice “vencimiento más cercano y mayor volumen”; el código no ordena por ninguna de las dos cosas. Si el scrape llegara a funcionar y devolviera solo ticker y TNA, `lecapDetails` pisa el objeto entero y la pantalla puede perder la fecha de vencimiento.

**Dólar.** 5,0% anual fijo, en config y en la función. Es una tasa comercial, no una cotización.

**Cómo se etiqueta.** Si `/api/rates` responde 200, el front pinta verde “Tasas en vivo sincronizadas” siempre que venga `json.rates`. La función devuelve `success: true` y el objeto de fallback aunque `sourcesChecked` quede vacío (cada fuente falla adentro de su propio `try`). El cartel verde no distingue “esta tasa salió de una fuente” de “esta tasa es el número escrito en el archivo”.

El refresh cada 30 minutos reconsulta eso. Plazo fijo y letras, en las fuentes de hoy, son fotos diarias. Caución, que sí sería intradía, llegó vacía.

### Sheet y WhatsApp — leído, sin escribir

`config.js` tiene una URL real de Apps Script (no es un placeholder). Un GET de solo lectura con `?action=getStudios` respondió HTTP 200 y una página HTML cuyo texto es:

`Error Script function not found: doGet`

El deployment existe y es anónimo. El script no expone la función que el front llama al cargar y al validar un PIN nuevo. Los estudios que se ven son los tres de `config.js`. El `res.json()` falla, el `catch` se lo traga, y el PIN de demo sigue andando.

No hice POST. El body sigue siendo el mismo JSON. El header pasó a `text/plain;charset=UTF-8` con `mode: 'no-cors'`, que es un request simple y el browser lo deja salir. Dos límites que quedan:

1. Con `no-cors` la pantalla no lee la respuesta. El toast sale igual, haya fila o no.
2. El GET de estudios sigue dependiendo de un `doGet` que en el chequeo no estaba.

`adminWhatsapp` es `5493496462977`. El botón principal del modal es «Enviar solicitud» y no abre WhatsApp. Queda un link opcional a `wa.me` con ese número, aparte del guardado.

## 4. Gaps para el puntapié, en orden

### P0 — Sin esto el link que se comparte, o el número que se ve, están mal

1. **El link público.** Hecho en el repo: el Website de GitHub ya es `https://zeta-contadores-zeta-landing.vercel.app/`. `zetatesoreria.vercel.app` da 404 y no hay que usarla (es el proyecto con Root Directory en la raíz del repo). Si más adelante se quiere un dominio corto, se apunta un alias en Vercel sobre el proyecto canónico. Si alguien ya guardó el dominio viejo, un redirect evita el 404.
2. **Tasas que se muestran.** En la URL buena, `/api/rates` ya corre y solo declaró `plazofijo_live` (22,4%). La LECAP que ve el contador es 26,5%; S30N6 hoy está en 23,0% y la letra a 7 días (S30O6) en 20,05%. La caución salió del fallback porque el endpoint devolvió `[]`. El cartel verde no mira `sourcesChecked`. El mapa sembrado en 35–38% hay que corregirlo antes de que la caución vuelva a traer filas.
3. **Llegada del caso.** El front ya manda el JSON en `text/plain` al webhook, y el número de aviso es `5493496462977`. Falta confirmar que el Apps Script tenga `doPost` y que una solicitud de prueba aparezca en la hoja. `doGet` (estudios) seguía sin existir en el chequeo de solo lectura.

### P1 — Antes de pasarle el link a un estudio

4. **PIN.** Los de demo estaban en el JavaScript público, en el README y, dos de ellos, como botones en la pantalla de ingreso. La URL `?pin=` abre la terminal sin tipear. No hay intento fallido, ni vencimiento, ni chequeo de servidor: es una puerta en el browser. Para producción los PIN no pueden vivir en `config.js`. Un endpoint que responda sí/no (sin devolver el listado entero) alcanza para esta versión. El `getStudios` actual, el día que funcione, le entrega todos los PIN a cualquiera que llame la URL.
5. **Texto regulatorio y de la simulación.** En el HTML no aparece CNV, la matrícula 2103, ni una línea de “esto es una simulación, no es consejo de inversión”. El cálculo es interés simple bruto a 365 días: sin comisiones, sin impuestos, sin el plazo real de la letra. La tarjeta igual dice “Intereses netos que ingresan a la cuenta comitente”. La caución dice “Riesgo cero de crédito”. Hay “Apertura 100% bonificada” y, en dólares, “Liquidación en dólares billete”. La tabla dice “ordenado por rendimiento” y el orden está fijo (LECAP, caución, plazo fijo, cuenta corriente). Con menos de 30 días el plazo fijo figura N/A en la tabla y se puede elegir igual, y el número se calcula.
6. **Una sola salida del caso.** El botón principal ya es «Enviar solicitud»: escribe el Sheet y avisa con el toast. WhatsApp quedó como link opcional, con el número `5493496462977`, y no se abre solo. El toast confirma igual, sin leer si la fila entró (el POST es `no-cors`).

### P2 — Cierre de experiencia

7. **LECAP: dejar el scrape.** Rava es HTML, el regex toma el primer ticker, y desde un server de Vercel es fácil que haga timeout (4 segundos en el código, y acá no respondió en 20). El JSON de letras ya trae ticker, TNA, vencimiento, días y volumen. Ahí se puede elegir de verdad la más corta o la de mayor volumen, y guardar la fecha.
8. **Promesa de actualización.** El código refresca cada 30 minutos. Las fuentes útiles de hoy son diarias, y la caución intradía vino vacía. En la barra alcanza “última lectura” más el horario. “En vivo, cada 30 minutos” queda grande para lo que las APIs están entregando.
9. **Marca.** Título genérico (“Simulador de Tesorería PyME”), estudios de demostración, sin logo. El flag de marca blanca ya está; falta usarlo con los estudios reales y decidir si Zeta se ve siempre, dado que la matrícula es tuya.
10. **Mobile, leído en el markup (no lo recorrí en un teléfono).** Pastillas de plazo en 5 columnas, filas comparativas con varias etiquetas en línea, resumen del modal en 3 columnas, header alto con el nombre del estudio. En 360px se aprieta. Tailwind por CDN muestra el aviso de “no usar en producción” y `lucide@latest` puede cambiarte iconos sin un deploy.
11. **FCI.** Si sigue en el alcance de esta versión, no está en el selector ni en el mensaje de WhatsApp. Si queda para después, el copy de la home no debería prometer un universo más chico o más grande que el que el contador puede elegir.

## 5. Plan de cierre

Cinco pasos. El primero alinea el link con el deploy que ya funciona. El segundo y el tercero hacen que el número y el caso sean usables. El cuarto es lo que te deja mostrarlo como Zeta / CNV. El quinto es la pasada de pantalla.

1. **URL canónica, ya apuntada desde GitHub.** Compartir `https://zeta-contadores-zeta-landing.vercel.app/` (ahí `/` y `/api/rates` ya andan). El Website del repo ya quedó en esa URL. `zetatesoreria.vercel.app` da 404: no usarla. Un dominio corto, si hace falta, es un alias de Vercel sobre este proyecto. El proyecto viejo puede quedar con un redirect, o darse de baja.
2. **Corregir la lectura de tasas y el cartel.** Sacar la semilla 35–38. Tomar la LECAP del JSON de letras (vencimiento, TNA, volumen) y retirar el scrape de Rava. Actualizar el fallback de S30N6 (hoy la función sirve 26,5% con `success: true`). Pintar verde solo la tasa que vino en `sourcesChecked`: hoy eso es solo el plazo fijo, 22,4%. Dejar escrito en la barra que caución, letra y plazo fijo se refrescan cuando la fuente publica, y que el job corre cada 30 minutos.
3. **Confirmar una fila real en el Sheet.** El número ya es `5493496462977` y el POST del front va en `text/plain` con el mismo JSON. Falta ver que `doPost` anote la fila. Los botones de PIN demo seguían en la pantalla de ingreso.
4. **Dejar la puerta y el texto publicables.** PIN fuera del JavaScript (chequeo en el server, sin listar estudios al browser). Pie visible: simulación de interés simple, sin comisiones ni impuestos, no es consejo de inversión, operador Zeta Finance CNV 2103. Reemplazar “intereses netos” y “riesgo cero”. Definir si FCI entra ahora.
5. **Una pasada mobile del comparador y del modal**, y dejar de depender de `cdn.tailwindcss.com` y de `lucide@latest` sin pin. El link ya abre; esta pasada es para mandárselo a un estudio sin que se le desarme en el teléfono.

## Qué quedó afuera a propósito

No se tocó la lógica de tasas, los PIN demo ni un disclaimer CNV. No se hizo POST de prueba al Apps Script. No se contrastó la caución contra la pantalla de BYMA. No se recorrió la UI en un celular. El GET a `/api/rates` fue de solo lectura.
