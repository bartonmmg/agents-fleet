# Mejoras de Fleet Studio (lista para trabajo autónomo)

Objetivo: que Studio se sienta profesional y que cada sección aporte valor. Ordenadas por valor. Cada una es un cambio chico, con su commit propio.

Reglas para todas: ver `PRODUCT.md` (sin dependencias, español, light/dark, celular, no tocar seguridad). Antes de cerrar cada una: `npm test` y `npm run capture -- --name <slug>`; mirá las capturas y corregí lo que se vea mal.

## 1. Pantalla "Mientras dormías"
Al abrir Studio, si hubo actividad desde la última visita (o una noche de Autopilot en las últimas 24 h), mostrar arriba del tablero un panel resumen: integradas solas, esperan tu OK, revertidas, propuestas nuevas, y el uso del plan. Con botones para ir a cada grupo y para cerrarlo.
- Criterios: se ve con los datos de la demo de `scripts/capture.mjs`; se puede cerrar y no vuelve hasta la próxima actividad (guardar la última visita en `localStorage`, con try/catch); en celular se apila bien.

## 2. Cabecera de métricas
Tarjetas compactas: tareas integradas hoy y en 7 días, tasa de aprobación al primer intento, integradas solas vs. aprobadas a mano, ejecuciones del plan hoy (con barra contra el tope). Una mini gráfica SVG de integraciones por día (7 días).
- Criterios: los números salen de datos reales del estado (`/api/state` o un endpoint nuevo `GET /api/metrics` con su test); sin dependencias; números redondeados.

## 3. Informe como página propia
Reemplazar el diálogo de informe por una vista completa (ruta `#/informe` o pestaña), con la sección de Autopilot, gráficos simples y el botón de auditoría. Con navegación clara para volver al tablero.
- Criterios: el markdown actual sigue disponible; la vista se ve bien en celular.

## 4. Detalle de tarea con pestañas
En el panel de detalle: pestañas **Resumen / Actividad / Cambios / Plan**. El visor de cambios con lista de archivos (+/− por archivo) y saltos al archivo.
- Criterios: el estado de la pestaña se mantiene al actualizarse la tarea en vivo; accesible con teclado (roles `tablist`/`tab`).

## 5. Sistema visual consistente
Revisar escala tipográfica, espaciados, radios, colores de estado y focos; un logo simple en SVG; íconos alineados. Documentar los tokens al inicio de `styles.css`.
- Criterios: contraste AA en claro y oscuro; nada de colores sueltos fuera de los tokens.

## 6. Guía de primer uso
Checklist visible hasta completarse: brújula (`PRODUCT.md`) escrita, comando de verificación, identidad de commits, primera tarea, primera integración. Cada ítem con su acción directa.
- Criterios: los ítems se marcan solos según el estado real del proyecto.

## 7. Configuración por secciones
El diálogo de configuración, hoy largo, organizado en secciones (General, Agentes y modelos, Product Manager y señales, Autopilot, Identidad) con navegación lateral o pestañas.
- Criterios: guarda igual que ahora (mismo `POST /api/config`); funciona en celular.

## 8. Búsqueda y filtros en el tablero
Buscar por texto y filtrar por tipo, riesgo y área. Atajo `/` para buscar.
- Criterios: filtros combinables; se ven y se limpian fácil.

## 9. Atajos de teclado
`n` nueva tarea, `p` proponer mejoras, `?` ayuda con la lista de atajos, `Esc` cerrar.
- Criterios: no se disparan mientras se escribe en un campo.

## 10. Accesibilidad y celular
Repaso general: foco visible, `aria-*` en diálogos y columnas, navegación por teclado del tablero, tamaños táctiles en celular.

## 11. Sala de control "Flota en vivo"
Vista con una fila por agente activo: rol, tarea, qué está haciendo ahora (última actividad, por ejemplo "Developer · editando cart.mjs") y tiempo transcurrido. Se actualiza en vivo con los eventos `activity` que ya emite el servidor.
- Criterios: muestra todos los agentes en curso a la vez; vacío útil cuando no hay ninguno; legible en celular.

## 12. Línea de tiempo de la noche
Gráfico tipo Gantt en SVG: una barra por tarea a lo largo de las horas, cada tramo coloreado por etapa (plan, implementación, tests, QA, revisión) a partir de `task.steps`, con marcas de integración y de revert.
- Criterios: rango de las últimas 24 h por defecto; leyenda de colores; tooltip o detalle al tocar un tramo; sin dependencias.

## 13. Antes y después en cambios visuales
En el detalle de tareas que tocan la interfaz, mostrar la captura de antes y la de después lado a lado o con un deslizador de comparación (las capturas del QA quedan en la evidencia de la tarea).
- Criterios: si no hay captura de "antes", se muestra solo la de después sin romper nada; funciona con teclado.

## 14. Modo revisión rápida
Pantalla que presenta de a una las tareas que esperan decisión (listas para aprobar y propuestas): resumen, evidencia, archivos tocados y veredictos. Atajos: `A` aprobar, `C` pedir cambios, `D` descartar, `→` siguiente, `Esc` salir.
- Criterios: usa los mismos endpoints que el detalle; muestra el progreso ("3 de 7"); termina con un resumen de lo decidido.

## 15. Avisos y contador en la pestaña
El título muestra lo pendiente ("(3) Fleet Studio") y el ícono de la pestaña cambia cuando algo necesita atención. Opcional: notificación del sistema (Notification API, pidiendo permiso) cuando una tarea espera tu OK, falla o se revierte.
- Criterios: el permiso se pide solo al activar la opción en Configuración; sin avisos repetidos por la misma tarea.
