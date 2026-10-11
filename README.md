# Gamer Config

Aplicación de escritorio para Windows que optimiza Windows y la configuración de vídeo de tus juegos según tu PC.

## Qué hace

- **Detecta tus juegos** de Steam, Epic, Riot, Xbox, EA, Ubisoft, Battle.net, GOG, Rockstar y Roblox, también los que instales después.
- **Calcula la configuración de vídeo** con todo tu hardware: gráfica, VRAM, procesador, hilos, cantidad, canales y velocidad de la RAM, disco, batería, plan de energía, resolución y Hz. Usa los requisitos de Steam de cada juego y el coste de cada ajuste.
- **Elige un modo**: FPS, Equilibrado o Calidad. Se aplica a un juego o a todos a la vez.
- **Edita a mano** los ajustes de vídeo del juego, con nombres en español y una explicación de qué hace cada uno.
- **Optimiza Windows** con permiso, confirmación, historial y deshacer. Comprueba en Windows que cada cambio se aplicó de verdad. Incluye un apartado "Aligerar Windows" para equipos con menos recursos.
- **Muestra drivers y BIOS** (gráfica, chipset, Wi-Fi, red, audio, Bluetooth) con enlaces a la página del fabricante, en torre o portátil. La BIOS nunca se actualiza sola.

Antes de cambiar un archivo de un juego se guarda una copia, y todo se puede deshacer.

## Instalar

Descarga `Gamer Config Setup x.y.z.exe` desde [Releases](https://github.com/JuanPrieto31/gamer-config/releases) y ejecútalo.

El instalador no está firmado, así que Windows puede mostrar un aviso de SmartScreen: pulsa **Más información → Ejecutar de todas formas**.

Para actualizar, instala la versión nueva encima. El instalador detecta la anterior, la desinstala y mantiene tus datos (historial y copias de seguridad en `%APPDATA%\Gamer Config`).

## Desarrollo

```bash
npm install
npm run app          # compila la interfaz y abre la app
npm test             # pruebas del cálculo y de los perfiles
npm run instalador   # genera el instalador en release/
```

Hecho con Electron, Vite y TypeScript. Los perfiles de cada juego están en `profiles/` y la app los actualiza desde este repositorio.
