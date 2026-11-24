# Fleet Autopilot: plan

Objetivo: que la flota **decida qué mejorar, lo haga sola de noche y aprenda de sus errores**, con intervención humana mínima (unos 10 minutos por día) y el rumbo del producto en manos del usuario.

## Decisiones tomadas (24-11-2026)

| Tema | Decisión |
|---|---|
| Se integran solos | Bugs con test, tests nuevos, refactors y limpieza, rendimiento y accesibilidad |
| Siempre requieren aprobación | Features nuevas, cambios en el propio sistema (reglas/skills) y zonas sensibles definidas en PRODUCT.md (ej. `auth/`, `payments/`, migraciones) |
| Fuentes de propuestas | PRODUCT.md + código, issues de GitHub, errores de la app (archivo/servicio configurable), feedback de usuarios (archivo/carpeta configurable) |
| Horario autónomo | De noche, en una ventana configurable (por defecto 01:00–07:00) |
| Especialistas | Usar los agentes del usuario (`~/.claude/agents`: backend-developer, frontend-developer, qa-engineer, security-reviewer, product-manager, etc.) según el área de la tarea |

## Flujo
```
BRÚJULA (PRODUCT.md) ─► PROPUESTAS ─► aprobación según política ─► FLOTA ─► integración ─► control de salud
                         ▲                                                    │                 ├ ok → informe matutino
                         └──────── APRENDIZAJE (error → test / lint / instrucciones) ◄────────┘ └ falla → revert automático
```

## Fases (orden: 1 → 3 → 2 → 4, la 5 en cualquier momento)

### Fase 1: Brújula y propuestas ✅ (24-11-2026)
Implementada: `src/propose.mjs`, `src/signals.mjs`, `prompts/product-manager.md`, plantilla `templates/PRODUCT.md`, columna Propuestas en Studio, comandos `propose`, `accept` y `decline`. Probada con Claude real en la demo: 3 propuestas pertinentes, basadas en el log de errores y el feedback, y marcó como riesgo alto la zona sensible.
- Plantilla `PRODUCT.md`: visión, usuarios, prioridades, no-objetivos, zonas sensibles, definición de riesgo.
- Agente de producto (rol nuevo, o el `product-manager` del usuario): lee PRODUCT.md, código, merges recientes, fallos, notas del auditor y señales → propone tareas con `category`, `risk`, justificación y criterios de aceptación.
- Señales: `signals.github` (gh issues), `signals.errorsPath`, `signals.feedbackPath`.
- Estado nuevo `proposed` + columna "Propuestas" en Studio: aprobar/descartar (individual o en lote). Los descartes, con motivo, se guardan como lección.
- Topes: `maxProposalsPerDay`. Deduplicación contra tareas existentes.
- Listo cuando: las propuestas son pertinentes y la tasa de descarte baja.

### Fase 3: Autonomía por niveles ✅ (24-11-2026)
Implementada: `src/policy.mjs` (decisión por modo, categoría, riesgo y zonas sensibles), `src/autopilot.mjs` (ventana horaria, inicio y cierre de la noche), control de salud con revert automático en `src/merge.mjs`, informe con sección 🌙, configuración en Studio y `fleet autopilot` para usarlo sin interfaz. Probada con una noche simulada de punta a punta.
- `policy.autoMerge`: categorías que se integran solas; `policy.sensitivePaths`: rutas que siempre requieren aprobación.
- Decisión por tarea al quedar lista: categoría × rutas tocadas → integrar o esperar.
- `schedule.window` (ej. `01:00-07:00`): el scheduler solo lanza agentes dentro de la ventana; el agente de producto corre al inicio.
- Control de salud post-merge: `checkCommand` en la rama base; si falla → `git revert` automático + tarea `needs_human`.
- Informe matutino ampliado: propuesto, hecho, aprendido, pendiente de decisión.
- Listo cuando: una noche completa sin intervención deja trabajo útil y nada roto.

### Fase 2: Aprendizaje
- Agente de aprendizaje: se dispara ante rechazo de QA/revisor, fallo, pedido de cambios o descarte de propuesta.
- Escribe en `brain/lessons/<tema>.md` (índice en `brain/README.md`); Tech Lead y Developer lo leen antes de trabajar.
- Si la lección es automatizable → tarea categoría `sistema` (test/regla de lint/ajuste de skill), siempre con aprobación al principio.
- Métricas en Studio: rechazos por tipo y por semana.
- Listo cuando: los errores no se repiten y la tasa de rechazo baja.

### Fase 4: Explorador de bugs
- Levanta la app (según `fleet-verify`), recorre flujos (según `fleet-feature-map`) con Playwright y reporta bugs reproducibles con evidencia → propuestas categoría `bug`.
- Política "test primero": en bugs, el Developer escribe el test que falla antes del arreglo.

### Fase 5: Especialistas
- Mapa `specialists`: área/rutas → agente del usuario (contenido del `.md` como instrucciones del rol, respetando su modelo y herramientas).
- `security-reviewer` se suma al review cuando se tocan zonas sensibles; `product-manager` como agente de producto.

## Límites de seguridad
- Topes de propuestas/día y ejecuciones/noche (cuota del plan, sin API).
- Features nunca se integran solas.
- Cambios a reglas/skills del sistema: con aprobación hasta que el usuario decida lo contrario.
- Kill switch (Pausar) y todo reversible vía git.
- Identidad de commits fija por proyecto (`gitAuthor`).
