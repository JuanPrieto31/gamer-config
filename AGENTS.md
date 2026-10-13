# Gamer Config — guía para colaboradores y agentes de IA

Contexto del proyecto para quien trabaje en él, sea una persona o un agente (Claude Code, Codex, OpenCode, Cursor…).
Léelo entero antes de cambiar nada.

## Qué es

Gamer Config es una app de escritorio para **Windows 10/11**. Hace tres cosas:

- **Optimiza Windows** para jugar.
- **Configura el vídeo de cada juego** según el hardware real del PC.
- **Añade herramientas** para jugar: estadísticas en el juego, modo juego automático, prueba de conexión y comprobación de drivers.

Va dirigida a jugadores sin conocimientos técnicos. Todo lo que ve el usuario está **en español**, con lenguaje claro y sin jerga.

## Stack

- **Electron 44.** Proceso principal en ESM: `electron/*.js`. Hay un `preload` aislado (`electron/preload.cjs`) y toda la comunicación pasa por IPC.
- **Interfaz.** Vite + TypeScript sin frameworks: `src/`. Iconos de `@phosphor-icons/core`.
- **Acceso al sistema.** Los datos y cambios de Windows se hacen con PowerShell mediante `execFile`, nunca con un shell con texto interpolado.
- **Instalador y actualizaciones.** `electron-builder` genera el instalador NSIS y `electron-updater` actualiza desde las Releases de GitHub.
- **FPS.** Se miden con PresentMon 2.6.0 de Intel (MIT, en `vendor/`, desempaquetado del asar).

## Comandos

```bash
npm install
npm run app          # tsc + vite build y abre la app
npm test             # autotest SOLO LECTURA: cálculo + simulación en tus juegos instalados; debe terminar en "TODO OK"
npm run build        # comprobar tipos y compilar la interfaz
npm run instalador   # instalador NSIS en release/
node electron/configparse.js   # prueba de ida y vuelta de los formatos de configuración
```

Con `--pruebas`, la app usa otra carpeta de datos (`%APPDATA%\Gamer Config (pruebas)`), así no ensucias la tuya.

## Estructura

| Ruta | Qué hay |
|---|---|
| `electron/main.js` | Arranque, ventana, bandeja, segundo plano, IPC y actualizaciones automáticas |
| `electron/system.js` | Detección de hardware, pantalla, juegos instalados y drivers (locales + en línea) |
| `electron/calc.js` | Modelo de cálculo: elige el nivel de cada ajuste según el hardware y el objetivo (FPS / Equilibrado / Calidad) |
| `electron/gpus.js`, `electron/cpus.js` | Tablas de rendimiento relativo de gráficas (con VRAM por versión, iGPU y potencia en portátiles) y procesadores |
| `electron/demand.js` | Requisitos de cada juego (Steam) para estimar lo que pide |
| `electron/optimize.js` | Perfiles, plan de ajustes, escritura atómica con copia de seguridad, calibración con FPS reales |
| `electron/configparse.js` | Lector/escritor de formatos: ini, json, xml, kv (Valve), scr, space, colon (Minecraft). Solo cambia el valor, respeta el resto del archivo |
| `electron/autodetect.js` | Busca archivos de configuración de juegos sin perfil |
| `electron/windows.js` | Optimizaciones de Windows con historial y deshacer |
| `electron/online.js` | Consultas en línea con caché (Windows Update, NVIDIA) |
| `electron/overlay.js` + `overlay.html` | Estadísticas en el juego (ventana transparente que no captura clics) |
| `electron/gamemode.js` | Modo juego automático (plan de energía, cerrar/reabrir apps, recuperación tras cierre inesperado) |
| `electron/network.js` | Prueba de conexión |
| `electron/cleanup.js` | Limpieza de lo que dejan las actualizaciones de los juegos: solo borra lo de su lista, nunca partidas, ajustes ni mods |
| `electron/covers.js` | Portadas de juegos sin imagen (Epic, Riot, Xbox, búsqueda en Steam, icono del exe) |
| `src/main.ts` | Toda la interfaz |
| `src/api.ts` | Tipos y puente con el proceso principal (con datos de ejemplo para `npm run dev` en el navegador) |
| `src/names.ts` | Nombres en español y explicación de cada ajuste de vídeo |
| `profiles/` | Perfiles por juego + `engines/` (Unreal y genérico) + `index.json` |

## Perfiles de juegos (`profiles/`)

La app instalada descarga los perfiles **en vivo desde la rama `main`** de este repositorio (`PROFILES_URL` en `electron/optimize.js`). Un perfil roto en `main` llega a todos los usuarios sin publicar una versión nueva. La app solo comprueba que sea JSON válido, que el `id` coincida y que `settings` sea una lista: claves o valores mal puestos no se detectan. Revisa con cuidado cada cambio de perfil antes de subirlo.

Al añadir o cambiar un perfil:

- **Versiones:** sube `version` en el JSON del perfil y la misma versión en `profiles/index.json`. Si es nuevo, regístralo ahí.
- **Juego:** `games` son ids del lanzador (`steam-730`…); `names` sirve para detectarlo por nombre. `config.path` admite `{steam}`, `{docs}`, comodines `*`… y `config.format` es uno de los formatos de `configparse.js`.
- **Formatos:** además de los de `configparse.js`, `optimize.js` tiene `flat` (los `.ini` de Unreal) y otros propios en `FORMATS`.
- **Niveles:** cada ajuste tiene `levels` como `[valor, etiqueta, coste, {cpu, vram, visual}]`, con el cuarto elemento opcional.
  - El **coste** es el % aproximado de FPS que cuesta en la gráfica.
  - `visual` es el peso de lo que se pierde en imagen al bajarlo: por defecto 1, más alto si se nota mucho. Va en el ajuste o en cada nivel.
  - `fixed` fuerza un valor por modo.
- **Fuentes:** costes basados en fuentes reales (guías de NVIDIA, del desarrollador…), citadas en `sources`.
- **Etiquetas:** en español, neutras y comprensibles.
- **Comprobación:** `npm test` simula los tres modos en los juegos instalados en tu PC. Solo prueba el perfil si tienes el juego. Si no lo tienes, pruébalo con un archivo de configuración de ejemplo, comprobando que se lee y que la escritura no cambia el número de líneas.

## Reglas que no se rompen

- **Siempre reversible.**
  - Antes de escribir un archivo de un juego se hace una copia de seguridad, y se escribe de forma atómica (tmp + rename).
  - Todo cambio de Windows queda en el historial con su forma de deshacerlo.
- **Pedir permiso y confirmar.**
  - Nada se aplica sin que el usuario lo confirme.
  - Lo que necesita administrador pide elevación de forma explícita.
  - Después se comprueba en Windows que el cambio se aplicó de verdad.
- **La BIOS nunca se actualiza sola.** Solo se avisa y se enlaza al fabricante.
- **Drivers comprobados contra la nube.** No se muestra "al día" sin haberlo comprobado en línea. Si no hay conexión, se dice.
- **Nada de inyección en juegos.**
  - El overlay es una ventana aparte y PresentMon lee eventos ETW, así que es seguro con los antitrampas. No añadas hooks, DLLs ni lectura de memoria de procesos.
  - El overlay oculto no debe consumir nada: el muestreo se detiene.
- **No matar procesos del sistema.** Respeta la lista `PROTECTED` de `gamemode.js`.
- **Privacidad.**
  - No se envían datos personales ni identificadores a ningún servicio.
  - Las consultas en línea son solo para versiones de drivers, requisitos y portadas.
- **Seguridad en PowerShell.** Nada de interpolar texto del usuario o de archivos en comandos: pasa argumentos o valida contra listas conocidas (como hace `win-action` con los ids de inicio).

## Estilo de código

- **Simple antes que listo.**
  - La solución más corta que funcione, sin dependencias nuevas si lo resuelve la plataforma.
  - No añadas abstracciones "por si acaso".
- **Seguir lo que ya hay.**
  - Imita el estilo del archivo que tocas: nombres, densidad de comentarios, ESM en `electron/`, TypeScript estricto en `src/`.
  - Comentarios y textos de la interfaz en español.
- **Cambios en el puente.** Si cambias tipos o métodos del puente, actualiza a la vez `src/api.ts` (tipos + datos de ejemplo), `electron/preload.cjs` y el handler en `electron/main.js`.
- **Cálculo.**
  - Si cambias `calc.js`, `gpus.js` o `cpus.js`, comprueba que el resultado sigue teniendo sentido en equipos débiles, medios y potentes, no solo en el tuyo.
  - Los valores de las tablas son rendimiento relativo: mantén la escala.

## Antes de dar un cambio por terminado

1. `npm run build` sin errores de tipos.
2. `npm test` termina en `TODO OK`.
3. Si tocaste formatos de configuración: `node electron/configparse.js` todo `ok`.
4. Pruébalo en la app real (`npm run app -- --pruebas`) si afecta a la interfaz o al sistema.
5. Una segunda revisión (otra persona u otro agente) para cambios en cálculo, parsers o cualquier cosa que escriba en el sistema.

## Publicar una versión

1. **Versión.** Sube `version` en `package.json` y actualiza el `README.md` si hay funciones nuevas.
2. **Commit.** Haz commit y push a `main`.
3. **Instalador.** `npm run build && npx electron-builder --win nsis --publish never` genera `Gamer-Config-Setup-x.y.z.exe`, su `.blockmap` y `latest.yml`.
4. **Release.** `gh release create vX.Y.Z` con esos **tres** archivos. Sin `latest.yml` las actualizaciones automáticas no ven la versión.
5. **Comprobación.** `https://github.com/JuanPrieto31/gamer-config/releases/latest/download/latest.yml` debe devolver la versión nueva.

Notas:

- El nombre del instalador no lleva espacios (`nsis.artifactName`): GitHub renombra los archivos con espacios y eso rompe las actualizaciones.
- Si el antivirus bloquea electron-builder (`spawn UNKNOWN`), repite con otra carpeta de salida: `--config.directories.output=release-2`.
- El instalador no está firmado: es normal el aviso de SmartScreen.

## Qué no se sube

`node_modules/`, `dist/`, `release*/` y carpetas locales de herramientas (`graphify-out/`, `.opencode/`…). Revisa el `.gitignore` antes de añadir archivos generados.
Nunca subas claves, tokens ni datos de tu PC.
