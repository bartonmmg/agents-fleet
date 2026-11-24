# Flota de agentes al estilo Lauren Tan (@poteto) — investigación + plan para Claude Code

> Documento pensado para pegarse tal cual en Claude / Claude Code como contexto de partida.
> Fecha de la investigación: noviembre 2026.

---

## ETAPA 1 — Quién es Lauren Tan y cómo trabaja

### Perfil
- Ingeniera en el equipo de **GrokBot** en SpaceX AI / xAI (las fuentes lo escriben SpaceXAI, SpaceXSI, "SpaceX Super Intelligence").
- Antes: **Cursor**, equipo de **React Compiler en Meta**, y tech lead / engineering manager en **Netflix**.
- En X/GitHub es **@poteto**. Es autora de **Noodle** (`github.com/poteto/noodle`), un orquestador open source de agentes basado en *skills*.
- Charlas clave:
  - *"All Code Is Slop (Except Mine)"* — AI Engineer Code Summit, 17 min ([video](https://www.youtube.com/watch?v=O_zcc6Xl12g)).
  - *"How I Shipped 2000 PRs Last Month — Trusting AI Agents"* (~38 min).
  - Entrevistas largas (Toby's Guide, ago-2026: "How I Merged 1000 PRs in a Month with Agents").
  - El link que pasaste ([PaPpyQocMww](https://www.youtube.com/watch?v=PaPpyQocMww)) es "SpaceX AI Engineer Lauren Tan: Part 1"; YouTube no expuso transcripción ni descripción, y el tweet de @Fluyeporlaweb no se pudo leer (X bloquea el acceso automático). La info sale de las otras charlas y transcripciones.

### Los números (y su letra chica)
| Dato | Fuente |
|---|---|
| ~1.000 PRs/mes personales (con 20+ agentes en paralelo) | Toby's Guide, ago-2026 |
| ~2.000–2.500 PRs/mes | charla de 38 min / sozai |
| ~3.000 PRs/mes personales, **11.000 PRs/mes el equipo** | "All Code Is Slop", BigGo |
| Tasa de reverts ≈ **0,5 %** | "All Code Is Slop", BigGo |

Las cifras corresponden a meses distintos (crecieron con el tiempo) e incluyen mucho trabajo de mantenimiento. Lo que conviene copiar es el **sistema**, no la cifra.

### Idea central: confianza que se gana con verificación
> "Si tu loop interno produce basura, automatizarlo solo produce más basura." (paráfrasis de T1)

No empezó lanzando 100 agentes. Subió por una **escalera de confianza**: 1 agente supervisado → 5 → decenas → cientos (en la nube), y solo agregó agentes cuando el sistema ya podía demostrar que el trabajo era correcto. Advierte que lanzar 100 agentes sin esa confianza solo produce PRs basura.

### Los 6 pilares de su proceso

#### 1. La verificación es la habilidad n.º 1
- Cada agente tiene que **poder ejecutar el producto y demostrar** que su cambio funciona. Ella dice que esto no garantiza código *bueno*, pero sí código *correcto*.
- Herramientas: **Chrome DevTools Protocol** (web/Electron), **Playwright**, utilidades del simulador de iOS, CPU traces, heap snapshots, screenshots, videos.
- **"Control Glass"**: su primera *skill* de verificación (de la época de Cursor). Es un CLI guardado *dentro* de la carpeta de la skill, así todos los agentes reutilizan el mismo "driver" y no lo reescriben cada vez.
- **Feature map**: una skill que mapea *cada* funcionalidad visible → ruta en la UI, atajos y selectores DOM/CDP. Sirve para que un reporte vago ("screenshot + ???") se convierta en un bug reproducible. Una automatización la mantiene al día.
- La revisión humana pasó de leer diffs a mirar **pruebas**: videos, screenshots, diagramas, salidas formales.
- Experimental: TLA+ y Lean para flujos críticos, property-based testing de UI (Bombadil).
- **La mayor parte de sus tokens se va en verificar**, no en escribir código. (El famoso "70 %" es de otra ingeniera del equipo, pero ella dice lo mismo en sustancia.)

#### 2. El código hace de revisor ("codebase as reviewer")
> Cada vez que corrigen a un agente, esa corrección se convierte en un **chequeo determinístico**, no en otra línea del archivo de reglas.

Jerarquía de defensas, de más fuerte a más débil:
1. **Arquitectura/API** que vuelve imposible el mal patrón.
2. **Análisis estático, CI, chequeos del grafo de imports/dependencias.**
3. **Lint y diagnósticos del compilador**, con mensajes que explican la causa raíz y cómo arreglarlo.
4. **Reglas, skills, AGENTS.md, bots de review**: lo más blando; no alcanza solo.

Ejemplos reales: `useEffect` prohibido en código de producto, timers imperativos prohibidos por lint, ~99 % de los comentarios prohibidos (se vuelven viejos y engañan), main/renderer de Electron separados con imports cruzados bloqueados, features co-ubicadas en un directorio cada una (framework interno "Dune", tipo "Next.js para Electron").

Por qué: **los agentes copian el patrón existente**. Un atajo malo se propaga por todo el código "en días o semanas". Las migraciones mecánicas van a **codemods/scripts**, y los agentes se quedan solo con lo que requiere criterio.

#### 3. Cada modo de falla → una skill (PStack)
- **PStack** ("Potato Stack", guiño al GStack de Garry Tan): su colección de skills. Cada vez que ve una falla repetida (por ejemplo, el agente afirma una causa sin leer el código) escribe una skill para eso.
- **Evals como tests unitarios de las skills**: un coordinador escribe una rúbrica; subagentes ejecutan la tarea en directorios con nombres que no delatan que es una prueba ("los agentes se dan cuenta y cambian su comportamiento"); un modelo **distinto** juzga; se itera en loop hasta 10/10; se corre contra varios modelos.
- Mantiene las skills leyendo cada tool call y cada bloque de razonamiento de los agentes ("backseat driving").
- Las skills deben **achicarse** a medida que los modelos mejoran: describir el *proceso*, no la implementación.

#### 4. Orquestación: loop externo + loop interno
- **Loop externo** (GrokBot): rutinas que vigilan Slack, Linear, reportes de bugs, etc.
- **Coordinador**: recibe un lote (por ejemplo ~30 issues), elige una topología y agrupa los reportes relacionados para no duplicar trabajo.
- **Workers**: subagentes que implementan, cada uno en un área acotada (una feature = un directorio).
- **Verificadores**: varios por PR (hasta ~10, reducibles a 1).
- **Agente reproductor de bugs** ("Benny"): toma cada bug report, levanta su propio escritorio en la nube y lo reproduce.
- **"Jardinero"**: agente que detecta anti-patrones recurrentes y los anota en un documento que ella revisa cada pocos días, y de ahí salen nuevas reglas de lint o skills.
- **Fuzzing por release**: cada release lanza un proyecto que explora la app, encuentra bugs y abre **un PR de fix por bug**, con auto-merge.
- PRs **chicos y atómicos**.

#### 5. Ritmo diario: los agentes trabajan de noche
- Los agentes corren 24/7 y hacen **auto-merge** cuando pasan todas las verificaciones.
- A la mañana ella revisa lo que aterrizó en `main` ("me desperté y había ~20 PRs mergeados"). **Muestrea** PRs en vez de leerlos todos, y revierte o agrega reglas de lint según lo que encuentra.
- Reconoce que la primera noche fue estresante.

#### 6. Memoria: el código y las skills son la memoria
- El código mismo es memoria (los agentes extienden patrones existentes).
- Feature maps y skills son "memoria materializada".
- Skill de **recall** que busca en chats pasados las correcciones que ya hizo.
- En Noodle, un **"brain/"** tipo Obsidian: una nota por tema, `principles.md`, `plans/`, `todos.md`.

### Noodle, su orquestador open source (referencia técnica)
- CLI en Go, MIT. Metáfora de "brigada de cocina": el **chef** (scheduler) lee el backlog, escribe **órdenes** y despacha **cocineros** (agentes) a **git worktrees aislados**.
- Pipeline: `todos.md` → `.noodle/mise.json` (backlog, tipos de tarea, agentes activos, historial, capacidad) → la skill `schedule` (un LLM) escribe `orders-next.json` → se promueve a `orders.json` → se despacha.
- Cada orden tiene **stages** (por ejemplo `debate → execute → quality → reflect`). Los stages del mismo `group` corren en paralelo.
- Proveedores: **claude** y **codex**. Regla clave: **el review lo hace el proveedor opuesto al que escribió** (review cruzado entre modelos).
- `adversarial-review`: 1 a 3 revisores según el tamaño del diff (**Escéptico, Arquitecto, Minimalista**) que dan un veredicto sin tocar código.
- Worktrees en `.worktrees/<nombre>` y **merges serializados con lockfile** (`.worktrees/.merge-lock`).
- Modos: `auto | supervised | manual`.
- Skills incluidas: plan, execute, quality, reflect, adversarial-review, worktree, debugging, testing, commit, review, unslop, oops, meditate, ruminate, brain, todo, skill-creator, y otras de buenas prácticas (React/TS/Go).
- Su CLAUDE.md: leer brain antes de actuar, escribir una nota después de cada error, usar siempre las skills de worktree y commit porque hay sesiones concurrentes, y no agregar shims de compatibilidad.

---

## ETAPA 2 — Plan para replicarlo con Claude Code

### Equivalencias: su stack → Claude Code
| Lauren / Noodle | En Claude Code |
|---|---|
| Skills / PStack | `.claude/skills/<nombre>/SKILL.md` (con scripts/CLIs dentro de la carpeta) |
| AGENTS.md / reglas | `CLAUDE.md` (corto; lo duro va a lint/CI) |
| Roles (coordinador, worker, verificador, jardinero) | Subagentes en `.claude/agents/*.md` con herramientas y modelo propios |
| Worktrees aislados | `git worktree` / `claude --worktree` / `isolation: "worktree"` en subagentes |
| Loop externo / scheduler | **Claude Agent SDK** (TypeScript o Python) + `claude -p` headless, rutinas programadas, `/loop` |
| Verificación de UI (CDP) | MCP de **Playwright** o **Chrome DevTools** |
| Integración Slack/Linear/GitHub | Servidores MCP + GitHub Actions (`claude-code-action`) |
| "Codebase as reviewer" | **Hooks** (PostToolUse → lint/typecheck; Stop → exigir verificación) + CI |
| Review cruzado entre modelos | Verificador con otro modelo (por ejemplo Opus escribe y Sonnet revisa, o un proveedor externo) |
| Brain / memoria | Carpeta `brain/` en el repo + memoria de Claude Code |

### Fases (respetando la escalera de confianza)

**Fase 0 — Cimientos de verificación (no saltear)**
- [ ] Comandos únicos y rápidos: `check` = lint + typecheck + tests + build.
- [ ] Skill `verify` con un CLI propio dentro de la carpeta (levanta la app, navega con Playwright, saca screenshot/video y devuelve PASS/FAIL con evidencia).
- [ ] Skill `feature-map`: inventario de features → ruta, selectores y cómo probarlas.
- [ ] Definition of Done: ningún agente dice "listo" sin adjuntar **evidencia** (salida de tests y screenshots).

**Fase 1 — Un agente, supervisado**
- [ ] Trabajar con 1 agente en modo supervisado y **leer sus tool calls**.
- [ ] Cada corrección que hagas → anotarla en `brain/corrections.md`.
- [ ] Medir: % de tareas que pasan verificación sin ayuda.

**Fase 2 — El código como revisor**
- [ ] Por cada corrección repetida: ¿se puede hacer imposible por arquitectura? Si no, ¿con regla de lint o CI? Recién si no se puede, va a una skill o a CLAUDE.md.
- [ ] Mensajes de lint que expliquen el *por qué* y el *cómo arreglarlo* (el agente los lee).
- [ ] Hooks: PostToolUse(Edit|Write) → lint del archivo; Stop → bloquear si no se corrió `check`.
- [ ] Estructura por features (un directorio por feature) y bloqueo de imports cruzados.

**Fase 3 — Paralelismo (3 a 5 agentes)**
- [ ] Cada worker en su propio **git worktree + rama**.
- [ ] Tareas chicas, atómicas, de un solo dominio (un PR = un cambio).
- [ ] **Cola de merge serializada** (lock o merge queue de GitHub) con rebase y re-verificación antes de mergear.
- [ ] Coordinador que agrupa tareas relacionadas y evita que dos agentes toquen los mismos archivos.

**Fase 4 — Verificadores y review adversarial**
- [ ] Subagente `verifier` con contexto limpio, que **no escribió el código**, de otro modelo si es posible.
- [ ] Review adversarial con 1 a 3 lentes según el tamaño del diff (Escéptico / Arquitecto / Minimalista).
- [ ] Auto-merge solo si pasan CI, verificación con evidencia y review. Si no, vuelve al worker con el feedback.

**Fase 5 — Autonomía nocturna (20+ agentes)**
- [ ] Ingesta automática del backlog (GitHub Issues / Linear / `todos.md`).
- [ ] Scheduler que arma órdenes respetando un límite de capacidad (máximo de agentes y de presupuesto de tokens).
- [ ] Agente reproductor de bugs: reproduce antes de arreglar y escribe primero el test que falla.
- [ ] Fuzzing por release que abre un PR por bug.
- [ ] **Informe matutino**: qué se mergeó, evidencia, reverts, costo. Vos muestreás PRs y revertís si hace falta.

**Fase 6 — Mejora continua**
- [ ] Agente **jardinero** semanal: busca anti-patrones que se repiten y propone reglas de lint, codemods o skills.
- [ ] **Evals de skills**: rúbrica, ejecución "a ciegas", juez de otro modelo y loop hasta aprobar.
- [ ] Skill `recall`/`reflect`: después de cada error, nota en `brain/`.
- [ ] Achicar skills cuando el modelo mejora.

### Arquitectura de la app de agentes ("Fleet")
```
┌───────────────── Dashboard web (estado, logs, evidencias, costo) ─────────────────┐
│                                                                                    │
│  Ingesta ──► Backlog (SQLite/JSON) ──► Scheduler (LLM) ──► Órdenes                 │
│  (Issues,                              decide topología,     │                      │
│   Linear,                              agrupa, prioriza,     ▼                      │
│   todos.md)                            respeta capacidad   Dispatcher               │
│                                                           (Agent SDK, N workers)   │
│                                                              │                      │
│              ┌───────────────────────────────────────────────┤                      │
│              ▼                ▼                ▼             ▼                      │
│         Worker 1 (wt-1)  Worker 2 (wt-2)  Bug-repro      Fuzzer                     │
│              │                                                                      │
│              ▼  stages: plan → execute → verify → adversarial-review → reflect      │
│         Evidencia (tests, screenshots, video)                                       │
│              ▼                                                                      │
│         Merge queue (lock, rebase, re-check) ──► main ──► Informe matutino          │
│                                                                                    │
│  Jardinero (cron) ──► brain/anti-patterns.md ──► nuevas reglas de lint/skills      │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Componentes mínimos:
1. **Store de tareas** con estados: `backlog → planned → in_progress → verifying → reviewing → ready_to_merge → merged | failed | reverted`.
2. **Scheduler**: una llamada a Claude que lee el estado (como `mise.json`) y devuelve órdenes en JSON validado por un schema.
3. **Dispatcher** basado en **Claude Agent SDK**: cada orden crea un worktree y lanza una sesión con la skill del stage como instrucción, con timeout, presupuesto y logs en streaming.
4. **Verificador** independiente, que devuelve un veredicto estructurado y adjunta evidencia.
5. **Merge queue** serializada.
6. **Dashboard**: agentes activos, en qué etapa están, evidencias, reverts, tokens y costo por tarea.
7. **Kill switch y límites**: máximo de agentes concurrentes, tope de gasto diario y modo `supervised` por defecto.

### Riesgos y recaudos
- **Costo**: 20+ agentes con verificación pesada consumen muchísimos tokens. Poné presupuestos por tarea y por día desde el día 1.
- **Slop amplificado**: no escales sin verificación. Si la tasa de reverts sube, bajá el paralelismo.
- **Conflictos de merge**: mantené tareas chicas, separadas por dominio, y la cola serializada.
- **Seguridad**: los agentes autónomos no deben tener secretos de producción. Usá permisos mínimos, sandbox y nada de deploy sin gate.
- **Windows**: los worktrees y hooks funcionan, pero conviene que los scripts sean Node/TS o PowerShell (no bash 4+).
- Sus cifras vienen de un equipo con infraestructura propia (Cursor cloud agents, GrokBot). Arrancá con metas modestas: 5 agentes y una tasa de reverts menor al 2 %.

---

## PROMPT LISTO PARA PEGAR EN CLAUDE CODE

```
Quiero construir "Fleet", una app para orquestar una flota de agentes de código con Claude,
inspirada en el método de Lauren Tan (@poteto) descripto en el documento adjunto.

Principios no negociables:
1. Verificación primero: ningún agente marca una tarea como lista sin evidencia (tests, screenshots/video vía Playwright).
2. El código como revisor: cada corrección recurrente se convierte en lint/CI/arquitectura antes que en una regla de texto.
3. Escalera de confianza: modo "supervised" por defecto, con límite configurable de agentes concurrentes.
4. Aislamiento: cada worker trabaja en su propio git worktree y rama; los merges pasan por una cola serializada.
5. Review independiente: el verificador no es el mismo agente que escribió el código.

Stack sugerido: TypeScript + Claude Agent SDK, SQLite para el estado, dashboard web simple (Next.js o Vite+React),
Playwright para verificación. Debe funcionar en Windows.

Entregables por fases (no avances de fase sin que la anterior pase sus checks):
- Fase 0: estructura del repo, CLAUDE.md breve, skills base (.claude/skills: plan, execute, verify, adversarial-review, reflect, worktree),
  subagentes (.claude/agents: coordinator, worker, verifier, gardener), hooks (lint post-edit, verificación en Stop).
- Fase 1: store de tareas + máquina de estados + CLI (`fleet add`, `fleet status`, `fleet run --once`).
- Fase 2: dispatcher con Agent SDK que corre 1 worker en un worktree con stages plan→execute→verify.
- Fase 3: N workers en paralelo + merge queue con lock + re-verificación tras rebase.
- Fase 4: scheduler LLM (estado → órdenes JSON con schema), review adversarial 1-3 lentes, auto-merge condicionado.
- Fase 5: dashboard (agentes activos, etapa, evidencias, costo), informe matutino, presupuestos y kill switch.
- Fase 6: agente jardinero programado + evals de skills.

Empezá proponiendo el plan detallado de la Fase 0 y la estructura de carpetas, y esperá mi OK antes de implementar.
```

---

## Fuentes
- [All Code Is Slop (Except Mine) — video, AI Engineer](https://www.youtube.com/watch?v=O_zcc6Xl12g) · [página de la charla](https://ai.engineer/code/2026/talks/lauren-tan)
- [Transcript "All Code Is Slop" (usetranscribe)](https://www.usetranscribe.io/yt/O_zcc6Xl12g/code-quality-improvement)
- [Transcript "How I Shipped 2000 PRs Last Month" (usetranscribe)](https://www.usetranscribe.io/yt/NjoZoUm85x0/ai-agents-code-quality)
- [BigGo: 11.000 PRs/mes, 0,5 % revertidos](https://finance.biggo.com/news/5a6129233f489c0e)
- [Toby's Guide: How I Merged 1000 PRs in a Month with Agents](https://tobysguide.com/episodes/2026-08-24-lauren-tan-1000-prs-with-agents/)
- [sozai.app: 30+ AI Agents Ship PRs While You Sleep](https://sozai.app/transcript/lauren-tan-30-ai-agents-ship-prs/)
- [AI Intel Desk (Substack)](https://aiinteldesk.substack.com/p/worth-watching-all-code-is-slop-except)
- [bit.fan: GrokBot end-to-end PR flow](https://www.bit.fan/en/news/list/lauren-tan-grokbot-spacexai-ai-pr-workflow-4a995d9c-en-keyName-32726450)
- [Repo poteto/noodle](https://github.com/poteto/noodle) · [skills.sh/poteto/noodle](https://skills.sh/poteto/noodle)
- [Video del usuario (Part 1)](https://www.youtube.com/watch?v=PaPpyQocMww): sin transcripción accesible · [tweet @Fluyeporlaweb](https://x.com/Fluyeporlaweb/status/2123857157271543986): no accesible
