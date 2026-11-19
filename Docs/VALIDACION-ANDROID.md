# Validación de NeuroAR con marcador impreso

**Estado: pendiente de ejecutar en Unity y en un Android físico.** No existe una APK compilada en este entorno. Equipo previsto: **Xiaomi Redmi Note 12S**; confirmar la versión de Android al instalar.

La aplicación utiliza la cámara para seguir su patrón impreso y no depende de ARCore. La compatibilidad y el rendimiento del Redmi deben comprobarse físicamente. Los resultados de las pruebas sintéticas están documentados en el README.

## Preparación y compilación

- Instalar Unity 6000.0.62f1 y Android Build Support con SDK, NDK y OpenJDK.
- Confirmar que no hay errores C# en Console al abrir el proyecto.
- Ejecutar **NeuroAR → Preparar proyecto Android** si se abrió una versión anterior.
- Abrir la escena y comprobar el modo 3D en Game View vertical.
- Generar una APK nueva y revisar su registro; instalarla en el Redmi.
- Imprimir `Docs/Markers/imprimir-marcador.html` en A4 al 100 %. Medir **14 cm entre los bordes negros exteriores**, sin contar el margen blanco. Comprobar la referencia de 5 cm de la hoja.

## Recorrido educativo

1. En 3D, girar arrastrando el fondo y hacer zoom con dos dedos.
2. Seleccionar las siete neuronas; verificar capa, suma y activación.
3. Seleccionar conexiones de ambos tramos y editar pesos. Confirmar cambios en grosor, contribución y salida.
4. Probar los cuatro ejemplos XOR antes y después del entrenamiento. Con la semilla original y 3000 épocas, esperar salidas cercanas a 0, 1, 1 y 0.
5. Pausar y retroceder en el historial: la época, parámetros y salida deben volver al estado seleccionado.
6. Avanzar sin editar: reproducir los siguientes estados guardados.
7. Retroceder, editar un parámetro y avanzar: descartar el futuro anterior y continuar desde el estado editado.
8. Reiniciar: volver a época cero y a las salidas iniciales.
9. Confirmar que botones y controles no seleccionan objetos 3D ni giran la cámara.

## Cámara y seguimiento visual

1. Pulsar **Ver marcador** y conceder permiso. Debe mostrarse la cámara trasera, vertical, sin reflejo accidental.
2. Probar permiso denegado y denegado permanentemente: regresar al modo 3D con una explicación.
3. Colocar el marcador sobre una mesa plana con buena luz. Enfocar el patrón completo, cerca del centro y con margen blanco. Ajustar distancia inicialmente entre 35 y 80 cm.
4. Confirmar que la red aparece sobre el patrón y que el fondo se alinea con la imagen que analiza el detector.
5. Mover el celular lentamente hacia los lados, acercarse y cambiar el ángulo manteniendo visible la imagen. Anotar desplazamiento, vibración y errores de escala; la lente aún usa parámetros aproximados.
6. Girar la hoja 90°, 180° y 270°: la orientación de la red debe seguir el mismo patrón.
7. Tapar parte de la hoja o retirarla: ocultar la red y solicitar enfocar de nuevo. No debe fingir conservar un anclaje espacial.
8. Volver a mostrar el patrón: recuperar la red después de confirmar el seguimiento.
9. Seleccionar neuronas y conexiones con el marcador visible; comprobar que los colliders siguen su pose.
10. Pulsar **Reescanear**; confirmar que no quedan redes duplicadas ni una pose anterior visible.
11. Cambiar entre cámara y 3D varias veces: una sola cámara y un solo AudioListener activos, captura detenida al volver a 3D.
12. Bloquear y desbloquear Android o cambiar de aplicación: detener captura mientras se suspende y buscar de nuevo al volver, conservando el permiso.
13. Probar poca luz, reflejos, desenfoque y movimiento rápido. Documentar los límites; no esperar seguimiento con el patrón oculto.
14. Verificar notch, área segura y encuadre en pantallas 16:9 y 20:9. El modelo debe poder situarse en la zona visible entre los paneles.
15. Medir frecuencia visual, uso de CPU y calentamiento durante cinco minutos; reducir la frecuencia de detección o resolución si hace falta.

## Registro pendiente

| Equipo / Android | Compilación | Modo 3D | Permisos / orientación de cámara | Marcador / recuperación | Alineación / rendimiento |
|---|---|---|---|---|---|
| Redmi Note 12S / por confirmar | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |
