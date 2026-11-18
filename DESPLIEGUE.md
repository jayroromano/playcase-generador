# Playcase · Generador de diseños — guía de instalación y despliegue

Generador de diseños de fundas musicales. Tiene un **modo cliente** (para la tienda Shopify) y un
**modo administrador** (herramientas avanzadas y descarga manual del PNG).

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | La herramienta (funciona igual en local y en la web) |
| `servidor.js` + `Iniciar Playcase.bat` | Versión local (solo tu PC) |
| `api/search.js`, `api/resolve.js`, `api/img.js` | Funciones para la versión web (Vercel) |
| `api/config.js` | Configuración pública del generador (sin secretos) |
| `api/admin/` | Login, comprobación de sesión y logout del administrador |
| `lib-covers.js` | Lógica compartida de búsqueda (iTunes + Deezer + resolución por URL) |
| `lib-security.js` | Validación, CORS, rate limiting, imágenes seguras, sesión de admin y configuración pública |
| `tests/` | Pruebas locales (`npm test`) y demo del padre para probar `postMessage` |
| `INTEGRACION-SHOPIFY.md` | Contrato del iframe, `postMessage` y variables de entorno |
| `spotify-credentials.example.json` | Plantilla para las claves de Spotify (opcional) |

## Opción A · Web para los dos (recomendado, gratis con Vercel)

1. Crea una cuenta gratuita en <https://vercel.com> (puedes entrar con GitHub o Google).
2. En el panel: **Add New → Project → Import** y sube la carpeta `playcase-generador`
   (arrastrar y soltar con "Deploy sin Git", o con el CLI: `npm i -g vercel` y luego `vercel` dentro de la carpeta).
3. Antes de desplegar, en **Settings → Environment Variables** añade:
   - `PLAYCASE_PUBLIC_API` = `true` para que los clientes puedan buscar sin clave.
   - `PLAYCASE_ALLOWED_ORIGINS` = dominio(s) de la tienda separados por comas, sin barra final
     (ejemplo de formato: `https://mi-tienda.myshopify.com,https://www.mi-dominio.com`).
   - `ADMIN_KEY` = clave larga y aleatoria para entrar en el panel de administración. Si no la
     defines, se usa `ACCESS_KEY`. Sin ninguna de las dos, el panel admin queda deshabilitado.
   - `PLAYCASE_SESSION_SECRET` = **obligatorio en producción**: secreto largo (mínimo 32
     caracteres) y distinto de `ADMIN_KEY`, para firmar la cookie de sesión. Si falta, es corto o
     coincide con la clave, el login admin responde `503` y no se habilitan sesiones.
   - Opcional: `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET` (ver abajo) para resolver enlaces de Spotify.
4. Despliega. Te dará una URL tipo `https://playcase-xxx.vercel.app` → esa es la página
   que usáis tú y tu socio desde cualquier navegador (también móvil).
5. Para actualizar la herramienta: vuelve a desplegar la carpeta con los cambios.

> La web no guarda nada en el servidor: los PNG se generan en el navegador de cada uno.
> El historial de pedidos sigue en Shopify + vuestra hoja de producción.

## Opción B · Solo en local (un PC)

1. Doble clic en **`Iniciar Playcase.bat`** (necesita Node.js instalado: ya lo tienes).
2. Se abre `http://localhost:4173`.
3. Para entrar al panel de administración la primera vez, crea un archivo `access-key.txt` en esta
   carpeta con una clave larga (o define `ADMIN_KEY`). Sin esa clave, el panel queda deshabilitado
   a propósito. En local no hace falta `PLAYCASE_SESSION_SECRET` (se usa la clave para firmar).
   Para que la búsqueda funcione sin clave en local, define `PLAYCASE_PUBLIC_API=true`.
4. Para que tu socio lo use desde otro PC de la misma red: abriría `http://TU-IP:4173`
   (habría que permitir Node en el Firewall de Windows la primera vez).
   No funciona con el PC apagado — por eso la web es mejor opción si lo vais a usar a la vez.

## Acceso: API pública y sesión de administrador

- **Clientes (recomendado para la tienda):** `PLAYCASE_PUBLIC_API=true` y
  `PLAYCASE_ALLOWED_ORIGINS` con el dominio exacto de la tienda. El cliente entra en
  `https://TU-WEB.vercel.app/?modo=cliente` y no ve herramientas de administración.
- **Administrador:** define `ADMIN_KEY` (o `ACCESS_KEY`) y, en producción,
  `PLAYCASE_SESSION_SECRET` (mínimo 32 caracteres y distinto de `ADMIN_KEY`). Entra en
  `https://TU-WEB.vercel.app/`. La web muestra una pantalla de acceso y el servidor emite una
  cookie `HttpOnly` de 8 horas; la clave no se guarda en `localStorage` ni se acepta por `?key=`.
- **Sin clave o sin secreto de sesión válido:** el panel de administración queda deshabilitado
  (login `503`), no abierto. En producción el secreto no puede faltar, ser corto ni coincidir con
  `ADMIN_KEY`.
- **API cerrada:** si no pones `PLAYCASE_PUBLIC_API=true`, `search`/`resolve`/`img` exigen la
  sesión de administrador o la cabecera heredada `x-key`. Los clientes no podrán buscar.
- `?modo=cliente` **no es una medida de seguridad**: solo oculta controles. Quitar ese parámetro
  no da acceso al panel: sin sesión válida solo aparece el formulario de acceso.

> **Rate limiting en Vercel:** los contadores son en memoria y por instancia. Vercel puede tener
> varias instancias o reciclarlas, así que el límite reduce la fuerza bruta pero no es global.
> Para un límite estricto haría falta Vercel KV/Upstash u otro almacén compartido.

## Cliente y administrador

- Cliente: `/?modo=cliente` → buscar, elegir carátula, ver el diseño, elegir minuto y confirmar.
- Administrador: `/` → primero inicia sesión con `ADMIN_KEY`; después puede pegar enlaces, subir
  imágenes, cambiar tipografía, ajustar el nombre de archivo y descargar el PNG.
- El botón «Cerrar sesión» borra la cookie del navegador. La cookie es `HttpOnly`, así que el
  JavaScript de la página nunca puede leer la clave ni el token.
- La comunicación con Shopify usa `postMessage` con origen validado. Ver
  `INTEGRACION-SHOPIFY.md` para el contrato completo y el snippet del tema.

## Enlaces de Spotify (opcional, gratis)

La búsqueda por **nombre** y los enlaces de **Apple Music** funcionan sin configurar nada.
Para resolver también enlaces de Spotify (exactos):

1. Entra en <https://developer.spotify.com/dashboard> → **Create app**.
2. Nombre: `Playcase` (el que sea), descripción la que sea.
3. Redirect URI: `http://localhost:4173/` (si lo usas en local) o la URL de tu web de Vercel.
4. Copia **Client ID** y **Client Secret**.
5. Local: copia `spotify-credentials.example.json` a `spotify-credentials.json` y pega las claves.
   Web: ponlas como variables de entorno en Vercel (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`).

## Uso con cada pedido

1. Busca canción + artista (los datos que dejó el cliente en el pedido) o pega su enlace.
2. Elige la versión correcta de los resultados.
3. Nombre de archivo = nº de pedido de Shopify (ej. `1201_la-graciosa`).
4. Descarga el **PNG transparente** (ese va al proveedor) y revísalo con el de fondo oscuro.
5. Coloca el pedido en AliExpress con DSers, págalo, y mándale la imagen por el chat
   con el nº de pedido: *"Hi! For AliExpress order #XXXX, please print the attached image
   on the case for [model]. Wait for my confirmation before producing. Thanks!"*
