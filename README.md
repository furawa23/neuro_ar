# NeuroAR · laboratorio web de redes neuronales

Aplicación educativa para Android y navegador: una red neuronal 2–4–1 que puedes explorar en 3D, inspeccionar y entrenar paso a paso. La versión principal está en **[web/](web/README.md)** y genera archivos estáticos para Firebase Hosting o un VPS con HTTPS. No necesita Unity ni ARCore.

## Empezar

Con Node.js 22.12 o posterior:

```powershell
cd web
npm install
npm run dev
```

Abre la URL local que muestra Vite. Para generar los archivos que se publican:

```powershell
npm test
npm run build
```

El resultado es `web/dist/`. Consulta **[desarrollo y despliegue](web/README.md)** para Firebase y Caddy en un VPS. No se ha publicado en una cuenta o dominio.

## Funciones

- Siete neuronas y doce conexiones seleccionables, con activaciones, sumas, pesos y sesgos visibles.
- Red densa con tanh, salida sigmoide y cuatro ejemplos XOR.
- Edición de parámetros y entrenamiento por retropropagación con curva BCE.
- Historial exacto: pausa, retrocede y edita un estado anterior para crear otro recorrido.
- Exploración 3D con giro y zoom, interfaz adaptable a móvil e inspector accesible.
- RA con cámara: ARToolkit reconoce el marcador impreso, estima su pose y coloca la red mientras permanece visible. No usa WebXR ni ARCore.
- Manifiesto para añadirla a la pantalla de inicio cuando el navegador lo permita. Esta versión no garantiza funcionamiento sin conexión.

## Marcador y cámara

La [hoja imprimible](web/public/markers/imprimir-marcador.html) debe imprimirse al 100 %, con el cuadrado negro exterior de **14 × 14 cm**. Mantén el margen blanco y el patrón completo visibles.

En Android abre una URL **HTTPS**, pulsa **Cámara RA** y concede acceso a la cámara. En desarrollo, HTTP solo permite cámara en el propio `localhost`; la dirección de red local del PC no es esa excepción. Puedes usar el modo 3D sin cámara.

**Estado:** el núcleo matemático y el reconocimiento del marcador tienen pruebas automatizadas. La compilación web está disponible. La cámara y el rendimiento en el Xiaomi Redmi Note 12S siguen pendientes de validación física; los tests y el navegador de escritorio no la sustituyen.

## Código anterior

Se conserva el prototipo Unity en `Assets`, `Packages` y `ProjectSettings` como referencia. Su documentación está en [Docs/UNITY.md](Docs/UNITY.md). La ruta de desarrollo actual es la web; no hace falta instalar Unity para continuar.
