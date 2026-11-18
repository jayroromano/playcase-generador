# PLAYCASE · integración con Shopify (Fase 1)

Esta fase deja el generador listo para usarse desde la tienda, pero **todavía no guarda diseños**
ni se conecta a Printify. El botón «Confirmar mi diseño» genera el PNG y envía metadatos al padre
para demostrar que la comunicación funciona.

## 1. URLs

| Uso | URL |
|---|---|
| Cliente (iframe de la tienda) | `https://TU-GENERADOR.vercel.app/?modo=cliente` |
| Administrador | `https://TU-GENERADOR.vercel.app/` |

`?modo=cliente` solo oculta controles avanzados en la interfaz. **La seguridad real está en el
servidor**: el panel de administración exige una sesión emitida por el servidor y las APIs aplican
autenticación, orígenes permitidos, límites y validación.

El panel de administración (`/`) muestra una pantalla de acceso hasta que el servidor valida la
cookie `playcase_admin` (HttpOnly, `SameSite=Strict`, `Path=/api`, 8 horas). Quitar `?modo=cliente`
de la URL **no** da acceso: sin sesión válida solo se ve el formulario de acceso.

Las herramientas exclusivas del administrador (subir imagen, tipografía, nombre de archivo y
descarga del PNG) se ejecutan en el navegador. La sesión protege el acceso normal al panel y las
APIs; como todo el HTML es estático, alguien que manipule el código de la página desde las
herramientas del navegador podría ejecutar funciones locales. No se considera un mecanismo
anticopia: los datos sensibles y la autenticación real viven en el servidor.

## 2. Variables de entorno

Configúralas en Vercel → Settings → Environment Variables. No inventes valores: usa los de tu
cuenta y tu tienda.

| Variable | Para qué |
|---|---|
| `PLAYCASE_PUBLIC_API` | `true` abre `search`, `resolve` e `img` al público (necesario para clientes). Si no es `true`, esas APIs exigen sesión de administrador o la cabecera heredada `x-key`. |
| `PLAYCASE_ALLOWED_ORIGINS` | Dominios autorizados, separados por comas y sin barra final. Debe incluir el dominio exacto de la tienda y, si se usa, el dominio propio. |
| `ADMIN_KEY` | Clave del panel de administración. Es obligatoria para entrar, incluso con `PLAYCASE_PUBLIC_API=true`. Si no se define, se usa `ACCESS_KEY`. |
| `ACCESS_KEY` | Clave interna heredada. También sirve como `ADMIN_KEY` si no defines `ADMIN_KEY`. |
| `PLAYCASE_SESSION_SECRET` | **Obligatorio en producción.** Secreto propio para firmar la cookie de sesión: mínimo 32 caracteres y distinto de `ADMIN_KEY`. Si falta, es corto o coincide con la clave, el panel admin queda deshabilitado (login `503`). En local es opcional: si no se define, se usa la clave. |
| `SPOTIFY_CLIENT_ID` | Opcional, solo servidor, para resolver enlaces de Spotify. |
| `SPOTIFY_CLIENT_SECRET` | Opcional, solo servidor. Nunca se envía al navegador. |

Ejemplo de formato (no son valores reales):

```
PLAYCASE_PUBLIC_API=true
PLAYCASE_ALLOWED_ORIGINS=https://mi-tienda.myshopify.com,https://www.mi-dominio.com
ADMIN_KEY=una-clave-larga-y-aleatoria
PLAYCASE_SESSION_SECRET=otro-secreto-largo-y-aleatorio
```

Sin `ADMIN_KEY` ni `ACCESS_KEY`, el panel de administración queda deshabilitado (el login responde
`503`) y no se abre por defecto. En producción, `PLAYCASE_SESSION_SECRET` también es obligatorio:
si falta, mide menos de 32 caracteres o coincide con la clave de administrador, **no se habilitan
sesiones administrativas** y el login responde `503`. En local, `http://localhost:4173` y
`http://127.0.0.1:4173` se permiten automáticamente. En producción solo se aceptan orígenes
`https://`.

## 3. Contrato de `postMessage`

El iframe nunca usa `'*'`. El destino se toma de `PLAYCASE_ALLOWED_ORIGINS` y cada mensaje
recibido se valida contra ese mismo origen.

### Padre (Shopify) → iframe

| Mensaje | Cuándo |
|---|---|
| `{ type: 'playcase:init' }` | Al cargar el iframe o al abrir el modal. |
| `{ type: 'playcase:ping' }` | Para comprobar que el iframe responde. |

### Iframe → padre

| Mensaje | Contenido |
|---|---|
| `playcase:ready` | `{ type, version: 1, mode: 'cliente' \| 'admin' }` |
| `playcase:pong` | `{ type, version: 1 }` |
| `playcase-design-confirmed` | Metadatos del diseño generado (ver abajo). |

Ejemplo real de confirmación:

```json
{
  "type": "playcase-design-confirmed",
  "version": 1,
  "status": "generated",
  "saved": false,
  "requestId": "pc_8f1c…",
  "song": "LA GRACIOSA",
  "artist": "Quevedo & Elvis Crespo",
  "minute": "0:42",
  "image": { "mimeType": "image/png", "size": 53162, "width": 920, "height": 1134 }
}
```

Reglas importantes:

- `saved: false` es intencionado: **no hay guardado persistente todavía**.
- El PNG **no viaja por `postMessage`**. Se queda en el iframe como
  `window.playcaseLastDesign.blob` para poder comprobarlo desde la consola.
- No se inventan identificadores de pedido ni de diseño guardado; `requestId` solo identifica
  esta generación concreta.

## 4. Snippet para el tema (no aplicar todavía)

El iframe debe apuntar a la URL real del generador. Este ejemplo es solo una plantilla:
sustituye `https://TU-GENERADOR.vercel.app` y el `id` del iframe por los de tu tema.

```html
<iframe
  id="playcase-frame"
  src="https://TU-GENERADOR.vercel.app/?modo=cliente"
  title="Diseña tu funda"
  style="width:100%;height:760px;border:0"
></iframe>

<script>
  (function () {
    var PLAYCASE_ORIGIN = 'https://TU-GENERADOR.vercel.app';
    var frame = document.getElementById('playcase-frame');

    function send(type) {
      if (!frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage({ type: type }, PLAYCASE_ORIGIN);
    }

    window.addEventListener('message', function (event) {
      if (event.origin !== PLAYCASE_ORIGIN) return;
      var data = event.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

      if (data.type === 'playcase:ready') {
        send('playcase:init');
      }

      if (data.type === 'playcase-design-confirmed' && data.saved === false) {
        console.log('Diseño generado (sin guardar)', data.requestId, data.image);
      }
    });

    frame.addEventListener('load', function () { send('playcase:init'); });
  })();
</script>
```

Si el tema usa una Content-Security-Policy estricta, añade el dominio del generador a `frame-src`.

## 5. Medidas de seguridad incluidas

- APIs solo por `GET` (y `OPTIONS` para CORS); el resto responde `405`.
- Validación de longitud y limpieza de `song`, `artist` y `url`.
- Rate limiting en memoria: búsqueda 30/min (90 con sesión o `x-key`), resolución 20/min
  (40 con sesión), imágenes 60/min (180 con sesión), configuración 60/min.
- Login de administrador: 8 intentos por IP cada 15 minutos; sesión 60/min y logout 30/min.
- Orígenes permitidos mediante variable de entorno; `Origin` desconocido → `403`. El propio
  dominio del panel se acepta como mismo origen para que el login funcione en Vercel.
- Panel de administración: cookie `playcase_admin` firmada con HMAC, `HttpOnly`,
  `SameSite=Strict`, `Path=/api`, `Secure` en producción y 8 horas de validez. La clave se envía
  solo en la cabecera `x-admin-key` del login y nunca se guarda en `localStorage`.
- En producción `PLAYCASE_SESSION_SECRET` es obligatorio (mínimo 32 caracteres y distinto de
  `ADMIN_KEY`). Si falta, es corto o coincide con la clave, no se habilitan sesiones admin.
- Sin `ADMIN_KEY`/`ACCESS_KEY`, el login admin responde `503`; no queda abierto.
- El logout borra la cookie en el navegador. La sesión es stateless: un token copiado seguiría
  siendo válido hasta caducar (8 horas). Para revocación inmediata haría falta un almacén compartido.
- Las APIs públicas siguen abiertas con `PLAYCASE_PUBLIC_API=true`; el panel admin no.
- Imágenes: solo `https`, hosts de carátulas permitidos, sin credenciales, puerto 443,
  sin seguir redirecciones, máximo 8 MB, tipo real verificado por magic bytes (JPEG/PNG/WebP).
- Errores públicos genéricos; el detalle queda solo en el log del servidor.
- `/api/config` solo devuelve `publicApi`, `requiresKey`, `adminAuth`, `allowedOrigins` y `version`.
- El PNG no se envía en base64 ni se simula un guardado.

### Limitaciones del rate limiting en Vercel

Los contadores viven en memoria de cada instancia. Vercel puede arrancar varias instancias y
reciclarlas en cualquier momento, así que el límite es **best-effort por instancia**: no es un
límite global fiable. Para un límite estricto y compartido haría falta un almacén externo
(Vercel KV/Upstash Redis) o un WAF. Mientras tanto, el login mantiene además una clave larga y
la cookie se firma con HMAC; el rate limit reduce fuerza bruta, pero no la elimina al 100 %.

## 6. Cómo probar en local

```powershell
cd playcase-generador
npm.cmd test
npm.cmd start
```

- Cliente: abre `http://localhost:4173/?modo=cliente`.
- Administrador: abre `http://localhost:4173/`, introduce la clave y comprueba que sin ella solo
  se ve la pantalla de acceso.
- Comunicación: abre `http://localhost:4173/parent-demo`, pulsa «Enviar playcase:init»,
  «Enviar playcase:ping» y, dentro del iframe, «Confirmar mi diseño». La página del padre debe
  mostrar `playcase:ready`, `playcase:pong` y `playcase-design-confirmed` con `saved: false`.

## 7. Pendientes para fases siguientes

1. Configurar las variables reales en Vercel (orígenes exactos de la tienda y `ADMIN_KEY`).
2. Aplicar el snippet en una copia del tema y probar el iframe dentro de Shopify.
3. Guardado persistente del diseño y del pedido (todavía no implementado).
4. Conexión con Printify y flujo de producción (fuera de esta fase).
5. Valorar un almacén compartido (KV/Upstash) para que el rate limiting sea global.
