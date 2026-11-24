# Brújula del producto: Fleet

## Qué es
Fleet orquesta una flota de agentes de Claude Code (Tech Lead, Developer, QA Verifier, Code Reviewer, Product Manager) que trabajan en paralelo sobre un proyecto, se verifican entre ellos e integran con control. **Fleet Studio** es su interfaz web local: se abre con doble clic y reemplaza a la terminal.

## Para quién
Una persona que dirige el desarrollo de sus apps con agentes, no necesariamente experta en la terminal. Abre Studio a la mañana para ver qué hicieron los agentes, aprueba lo importante y carga nuevas tareas. Tiene que sentirse como una **herramienta profesional**, clara y confiable.

## Prioridades actuales (en orden)
1. **Que Studio se sienta profesional**: consistencia visual, jerarquía clara, estados vacíos útiles, buen modo oscuro y celular.
2. **Que muestre valor de un vistazo**: qué pasó (sobre todo de noche), qué espera una decisión y cómo viene la flota (métricas).
3. **Que las decisiones sean rápidas**: aprobar, pedir cambios o descartar, con la evidencia a mano.
4. **Que cualquiera pueda empezar sin ayuda**: guía de primer uso.

## Qué NO hacer (no-objetivos)
- No agregar dependencias (ni npm ni CDN): la UI es HTML/CSS/JS vanilla en `src/studio/public/`; los gráficos se dibujan con SVG a mano.
- No cambiar el motor (`src/*.mjs` fuera de `src/studio/`) salvo lo mínimo para exponer datos nuevos a la UI, siempre con test.
- No relajar la seguridad de Studio: solo `127.0.0.1`, verificación de Host y token en todo POST.
- No cambiar textos al inglés: todo en español rioplatense, con el tono de la UI actual.

## Zonas sensibles
- `src/studio/server.mjs` (seguridad), `src/merge.mjs`, `src/policy.mjs`, `src/runner.mjs`.

## Definición de "terminado"
- `npm test` pasa (y los cambios de comportamiento tienen su test).
- Capturas con `npm run capture -- --name <tarea>` en escritorio y celular, claro y oscuro, sin nada roto ni cortado.
- Funciona sin conexión a internet.
