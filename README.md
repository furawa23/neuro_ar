# NeuroAR · laboratorio web de redes neuronales

Aplicación educativa para Android y navegador: explora una red neuronal 2–4–1, inspecciona sus parámetros y observa cómo aprende. El modo **RA sin marcador** usa seguimiento del entorno con 8th Wall para colocar la red en un punto del espacio y acercarte a ella con el celular. La carpeta principal es **[web/](web/README.md)** y genera archivos estáticos para GitHub Pages, Firebase Hosting o un VPS con HTTPS.

**Estado:** la cámara, el anclaje espacial y el rendimiento en el Xiaomi Redmi Note 12S requieren validación física. La compilación y las pruebas matemáticas no certifican la compatibilidad del teléfono ni la estabilidad del seguimiento. El modo **Explorar 3D** permite usar el laboratorio sin cámara.

## Probar la realidad aumentada

1. Abre **https://furawa23.github.io/neuro_ar/** en Chrome actualizado del Android y activa **RA sin marcador**.
2. Concede acceso a la cámara y, si el navegador lo solicita, a los sensores de movimiento.
3. Mueve el celular lentamente mirando una superficie horizontal con detalles visibles y buena luz. Usa el suelo o una mesa y mantén una sola superficie como referencia.
4. Cuando la aplicación esté preparada, toca un punto del área de cámara para **Colocar** la red. Su posición pertenece al espacio que sigue la cámara; puedes caminar despacio alrededor y acercarte mientras se mantenga el seguimiento.
5. Toca las neuronas o conexiones para inspeccionarlas y utiliza los controles de entrenamiento. Pulsa **Volver a colocar** para elegir otro punto.

No necesitas imprimir una hoja. El seguimiento puede perderse con poca luz, reflejos, superficies lisas o movimientos rápidos. La colocación y el tamaño son aproximados; si la red se desplaza, vuelve a colocarla en una zona con más detalles.

## Empezar a desarrollar

Con Node.js 22.12 o posterior:

```powershell
cd web
npm install
npm run dev
```

Para generar y comprobar los archivos que se publican:

```powershell
npm test
npm run build
npm run check:build
```

El resultado es `web/dist/`. Consulta **[desarrollo y despliegue](web/README.md)** para GitHub Pages, Firebase y Caddy. El workflow de Pages publica los cambios de `web/` en `main` en **https://furawa23.github.io/neuro_ar/**.

## Funciones

- Siete neuronas y doce conexiones seleccionables, con activaciones, sumas, pesos y sesgos visibles.
- Red densa con tanh, salida sigmoide y cuatro ejemplos XOR.
- Edición de parámetros y entrenamiento por retropropagación con curva BCE.
- Historial exacto: pausa, retrocede y edita un estado anterior para crear otro recorrido.
- Exploración 3D con giro y zoom, interfaz adaptable a móvil e inspector accesible.
- RA sin marcador con seguimiento espacial del entorno, colocación por toque y nueva colocación.
- Manifiesto para añadirla a la pantalla de inicio cuando el navegador lo permita. No se garantiza funcionamiento sin conexión.

## Motor y versiones anteriores

La RA utiliza el binario de 8th Wall con SLAM, alojado con la aplicación y sujeto a su [licencia propietaria](https://8thwall.org/docs/engine/license). Los requisitos del navegador se detallan en la [documentación de 8th Wall](https://8thwall.org/docs/troubleshooting/browser-requirements); esta ruta no depende de la certificación ARCore del celular.

Se conservan los archivos del prototipo con marcador y el proyecto Unity como referencia histórica. Su documentación anterior está en [Docs/UNITY.md](Docs/UNITY.md). La experiencia actual de RA se inicia sin papel y el desarrollo principal continúa en `web/`.
