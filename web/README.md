# NeuroAR web · Android · RA sin marcador

Laboratorio educativo para explorar una red neuronal en 3D, inspeccionar sus parámetros y observar un entrenamiento. **RA sin marcador** utiliza SLAM de 8th Wall: estima el movimiento de la cámara respecto al entorno y permite colocar la red en un punto del espacio. La cámara ocupa toda el área de la aplicación; al tocar una neurona o conexión aparece una ficha WebGL 3D vinculada a la red. Después de colocarla puedes acercarte y recorrerla con el celular mientras se mantenga el seguimiento.

`web/` es independiente del proyecto Unity de la raíz. Su compilación produce archivos estáticos para GitHub Pages, Firebase Hosting o un VPS con HTTPS.

## Aprender y experimentar en la feria

La pantalla inicial comienza en **Aprender paso a paso**. El ejemplo representa dos interruptores y una lámpara: debe encenderse cuando sus posiciones son diferentes (XOR). La guía propone cambiar una entrada, explorarla, seguir la señal por etapas, entrenar y probar una desconexión. Se puede avanzar manualmente o cambiar a **Explorar libremente**; los detalles de épocas, BCE, historial, fórmulas y pseudocódigo permanecen disponibles.

Al tocar un elemento, su ficha 3D empieza por **Qué hace**. **Valores** permite inspeccionar y editar; **Código** muestra pseudocódigo equivalente a los cálculos actuales. Al abrirse en RA, la ficha elige un tamaño y una posición de lectura frente a la cámara, conserva su vínculo con el elemento y después permanece en ese lugar del espacio. Solo su orientación de lectura gira hacia la cámara; este ajuste no mueve la red ni el ancla.

**Experimentar con la red**, en el panel lateral o en **Controles** durante la RA, incluye:

- **Ver neurona por dentro:** muestra sus productos entrada × peso, suma, sesgo, función de activación y respuesta como objetos 3D con valores reales. El interior de una neurona intermedia tiene dos aportes; el de la salida, cuatro. **Cerrar interior** vuelve a la red completa.
- **Desconectar selección:** aplica una máscara al cálculo conservando los parámetros. Una conexión o una entrada/neuronas intermedias se pueden cortar; la salida se conserva para observar la predicción. Si una conexión depende de una neurona cortada, primero hay que restaurar esa neurona. Entrenar no reconecta una pieza ni modifica los parámetros que su máscara mantiene inactivos.
- **Restaurar antes del corte:** recupera el estado completo anterior a la primera intervención, incluido el historial. **Deshacer último cambio** permite volver a un punto anterior; una operación de entrenamiento iniciada con el botón también prepara su punto de retorno.
- **Reto de reparación:** parte de una red entrenada durante 3000 rondas y altera su sesgo de salida en +6.5. Inicialmente resuelve tres de los cuatro ejemplos; reducir el sesgo o entrenar cambia de verdad las respuestas. La meta es recuperar los cuatro casos y reducir el error inicial del reto. Hay pistas y una solución restaurable.
- **Un ejemplo incorrecto:** ambas redes parten de sus parámetros tras 3000 rondas de XOR y reinician a cero el contador de rondas nuevas. Ahora la etiqueta de `1,1` se cambia a `1`, aunque XOR exige `0`. Se distingue el conteo de etiquetas aprendidas del conteo contra la regla correcta. **Volver a mi red anterior** restaura exactamente el experimento inmediatamente anterior, con datos, historial, máscaras y modelo comparativo. Los datos XOR originales no se alteran. Se permiten hasta ocho experimentos anidados antes de volver o reiniciar.
- **Comparar arquitecturas:** añade una red real sin capa oculta, con `sigmoide(w₁x₁ + w₂x₂ + b)`, los mismos ejemplos y rondas. La red principal continúa siendo la MLP 2–4–1 editable. Las intervenciones manuales se aplican a esta última, como indica el panel. Rebobinar el historial también recupera la evolución correspondiente de la comparación.
- **Mapa de predicciones:** consulta cada modelo en una cuadrícula de dos entradas de 0 a 1. Azul representa salida hacia 0 y lima hacia 1; los puntos marcan los cuatro ejemplos XOR. Las zonas entre ejemplos son respuestas del modelo, no una medición de exactitud fuera de los ejemplos. La textura se recalcula al cambiar el modelo, no en cada frame.
- **Modo expositor:** prepara una red inicial, entrenada o un reto. **Siguiente visitante** limpia el experimento, las intervenciones y los retornos, y vuelve al recorrido guiado. Estos botones no detienen ni recentran el seguimiento; el anclaje se conserva mientras siga siendo válido.

Los cálculos de entrenamiento y de las intervenciones son reales para este pequeño modelo educativo. No se entrenan modelos industriales ni se analiza el contenido de la cámara para clasificar objetos. Esta entrega no incorpora proyección a otro monitor ni códigos QR.

La comprensión por ingresantes y la legibilidad y fluidez de estas nuevas vistas en el Redmi requieren una prueba en el lugar de exposición. La revisión de escritorio y las pruebas de interfaz con un motor simulado no certifican el seguimiento físico.

**Estado de validación:** el usuario confirmó que la RA de la versión anterior funciona bien en su Xiaomi Redmi Note 12S. La nueva interfaz de cámara a pantalla completa y las fichas 3D todavía necesitan una prueba física de legibilidad e interacción en ese teléfono. Los tests y la revisión en escritorio no sustituyen esa comprobación ni una evaluación de rendimiento y deriva con uso sostenido. El objetivo inicial es Chrome actualizado en Android. **Explorar 3D** sigue disponible como modo sin cámara.

## Usar la RA en Android

1. Abre **https://furawa23.github.io/neuro_ar/** directamente en Chrome del teléfono. Usa una URL HTTPS y evita el navegador integrado de otra aplicación para esta primera prueba.
2. Activa **RA sin marcador**. La cámara ocupa toda la aplicación. Concede el permiso de cámara y el de sensores de movimiento si el navegador lo solicita.
3. Encuadra una zona con detalles visibles y contraste, con luz uniforme y sin reflejos. No hace falta detectar una mesa completa: también se aceptan puntos 3D localizados por el motor.
4. Desplaza el teléfono lentamente de lado para observar detalles desde distintos ángulos; no te limites a girarlo. Una superficie lisa, oscura o borrosa dificulta obtener referencias.
5. Cuando aparezca un indicador, pulsa **Colocar en este punto 3D** o **Colocar en esta superficie**, según el resultado. El botón utiliza el punto encontrado, aunque no esté exactamente en el centro. También puedes tocar otro punto en la imagen. Una esfera representa un punto del entorno; un aro representa una estimación de superficie.
6. Camina despacio alrededor o acércate a las neuronas. Toca una neurona o conexión para abrir su ficha dentro de la escena: **Valores** muestra la activación y la fórmula; **Concepto** explica su función. Los botones **− 0.1** y **+ 0.1** modifican el sesgo de una neurona oculta o de salida, o el peso de una conexión. Las entradas no tienen un sesgo editable. La **×** cierra la ficha.
7. Abre **Controles** para elegir un ejemplo XOR, entrenar, pausar o recorrer el historial. **Ajustes de la escena** contiene el tamaño de la red, **Ver señal**, **Reescanear** y la ayuda. El menú permanece cerrado hasta que lo solicites.
8. Para cambiar de sitio utiliza **Volver a colocar**. **Controles → Ajustes de la escena → Reescanear** reinicia el reconocimiento y descarta el anclaje anterior; úsalo si comenzaste en una zona poco adecuada.
9. Pulsa **Salir de RA** para detener la sesión de cámara y regresar al laboratorio **Explorar 3D**, con giro y zoom en pantalla.

La ficha está renderizada como un plano 3D, unido al contenido anclado y orientado hacia la cámara para facilitar la lectura. Sus valores se actualizan al editar, entrenar o recorrer el historial. Acércate para leerla: su tamaño es espacial. Al volver a colocar la red o cambiar de modo se cierra. El inspector HTML permanece disponible en el laboratorio 3D y se oculta durante la RA.

La vista de cámara llena el área disponible mediante CSS. **Controles → Ajustes de la escena → Pantalla completa** solicita además ocultar las barras del navegador cuando este lo permite; si no lo permite, la cámara sigue ocupando toda la aplicación.

No se necesita un marcador impreso. La posición y el tamaño de la red son aproximados; no constituyen una medición de la superficie. El seguimiento puede interrumpirse por movimientos rápidos, desenfoque, cambios de luz o falta de textura. La sesión no representa un anclaje permanente guardado para futuras visitas.

### Si no aparece un punto de colocación

Abre **Controles → Estado de RA**. Distingue cámara detenida o congelada, movimiento todavía inicializando, seguimiento limitado y seguimiento activo sin puntos. **Copiar estado** genera un resumen local para soporte; no incluye imágenes, coordenadas, orientación ni datos personales y no se envía automáticamente.

El adaptador solicita `hitTest(x, y, ['FEATURE_POINT'])`, tal como documenta la [API oficial](https://8thwall.org/docs/api/engine/xrcontroller/hittest). Conserva las estimaciones de superficie válidas y permite usar un punto 3D válido como anclaje con seguimiento normal. La versión anterior descartaba `FEATURE_POINT`, esperando solo tipos de superficie que el motor no garantiza devolver.

La revisión `puntos3d-2` valida la posición real del punto y calcula su distancia desde la cámara, sin exigir orientación de superficie a un `FEATURE_POINT`. La red queda vertical, orientada hacia la cámara al colocarla; esa orientación permanece fija al caminar. Las superficies conservan su orientación del SDK. No se generan posiciones alternativas si faltan coordenadas válidas. El resumen distingue rechazos por posición, distancia u orientación para precisar cualquier fallo restante; los límites de distancia se expresan en unidades relativas del seguimiento, no en metros.

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
- Comprobar que la cámara ocupa toda la aplicación en vertical y horizontal, que **Salir de RA** responde y que el menú **Controles** se abre y cierra sin desplazar la red.
- Seleccionar neuronas y conexiones, acercarse para leer **Valores** y **Concepto**, editar con **−/+**, y cerrar la ficha 3D.
- Entrenar, pausar y recorrer el historial desde **Controles**; comprobar que la ficha refleja el estado seleccionado.
- Volver a colocar la red, cambiar a 3D y reiniciar la cámara.
- Bloquear y desbloquear el teléfono, cambiar de aplicación y comprobar la recuperación.
- Evaluar temperatura, fluidez y deriva con uso sostenido en el Redmi.

El funcionamiento de la RA anterior fue confirmado por el usuario en el Redmi. Las comprobaciones de la nueva interfaz inmersiva, la legibilidad de las fichas y el uso sostenido siguen pendientes en el teléfono; las pruebas automatizadas no las sustituyen.
