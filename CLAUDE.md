# Contexto del proyecto

Userscript de Tampermonkey (`floatplane-native-airplay.user.js`) para Safari/macOS que
añade AirPlay y Picture-in-Picture a floatplane.com. Todo el código vive en ese único archivo.

## Cómo funciona

- Se ejecuta en `document-start` con `@grant none` para enganchar `URL.createObjectURL`
  (detectar ManagedMediaSource) y un `PerformanceObserver` (capturar las `.m3u8` que pide la página)
  antes de que cargue el reproductor de Floatplane.
- **Modo "enhance"** (por defecto): conserva el reproductor de Floatplane y añade una capa
  con botones AirPlay / PiP / Nativo.
  - AirPlay directo si el video usa ManagedMediaSource: se añade un `<source type="application/x-mpegURL">`
    alternativo y se pone `disableRemotePlayback = false`.
  - Si usa MediaSource clásico, AirPlay cambia temporalmente a un `<video>` nativo con el HLS
    en el mismo punto y abre el selector de AirPlay.
- **Modo "native"**: reemplaza el reproductor por un `<video>` nativo (versión 1 del script).
- El modo se guarda en `localStorage` (`fpNative.mode`); la calidad preferida en `fpNative.quality`.

## API de Floatplane usada (con la cookie de sesión del usuario)

- `GET /api/v3/content/post?id=<postId>` → `videoAttachments`, `thumbnail`
- `GET /api/v3/creator/named?creatorURL[0]=<creator>` → `liveStream` (directos)
- `GET /api/v3/delivery/info?scenario=onDemand|live&entityId=<id>` → `groups[].origins[].url` + `groups[].variants[].url`

## Estado

- v1 (reemplazo por reproductor nativo) probada por el usuario: funciona.
- v2.0.0 (modo enhance con AirPlay/PiP sobre el reproductor de Floatplane) sin probar todavía
  en la página real. El reproductor original se detecta de forma genérica (el `<video>` más grande).

## Al cambiar el script

- Subir `@version` en la cabecera (Tampermonkey solo actualiza si cambia).
- Publicar con commit + `git push` a `main` en https://github.com/TheElectroclassics/floatplane-airplay
  (`@updateURL`/`@downloadURL` apuntan al raw de `main`).
- Comprobar sintaxis con `node --check floatplane-native-airplay.user.js`.
- Mantener textos de interfaz y comentarios en español.
