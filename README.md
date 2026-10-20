# Floatplane → AirPlay + Picture-in-Picture

Userscript de Tampermonkey para Safari en macOS que añade AirPlay y Picture-in-Picture
al reproductor de [Floatplane](https://www.floatplane.com), con un modo opcional que usa
el reproductor nativo de macOS.

## Instalación

1. Instala Tampermonkey en Safari.
2. Abre [floatplane-native-airplay.user.js](https://raw.githubusercontent.com/TheElectroclassics/floatplane-airplay/main/floatplane-native-airplay.user.js)
   y pulsa «Instalar» en Tampermonkey.
3. Abre cualquier video de Floatplane.

Tampermonkey buscará actualizaciones automáticamente en este repositorio (o a mano desde
el panel de Tampermonkey → «Buscar actualizaciones»).

## Uso

En la barra de controles del reproductor, a la izquierda de los botones de la derecha,
aparecen tres botones:

- **AirPlay** (icono): envía el video a un dispositivo AirPlay.
- **PiP** (icono): activa Picture-in-Picture.
- **Nativo**: cambia de forma permanente al reproductor nativo de macOS
  (se vuelve con «Reproductor de Floatplane»).

## Requisitos

- Safari en macOS (HLS nativo y AirPlay solo existen ahí).
- Sesión iniciada en Floatplane con una suscripción activa.
