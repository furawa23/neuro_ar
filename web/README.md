# NeuroAR web · Android

Aplicación web móvil para explorar una red neuronal en 3D, inspeccionar sus parámetros y observar cómo cambia durante un entrenamiento educativo. El modo de cámara coloca la red sobre el marcador impreso de NeuroAR mientras permanece visible.

La carpeta `web` es independiente del proyecto Unity de la raíz. Su compilación produce archivos estáticos para GitHub Pages, Firebase Hosting o un VPS. No requiere Unity para desarrollarla ni compilarla.

**Estado:** la prueba física de cámara, seguimiento y rendimiento en el Xiaomi Redmi Note 12S sigue pendiente. El objetivo de esta versión es Chrome en Android; las comprobaciones de escritorio y los tests no certifican la cámara del celular.

## Desarrollo y compilación

Instala Node.js **22.12 o posterior**, con npm, de acuerdo con `engines` en `package.json`. Desde la raíz del repositorio:

```powershell
cd web
npm install
npm run dev
```

Abre la dirección local que muestre Vite, normalmente `http://localhost:5173`. Para probar en escritorio puedes explorar la red en 3D; la cámara necesita un dispositivo o webcam disponible y el permiso del navegador.

Genera la versión distribuible y compruébala localmente:

```powershell
npm run build
npm run check:build
npm run preview
```

El resultado está en `dist/`. `preview` sirve esa compilación para revisarla; en producción publica `dist/` con HTTPS. Los archivos de `public/` se copian al compilar, incluidos el manifiesto, el icono y la hoja imprimible.

## Cámara en Android

1. Abre la aplicación mediante **HTTPS** en Chrome del Android.
2. Pulsa **Imprimir marcador RA** en la aplicación desde un equipo con impresora. En GitHub Pages la hoja está en `https://furawa23.github.io/neuro_ar/markers/imprimir-marcador.html`. Imprime en A4, al 100 % y sin encabezados ni pies. Comprueba que el borde negro exterior mide **14 × 14 cm** y conserva el margen blanco.
3. Coloca la hoja plana, bien iluminada y sin reflejos. Activa el modo de cámara y concede el permiso cuando Chrome lo solicite.
4. Enfoca el marcador completo y su margen. Empieza aproximadamente a 35–80 cm y ajusta la distancia hasta detectarlo. Muévete alrededor conservando el patrón visible.
5. Toca las neuronas o conexiones para inspeccionarlas. Vuelve al modo 3D para explorar sin la cámara.

El acceso a la cámara requiere un contexto seguro. `http://localhost` es una excepción para desarrollo en el dispositivo que abre esa dirección. Para exponer Vite en la red local puedes ejecutar `npm run dev -- --host 0.0.0.0`, pero entrar desde el celular en `http://192.168.x.x:5173` **no** equivale a `localhost`: permite revisar el modo 3D, mientras el navegador puede bloquear la cámara. Publica una compilación en HTTPS para probarla en el Redmi. Este requisito procede de [getUserMedia y sus condiciones de seguridad](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).

El seguimiento depende de la imagen impresa. No coloca anclajes libres sobre mesas, no conserva la posición cuando se pierde la hoja y no necesita ARCore. El movimiento se calcula a partir de los fotogramas; la precisión depende de la cámara, la luz, el tamaño impreso y el ángulo de visión. Esta primera versión no incluye un service worker ni garantiza funcionamiento sin conexión. El manifiesto permite solicitar una presentación independiente al añadirla a la pantalla de inicio, según las opciones que ofrezca Chrome.

Si no aparece la cámara, revisa que la URL sea HTTPS, que Chrome tenga permiso de cámara tanto en Android como para el sitio y que ninguna otra aplicación la esté usando. Tras cambiar permisos, recarga la página. Si el seguimiento se pierde, vuelve a mostrar el patrón completo sin cubrir bordes ni celdas.

## Publicar en GitHub Pages

El repositorio es `furawa23/neuro_ar` y la URL prevista es **https://furawa23.github.io/neuro_ar/**.

El workflow `.github/workflows/pages.yml` instala dependencias con `npm ci`, ejecuta las pruebas, compila `web/dist`, verifica sus rutas y publica la aplicación al subir cambios de `web/` a `main`. También puede ejecutarse manualmente desde **Actions → Publicar NeuroAR en GitHub Pages → Run workflow**.

La configuración inicial del repositorio debe usar **Settings → Pages → Build and deployment → Source → GitHub Actions**. Publicar directamente la raíz de `main` muestra el README en lugar de compilar la aplicación de `web/`.

`vite.config.js` usa `base: './'`: scripts, hojas de estilo, carga diferida y recursos se resuelven tanto en `/neuro_ar/` como en la raíz de un dominio. El manifiesto y los enlaces del marcador también usan rutas relativas. `npm run check:build` sirve la compilación bajo `/` y `/neuro_ar/` en servidores temporales aislados, verifica los archivos y falla si alguna ruta escapa a la subcarpeta.

La publicación puede seguirse en [Actions del repositorio](https://github.com/furawa23/neuro_ar/actions). Una vez completada, abre la URL de Pages en Chrome del teléfono y concede el permiso de cámara al pulsar **Cámara RA**. No hacen falta secretos de despliegue ni una cuenta Firebase: el workflow utiliza los permisos temporales de GitHub Actions.

## Publicar en Firebase Hosting

`firebase.json` ya configura `dist` como carpeta pública. No se incluye un proyecto de Firebase asociado ni credenciales. Necesitas un proyecto de tu cuenta con Hosting habilitado.

Desde `web/`, después de compilar:

```powershell
npm install --global firebase-tools
firebase login
firebase deploy --only hosting --project TU_PROJECT_ID
```

Sustituye `TU_PROJECT_ID` por el identificador real del proyecto. `firebase login` abre la autenticación de tu cuenta; `deploy` publica en el proyecto indicado. No es necesario ejecutar `firebase init` ni añadir el SDK de Firebase a la aplicación para servir estos archivos estáticos. El comando mostrará la URL HTTPS que debes abrir en el celular. Consulta la [guía oficial de Firebase Hosting](https://firebase.google.com/docs/hosting/quickstart) para crear el proyecto y autenticar la CLI.

La configuración permite `camera=(self)`, desactiva micrófono y geolocalización y aplica caché prolongada a los archivos compilados con nombre versionado de `assets/`. La página y el manifiesto se revalidan. Puedes revisar estos ajustes en la [referencia de configuración de Hosting](https://firebase.google.com/docs/hosting/full-config).

## Publicar en un VPS con Caddy

Se incluye `deploy/Caddyfile`, preparado para servir `/var/www/neuroar/dist` con un dominio. Requiere un VPS Linux con Caddy instalado, un dominio cuyo DNS apunte al servidor y los puertos TCP 80 y 443 accesibles.

1. Compila localmente con `npm run build` y copia el **contenido** de `dist/` al servidor, en `/var/www/neuroar/dist/`. El archivo principal debe quedar en `/var/www/neuroar/dist/index.html`, sin una carpeta `dist` adicional dentro.
2. Cambia `example.com` en `deploy/Caddyfile` por tu dominio real. Conserva una copia de la configuración existente si el VPS ya aloja otros sitios e incorpora el bloque nuevo a esa configuración.
3. Usa el bloque como configuración de Caddy y valida antes de recargar:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

El usuario del servicio Caddy debe poder recorrer `/var/www/neuroar` y leer los archivos compilados. Para la instalación y el servicio consulta la [documentación de Caddy en Linux](https://caddyserver.com/docs/running#linux-service).

Caddy obtiene y renueva el certificado del dominio y redirige HTTP a HTTPS cuando están correctamente configurados el DNS y el acceso desde Internet. Abre `https://tu-dominio` en el teléfono. Los requisitos de emisión están en [HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https). El servidor solo necesita los archivos compilados: no es necesario ejecutar Vite o Node.js para atender la aplicación.

## Comprobación antes de compartir la URL

- La página, scripts, icono y marcador cargan con HTTPS y sin errores 404.
- El permiso de cámara se solicita al activar esa función y puede rechazarse sin perder el modo 3D.
- La cámara trasera funciona en Chrome del Redmi, el patrón se detecta y la red se oculta al perderlo.
- Se pueden seleccionar neuronas y conexiones, editar parámetros, entrenar y recorrer el historial con la cámara y en 3D.
- Al volver de otra aplicación o bloquear/desbloquear el teléfono, el modo 3D sigue disponible y la cámara puede reactivarse.
- La prueba sostenida permite evaluar temperatura, fluidez y estabilidad reales del dispositivo.

Estos pasos de cámara y rendimiento siguen pendientes de validación en el teléfono; las comprobaciones de compilación y alojamiento no los sustituyen.
