# Playcase · Generador de diseños — guía de instalación y despliegue

Herramienta interna para generar el diseño de la funda (carátula + título + artista + reproductor)
a partir de la canción que pidió el cliente, y exportar el PNG para el proveedor.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | La herramienta (funciona igual en local y en la web) |
| `servidor.js` + `Iniciar Playcase.bat` | Versión local (solo tu PC) |
| `api/search.js`, `api/resolve.js`, `api/img.js` | Funciones para la versión web (Vercel) |
| `lib-covers.js` | Lógica compartida de búsqueda (iTunes + Deezer + resolución por URL) |
| `spotify-credentials.example.json` | Plantilla para las claves de Spotify (opcional) |

## Opción A · Web para los dos (recomendado, gratis con Vercel)

1. Crea una cuenta gratuita en <https://vercel.com> (puedes entrar con GitHub o Google).
2. En el panel: **Add New → Project → Import** y sube la carpeta `playcase-generador`
   (arrastrar y soltar con "Deploy sin Git", o con el CLI: `npm i -g vercel` y luego `vercel` dentro de la carpeta).
3. Antes de desplegar, en **Settings → Environment Variables** añade:
   - `ACCESS_KEY` = la contraseña que queráis (ej. una frase que solo conozcáis vosotros).
     Con esto, la web pedirá contraseña al entrar y nadie más podrá usarla.
   - Opcional: `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET` (ver abajo) para resolver enlaces de Spotify.
4. Despliega. Te dará una URL tipo `https://playcase-xxx.vercel.app` → esa es la página
   que usáis tú y tu socio desde cualquier navegador (también móvil).
5. Para actualizar la herramienta: vuelve a desplegar la carpeta con los cambios.

> La web no guarda nada en el servidor: los PNG se generan en el navegador de cada uno.
> El historial de pedidos sigue en Shopify + vuestra hoja de producción.

## Opción B · Solo en local (un PC)

1. Doble clic en **`Iniciar Playcase.bat`** (necesita Node.js instalado: ya lo tienes).
2. Se abre `http://localhost:4173`.
3. Para que tu socio lo use desde otro PC de la misma red: abriría `http://TU-IP:4173`
   (habría que permitir Node en el Firewall de Windows la primera vez).
   No funciona con el PC apagado — por eso la web es mejor opción si lo vais a usar a la vez.

## Contraseña (ACCESS_KEY)

- **Web (Vercel):** variable de entorno `ACCESS_KEY`.
- **Local:** crea un archivo `access-key.txt` junto a `servidor.js` con la contraseña dentro.
- Si no se configura, la herramienta queda abierta (para pruebas). Configúrala antes de dar la URL a nadie.

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
