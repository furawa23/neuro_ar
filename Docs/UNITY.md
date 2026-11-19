# NeuroAR · Android · marcador impreso

Laboratorio educativo de una red neuronal 2–4–1 con exploración 3D y seguimiento de un marcador impreso mediante la cámara. Esta versión sustituye la colocación sobre mesas de ARCore por visión por computadora local, orientada a probar el proyecto en el **Xiaomi Redmi Note 12S** del usuario.

**Estado:** código y pruebas matemáticas disponibles; compilación Unity, APK y validación física en el Redmi pendientes. Las pruebas sintéticas no certifican el comportamiento de la cámara real.

## Qué incluye

- Siete neuronas y doce conexiones seleccionables, con activaciones numéricas e inspector de sumas, pesos, sesgos y funciones.
- Red densa con `tanh` en la capa oculta y sigmoide en la salida. Cuatro ejemplos XOR.
- Edición de parámetros, entrenamiento real por retropropagación, pasos de diez épocas y curva de error BCE.
- Historial exacto con pausa, retroceso, reproducción y ramificaciones al editar un estado anterior.
- Modo 3D con giro y zoom.
- Modo de cámara: detección del patrón, estimación de su posición y orientación, suavizado y representación de la red sobre la hoja. Al perder el patrón se oculta la red y se solicita mostrarlo de nuevo.
- Control de permisos, selección de cámara trasera, recuperación de errores y pausa/reanudación.
- Interfaz vertical en español y configuración de compilación Android ARM64.

El seguimiento utiliza el patrón específico que acompaña al proyecto. No reconoce una fotografía arbitraria ni conserva un anclaje libre cuando el patrón sale de la cámara.

## Preparar la hoja

1. Abre [la hoja de impresión](Markers/imprimir-marcador.html) en un navegador y pulsa **Imprimir marcador**.
2. Selecciona **A4**, **100 % / tamaño real**, sin encabezados ni pies de página.
3. Imprime en papel mate, conserva el margen blanco y comprueba con una regla que el **cuadrado negro exterior mide 14 × 14 cm**. La imagen completa con margen mide 18 × 18 cm.
4. Coloca la hoja plana sobre una mesa bien iluminada. Evita reflejos, pliegues y cubrir el borde o las celdas.

También se incluyen [la imagen PNG](Markers/neuroar-marker.png) y [la imagen vectorial SVG](Markers/neuroar-marker.svg). La página de impresión incluye una referencia de 5 cm para comprobar la escala. El patrón binario es un marcador propio de NeuroAR, no un código QR.

## Abrir el proyecto

1. Instala Unity Hub y **Unity 6000.0.62f1 (Unity 6.0 LTS)** con **Android Build Support**, **Android SDK & NDK Tools** y **OpenJDK**. Completa la activación de Unity correspondiente a tu cuenta.
2. En Unity Hub selecciona **Add project from disk** y abre esta carpeta, la que contiene `Assets`, `Packages` y `ProjectSettings`.
3. Espera la importación. La configuración se actualiza automáticamente; también está disponible en **NeuroAR → Preparar proyecto Android**.
4. Abre `Assets/NeuroAR/Scenes/NeuroAR.unity`. Elige una Game View vertical y pulsa **Play**.
5. En 3D, arrastra el fondo para girar y usa la rueda para acercarte. En Android, utiliza dos dedos para el zoom. Toca esferas y conexiones para inspeccionarlas.
6. Pulsa **Ver marcador**, concede acceso a la cámara y enfoca el patrón completo. En el editor puede utilizarse una webcam disponible para las primeras comprobaciones.

La cámara debe ver tanto el cuadrado como su margen blanco. Mantén el patrón cerca del centro de la imagen y sitúa la red en el espacio visible entre los controles. Prueba inicialmente a unos 35–80 cm, ajustando la distancia hasta reconocerlo. Puedes acercarte y cambiar de ángulo mientras el patrón siga visible. **Reescanear** descarta la pose anterior; **Volver a 3D** detiene la cámara.

## Compilar e instalar

En Unity: **NeuroAR → Compilar APK Android**. Al cambiar el destino a Android, la compilación continúa después de la importación.

Con Unity cerrado, desde PowerShell:

```powershell
.\scripts\build-android.ps1
```

Si el editor está instalado en otra carpeta:

```powershell
.\scripts\build-android.ps1 -UnityPath 'D:\Unity\6000.0.62f1\Editor\Unity.exe'
```

La APK de desarrollo se genera en `Builds/Android/NeuroAR.apk`; el registro, en `Builds/Logs/android-build.log`. Se configura Android API 24+, ARM64, IL2CPP y OpenGLES3. La firma es de desarrollo, no una publicación para Google Play.

Con depuración USB y `adb` disponible:

```powershell
adb install -r .\Builds\Android\NeuroAR.apk
```

También puedes copiar la APK al celular y abrirla desde el administrador de archivos, autorizando esa fuente cuando Android lo solicite. No hace falta instalar Servicios de Google Play para RA ni un SDK adicional de seguimiento. El uso de la cámara y el modo 3D siguen pendientes de validación en el dispositivo.

## Pruebas automatizadas

Con .NET 9 y Node.js:

```powershell
.\scripts\check-project.ps1
```

El script verifica el manifest, ejecuta las pruebas independientes de Unity, regenera las imágenes de impresión y analiza la sintaxis C# 9 para Android y el editor. Si no hay Node, ejecuta las pruebas sintéticas del detector y omite regenerar los archivos.

Pruebas incluidas:

- **185** comprobaciones de la red y del historial: los 17 gradientes mediante diferencias finitas, convergencia XOR, estabilidad, copias, restauración y ramificaciones.
- **1972** comprobaciones de pose y orientación: proyección de puntos, rotaciones, reflejo de cámara, recuperación de posición y seis recorridos integrados de imagen sintética → detector → pose.
- **157** comprobaciones del detector cuando se incluye la imagen de impresión generada: perspectiva, cuatro orientaciones, ruido, iluminación desigual, objetos cercanos y rechazo de patrones inválidos. Sin ese archivo adicional se ejecutan 151.

Comandos individuales:

```powershell
dotnet run --project .\Tests\CoreChecks\CoreChecks.csproj
dotnet run --project .\Tests\PoseChecks\PoseChecks.csproj
node .\scripts\generate-marker.mjs
dotnet run --project .\Tests\VisionChecks\VisionChecks.csproj -- .\Builds\Checks\marker-fixture.pgm
```

Con la semilla inicial, el entrenamiento XOR reduce la pérdida de aproximadamente `0.68881` a `0.00164` a las 3000 épocas. Estos resultados verifican el modelo matemático, no la compilación de Unity ni la calidad del seguimiento físico.

## Cómo funciona el seguimiento

`WebCamTexture` entrega los fotogramas. El detector corrige la orientación y el reflejo, reduce la imagen a un máximo de 512 píxeles en su lado mayor y busca el borde y el patrón de celdas. Las esquinas identificadas permiten estimar una homografía y una pose con el tamaño físico conocido. Esa pose coloca la red; una confirmación consecutiva y un suavizado reducen saltos. La detección se intenta unas doce veces por segundo; no es una medición de rendimiento en el teléfono.

El modelo de cámara emplea una estimación inicial de **60° en su lado mayor**, sin calibración específica del Redmi ni corrección de distorsión óptica. La posición y altura son aproximadas: conviene mantener el patrón cerca del centro y validar la alineación con el teléfono. La oclusión, el desenfoque, la poca luz, los reflejos y los ángulos extremos pueden interrumpir el seguimiento.

El Redmi Note 12S no aparece en la [lista oficial de ARCore](https://developers.google.com/ar/devices). Esta versión procesa el patrón con la cámara y no requiere esa plataforma. No utiliza una cuenta de proveedor de seguimiento, ni contiene carga de imágenes a un servidor. Las imágenes deben permanecer visibles para mantener la experiencia.

## Organización

```text
Assets/NeuroAR/
  Scenes/NeuroAR.unity       Escena de entrada
  Scripts/Core/             Red y sesión de entrenamiento
  Scripts/Vision/           Patrón, detector, pose y orientación de cámara
  Scripts/Visualization/    Geometría 3D, selección y animación
  Scripts/AR/               Cámara y cambio entre 3D y seguimiento visual
  Scripts/App/              Coordinación e interfaz
  Editor/                   Configuración Android y compilación
Docs/Markers/               PNG, SVG y hoja A4 imprimible
Docs/VALIDACION-ANDROID.md  Recorrido de pruebas físicas pendientes
Tests/                      Comprobaciones del modelo y de visión
scripts/                    Compilación, verificaciones y generación del patrón
```

El MVP representa una red densa para XOR; CNN, segmentación y Transformers son futuras ampliaciones. El historial vive en memoria y se reinicia al cerrar. El error mostrado corresponde a los cuatro ejemplos de entrenamiento y no mide generalización. La animación de señal ilustra el orden de cálculo.

Referencias de las APIs utilizadas: [WebCamTexture de Unity](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/WebCamTexture.html), [permisos Android en Unity](https://docs.unity3d.com/6000.0/Documentation/Manual/android-permissions-in-unity.html).

