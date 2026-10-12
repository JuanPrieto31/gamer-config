# Gamer Config

Aplicación de escritorio para Windows que optimiza Windows y la configuración de vídeo de tus juegos según tu PC.

## Qué hace

- **Detecta tus juegos** de Steam, Epic, Riot, Xbox, EA, Ubisoft, Battle.net, GOG, Rockstar y Roblox, también los que instales después, con su portada.
- **Calcula la configuración de vídeo** con todo tu hardware: gráfica (y su versión de memoria y potencia en portátiles), VRAM, procesador, hilos, cantidad, canales y velocidad de la RAM, disco, batería, plan de energía, resolución y Hz de la pantalla principal. Usa los requisitos de Steam de cada juego y el coste de cada ajuste.
- **Aprende de tus FPS reales**: cuando mides una partida con las estadísticas en el juego, corrige el cálculo de ese juego en tu PC.
- **Perfiles propios** para LoL, Apex, Deadlock, Warframe, Dying Light, RE6, Fortnite, Counter-Strike 2, GTA V, Minecraft y Marvel Rivals; los juegos de Unreal Engine y el resto se configuran por detección automática.
- **Elige un modo**: FPS, Equilibrado o Calidad. Se aplica a un juego o a todos a la vez.
- **Edita a mano** los ajustes de vídeo del juego, con nombres en español y una explicación de qué hace cada uno.
- **Optimiza Windows** con permiso, confirmación, historial y deshacer. Comprueba en Windows que cada cambio se aplicó de verdad. Incluye un apartado "Aligerar Windows" para equipos con menos recursos.
- **Comprueba tus drivers en internet**: la gráfica NVIDIA contra la última versión publicada por NVIDIA, y el resto (chipset, Wi-Fi, red, audio, Bluetooth) contra Windows Update. Enlaza a la página del fabricante y abre su programa oficial (Lenovo Vantage, HP Support Assistant, Dell SupportAssist, MyASUS, AMD Software, Intel Driver & Support Assistant…), en torre o portátil. La BIOS nunca se actualiza sola.
- **Estadísticas en el juego**: FPS, 1 % más bajo, uso y temperatura de la gráfica, VRAM, CPU y RAM encima del juego, con un atajo de teclado. Personalizable (qué mostrar, posición, tamaño, fondo). No inyecta nada en el juego, así que es seguro con los antitrampas, y oculto no consume nada.
- **Modo juego automático**: al abrir un juego pone el plan de máximo rendimiento y cierra los programas que elijas; al cerrarlo, todo vuelve a como estaba.
- **Prueba de conexión**: ping hasta el router, internet y varias regiones de servidores, para saber si el lag es de tu Wi-Fi, de tu proveedor o del juego.
- **Segundo plano y actualizaciones automáticas**: se queda junto al reloj y se actualiza sola desde las versiones de este repositorio.

Antes de cambiar un archivo de un juego se guarda una copia, y todo se puede deshacer.

## Instalar

Descarga `Gamer-Config-Setup-x.y.z.exe` desde [Releases](https://github.com/JuanPrieto31/gamer-config/releases) y ejecútalo.

El instalador no está firmado, así que Windows puede mostrar un aviso de SmartScreen: pulsa **Más información → Ejecutar de todas formas**.

Desde la 0.4.0 la app se actualiza sola. Para versiones anteriores, instala la nueva encima: el instalador detecta la anterior, la desinstala y mantiene tus datos (historial y copias de seguridad en `%APPDATA%\Gamer Config`).

## Desarrollo

```bash
npm install
npm run app          # compila la interfaz y abre la app
npm test             # pruebas del cálculo y de los perfiles
npm run instalador   # genera el instalador en release/
```

Hecho con Electron, Vite y TypeScript. Los FPS se miden con [PresentMon](https://github.com/GameTechDev/PresentMon) de Intel (licencia MIT, en `vendor/`). Los perfiles de cada juego están en `profiles/` y la app los actualiza desde este repositorio.
