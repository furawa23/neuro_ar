# NeuroAR web · Android · RA sin marcador

Laboratorio educativo para explorar una red neuronal en 3D, inspeccionar sus parámetros y observar un entrenamiento. **RA sin marcador** utiliza SLAM de 8th Wall: estima el movimiento de la cámara respecto al entorno y permite colocar la red en un punto del espacio. Después de colocarla puedes acercarte y recorrerla con el celular mientras se mantenga el seguimiento.

`web/` es independiente del proyecto Unity de la raíz. Su compilación produce archivos estáticos para GitHub Pages, Firebase Hosting o un VPS con HTTPS.

**Estado de validación:** la cámara, el seguimiento espacial, la colocación y el rendimiento del Xiaomi Redmi Note 12S siguen pendientes de prueba física. El objetivo inicial es Chrome actualizado en Android. Los tests matemáticos, la compilación y la revisión en escritorio no certifican que la RA funcione en un dispositivo concreto. **Explorar 3D** sigue disponible como modo sin cámara.

## Usar la RA en Android

1. Abre **https://furawa23.github.io/neuro_ar/** directamente en Chrome del teléfono. Usa una URL HTTPS y evita el navegador integrado de otra aplicación para esta primera prueba.
2. Activa **RA sin marcador**. Concede el permiso de cámara y el de sensores de movimiento si el navegador lo solicita.
3. Encuadra una zona con detalles visibles y contraste, con luz uniforme y sin reflejos. No hace falta detectar una mesa completa: también se aceptan puntos 3D localizados por el motor.
4. Desplaza el teléfono lentamente de lado para observar detalles desde distintos ángulos; no te limites a girarlo. Una superficie lisa, oscura o borrosa dificulta obtener referencias.
5. Cuando aparezca un indicador, pulsa **Colocar en este punto 3D** o **Colocar en esta superficie**, según el resultado. El botón utiliza el punto encontrado, aunque no esté exactamente en el centro. También puedes tocar otro punto en la imagen. Una esfera representa un punto del entorno; un aro representa una estimación de superficie.
6. Camina despacio alrededor o acércate a las neuronas. Toca una neurona o conexión para inspeccionarla; también puedes modificar parámetros, entrenar y recorrer el historial.
7. Para cambiar de sitio utiliza **Volver a colocar**. **Reescanear** reinicia el reconocimiento y descarta el anclaje anterior; úsalo si comenzaste en una zona poco adecuada.
8. Vuelve a **Explorar 3D** para detener la sesión de cámara y explorar con giro y zoom en pantalla.

No se necesita un marcador impreso. La posición y el tamaño de la red son aproximados; no constituyen una medición de la superficie. El seguimiento puede interrumpirse por movimientos rápidos, desenfoque, cambios de luz o falta de textura. La sesión no representa un anclaje permanente guardado para futuras visitas.

### Si no aparece un punto de colocación

Abre **Estado de RA** debajo de la cámara. Distingue cámara detenida o congelada, movimiento todavía inicializando, seguimiento limitado y seguimiento activo sin puntos. **Copiar estado** genera un resumen local para soporte; no incluye imágenes, coordenadas, orientación ni datos personales y no se envía automáticamente.

El adaptador solicita `hitTest(x, y, ['FEATURE_POINT'])`, tal como documenta la [API oficial](https://8thwall.org/docs/api/engine/xrcontroller/hittest). Conserva las estimaciones de superficie válidas y permite usar un punto 3D válido como anclaje con seguimiento normal. La versión anterior descartaba `FEATURE_POINT`, esperando solo tipos de superficie que el motor no garantiza devolver.

## Requisitos y permisos

La cámara necesita HTTPS; `http://localhost` es una excepción para desarrollo en el mismo equipo. Desde otro dispositivo, `http://192.168.x.x:5173` no equivale a `localhost`. Para probar la RA en el Redmi usa la URL HTTPS de Pages o de otro alojamiento.

8th Wall requiere cámara mediante `getUserMedia`, WebGL, WebAssembly SIMD y orientación del dispositivo para SLAM. Consulta sus [requisitos oficiales del navegador](https://8thwall.org/docs/troubleshooting/browser-requirements). El seguimiento se ejecuta en la web y esta integración no exige que el Android esté certificado para ARCore; eso no garantiza por sí solo la compatibilidad del hardware o de sus sensores.

Si la cámara no se abre, comprueba los permisos del sitio y los de Chrome en Android, y cierra otras aplicaciones que puedan estar utilizándola. Si se deniega un permiso, puedes seguir en 3D y reintentar la RA después de corregirlo. Una interrupción, bloqueo de pantalla o cambio de aplicación puede requerir iniciar de nuevo la sesión y volver a colocar la red.

El manifiesto permite añadir la aplicación a la pantalla de inicio según las opciones de Chrome. Esta versión no incluye una garantía de uso sin conexión.

## Desarrollo y compilación

Instala Node.js **22.12 o posterior**, con npm. Desde la raíz del repositorio:

```powershell
cd web
npm install
npm run dev
```

Abre la URL local de Vite, normalmente `http://127.0.0.1:5173/`. Para explorar en escritorio utiliza el modo 3D; disponer de una webcam no sustituye la validación del seguimiento móvil.

Para compilar y revisar el resultado:

```powershell
npm test
npm run build
npm run check:build
npm run preview
```

Publica el contenido completo de `dist/`. La compilación incluye los recursos del motor bajo `external/xr/`; conserva esa carpeta completa junto con los avisos y licencias del paquete. `preview` solo sirve para revisar la compilación localmente.

Para exponer el servidor de desarrollo a la red local puedes ejecutar `npm run dev -- --host 0.0.0.0`. La dirección HTTP de red sirve para revisar la interfaz 3D; usa un alojamiento HTTPS para probar cámara y sensores desde el teléfono.

## Publicar en GitHub Pages

Repositorio: **https://github.com/furawa23/neuro_ar/**. Aplicación: **https://furawa23.github.io/neuro_ar/**.

El workflow `.github/workflows/pages.yml` instala dependencias con `npm ci`, ejecuta las pruebas, compila `web/dist`, verifica sus rutas y publica al subir cambios de `web/` a `main`. También puede iniciarse desde **Actions → Publicar NeuroAR en GitHub Pages → Run workflow**.

La configuración inicial debe usar **Settings → Pages → Build and deployment → Source → GitHub Actions**. Publicar directamente la raíz de `main` muestra el README en lugar de compilar la aplicación.

`vite.config.js` usa `base: './'` para que los recursos funcionen bajo `/neuro_ar/` y en la raíz de un dominio. Conserva también las rutas relativas de los archivos del motor. `npm run check:build` comprueba la compilación en servidores temporales bajo `/` y `/neuro_ar/`, sin ocultar errores con una respuesta de página única.

Sigue el resultado en [Actions del repositorio](https://github.com/furawa23/neuro_ar/actions). Tras completarse, abre la URL de Pages en Chrome del Android, activa la RA y valida la colocación caminando lentamente alrededor de la red. El workflow utiliza los permisos temporales de GitHub Actions y no necesita secretos Firebase.

## Publicar en Firebase Hosting

`firebase.json` configura `dist` como carpeta pública. Utiliza un proyecto propio con Hosting habilitado y, desde `web/`, después de compilar:

```powershell
npm install --global firebase-tools
firebase login
firebase deploy --only hosting --project TU_PROJECT_ID
```

Sustituye `TU_PROJECT_ID` por el identificador real. No hace falta añadir el SDK de Firebase a la aplicación para servir los archivos estáticos. El comando mostrará la URL HTTPS. Consulta la [guía oficial de Firebase Hosting](https://firebase.google.com/docs/hosting/quickstart).

La configuración permite cámara del mismo origen, desactiva micrófono y geolocalización y aplica caché prolongada a los archivos compilados con nombre versionado de `assets/`. La página y el manifiesto se revalidan. Los archivos del motor también deben publicarse: copia siempre la compilación completa.

## Publicar en un VPS con Caddy

Se incluye `deploy/Caddyfile`, preparado para `/var/www/neuroar/dist` con un dominio y HTTPS. Requiere Caddy instalado, DNS apuntando al VPS y puertos TCP 80 y 443 accesibles.

1. Compila y copia el **contenido completo** de `dist/` a `/var/www/neuroar/dist/`. `index.html` y `external/` deben quedar directamente dentro de ese directorio.
2. Cambia `example.com` por tu dominio. Si ya hay otros sitios, conserva la configuración existente e incorpora el bloque nuevo.
3. Valida la configuración antes de recargar:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

El usuario del servicio debe poder recorrer y leer el directorio. Consulta [Caddy en Linux](https://caddyserver.com/docs/running#linux-service) y [HTTPS automático](https://caddyserver.com/docs/automatic-https). El servidor de producción no necesita ejecutar Vite o Node.js.

## Motor y licencia

Se utiliza el paquete de distribución gratuita **`@8thwall/engine-binary@1.0.0`**, que incluye SLAM. Su licencia permite distribuir el binario original con una aplicación y alojarlo en infraestructura propia. Es software propietario: no es el paquete MIT del motor abierto y no debe modificarse ni descompilarse. Conserva sus avisos y consulta la [licencia oficial](https://8thwall.org/docs/engine/license) y los [avisos incluidos](public/licenses/NOTICE.txt).

La aplicación conserva archivos y pruebas del prototipo anterior con ARToolkit y marcador impreso como referencia histórica. Esos archivos no forman parte del flujo inicial de **RA sin marcador**.

## Prueba física antes de compartir

- Abrir la URL HTTPS y comprobar que el motor y la interfaz cargan sin errores de recursos.
- Aceptar o rechazar permisos y confirmar que 3D sigue disponible.
- Establecer seguimiento, colocar la red y verificar que conserva su posición al caminar alrededor.
- Seleccionar neuronas y conexiones, editar, entrenar y recorrer el historial en RA.
- Volver a colocar la red, cambiar a 3D y reiniciar la cámara.
- Bloquear y desbloquear el teléfono, cambiar de aplicación y comprobar la recuperación.
- Evaluar temperatura, fluidez y deriva con uso sostenido en el Redmi.

Estas comprobaciones de cámara y movimiento siguen pendientes en el teléfono; las pruebas automatizadas no las sustituyen.
