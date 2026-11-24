# Fleet — flota de agentes Claude Code

Orquestador para trabajar con muchos agentes de Claude Code en paralelo, siguiendo el método de **Lauren Tan (@poteto)**, explicado en [docs/lauren-tan-flota-de-agentes.md](docs/lauren-tan-flota-de-agentes.md):

- **Verificación primero.** Ninguna tarea se integra sin pasar el check del proyecto, un QA independiente y un code review adversarial.
- **Aislamiento.** Cada Developer trabaja en su propio `git worktree` y su propia rama.
- **Cola de merge serializada.** Antes de integrar se hace rebase sobre la base, se vuelve a correr el check y se hace fast-forward. Si hay conflicto, la tarea vuelve a la cola.
- **Escalera de confianza.** El modo `supervised` es el predeterminado: vos mergeás. El modo `auto` es para dejarlo corriendo de noche.
- **Solo tu plan de Claude.** No usa API ni genera costos extra (ver más abajo).
- **Mejora continua.** Los Code Reviewers sugieren prevenciones y el Auditor de calidad detecta malas prácticas que se repiten.

No tiene dependencias: solo Node ≥ 20, git y la CLI `claude` con tu sesión iniciada.

## Fleet Studio: la interfaz visual (recomendado)

**Doble clic en `Fleet Studio.cmd`**: se abre en tu navegador (http://127.0.0.1:4400). No hace falta usar la terminal; dejá abierta la ventana negra mientras lo usás.

1. **Primera vez:** tocá **"Crear demo"**. Se crea una tienda de ejemplo en `playground/tienda-demo` con 4 errores a propósito y sus tareas ya cargadas.
2. Tocá **Iniciar**. Las tarjetas se mueven solas: *En cola → Trabajando → Para aprobar*.
3. Tocá una tarjeta para ver **qué hizo cada agente**, la **actividad en vivo** (qué archivo lee, qué comando corre), los **cambios en el código** y la evidencia del QA.
4. Decidí con botones: **Aprobar e integrar**, **Pedir cambios** (le escribís al Developer qué corregir) o **Cancelar**.
5. Cuando entiendas el flujo, abrí **tu proyecto** con el selector de carpetas. La primera vez, Studio te pide el comando de tests y la **identidad de los commits**, para que los agentes no firmen con la cuenta global de la PC.

También: `fleet studio` desde una terminal (`--port`, `--no-open`, `--repo <ruta>`).

Seguridad: Studio solo escucha en tu PC (127.0.0.1), rechaza pedidos de otros sitios y exige un token de sesión para cualquier acción.

## Roles

| Rol | Etapa | Qué hace | Puede editar |
|---|---|---|---|
| **Tech Lead** | `plan` | Lee el código y escribe un plan chico, incluyendo cómo se va a verificar | No |
| **Developer** | `execute` | Implementa el plan en su rama y hace commit | Sí (solo su worktree) |
| *(Fleet)* | `check` | Corre el comando de verificación del proyecto; no confía en el agente | — |
| **QA Verifier** | `verify` | Prueba de forma independiente que funciona y junta evidencia | No |
| **Code Reviewer** | `review` | 1 a 3 enfoques según el tamaño del diff: Corrección, Arquitectura, Simplicidad | No |
| **Auditor de calidad** | `fleet audit` | Revisa lo integrado en los últimos días y propone reglas de lint/CI contra malas prácticas repetidas | No |

Cada rol es una sesión `claude -p` **nueva**, con contexto limpio. Las instrucciones de cada rol están en [prompts/](prompts/) y las podés ajustar.

```
tareas (fleet add / todos.md / issues de GitHub)
   │  scheduler: prioridad, capacidad, nunca dos agentes en la misma área
   ▼
 Tech Lead → Developer → check → QA Verifier → Code Reviewer(s)
   │              ▲                    │
   │              └──── feedback ──────┘  (hasta maxAttempts; después: needs_human)
   ▼ ready_to_merge
 cola de merge: rebase → check → merge --ff-only ──► main ──► fleet report
```

## Solo plan, sin costos extra

- Los agentes usan **tu login de Claude Code**, es decir, tu suscripción.
- Fleet **quita `ANTHROPIC_API_KEY` y `ANTHROPIC_AUTH_TOKEN`** del entorno de cada agente (`planOnly: true`), así que nunca se factura por API aunque tengas una key configurada.
- `maxAgentRunsPerDay` (150 por defecto) pone un tope a las ejecuciones diarias para no gastar la cuota del plan en una sola noche.
- Si el plan llega a su **límite de uso**, la tarea **vuelve a la cola** (no se marca como fallida). Con `--watch`, Fleet espera `limitPauseMin` minutos y sigue. Sin `--watch`, se detiene.
- Claude Code informa un "costo equivalente" por sesión. Fleet lo guarda solo como referencia interna: con el plan no se cobra.

Requisito: haber iniciado sesión con tu cuenta en Claude Code al menos una vez. Si corrés `claude` en una terminal y abre sin pedirte login, ya está.

## Instalación

```powershell
cd D:\Proyectos\Agentes
npm link          # deja disponible el comando `fleet`
```

## Primer arranque (paso a paso)

1. **Elegí un proyecto con git** y con al menos un commit. Para la primera vez conviene uno chico o de prueba.
   ```powershell
   cd D:\Proyectos\MiApp
   fleet init
   ```
   Esto crea `.fleet/`, detecta tu comando de verificación y copia skills y agentes a `.claude/`, sin pisar archivos que ya existan.
2. **Revisá el comando de verificación.** Es la base de todo el sistema:
   ```powershell
   fleet config checkCommand "npm run lint && npm test"
   ```
3. **Completá `.claude/skills/fleet-verify/SKILL.md`**: cómo se levanta y se prueba tu app. Con eso el QA Verifier sabe qué tiene que demostrar.
4. **Hacé commit** de `.claude/` y `.gitignore`. Los agentes trabajan sobre lo que está commiteado.
5. **Cargá 1 o 2 tareas chicas y bien definidas**:
   ```powershell
   fleet add "Agregar validación de email en el formulario de registro" --area auth
   ```
6. **Corré una sola tanda, con un solo agente, y mirá qué pasa**:
   ```powershell
   fleet dashboard        # en otra terminal: http://127.0.0.1:4400
   fleet run --once --max 1
   ```
7. **Revisá el resultado** con `fleet show 1`, los logs en `.fleet/runs/task-1/` y el diff de la rama `fleet/task-1`. Si te convence, corré `fleet merge 1`.
8. **Por cada cosa que tengas que corregir**, creá una regla de lint o un test. No alcanza con agregar una línea más a CLAUDE.md.
9. **Subí de a poco**: después 3 agentes, más adelante 5, y cuando la tasa de rechazos sea baja, `fleet config mode auto` + `fleet run --watch` de noche.

## Comandos

| Comando | Qué hace |
|---|---|
| `init [--check "cmd"] [--mode]` | Prepara el repo |
| `add "<título>" [--desc] [--area] [--priority]` | Encola una tarea |
| `import <archivo.md>` / `import --github [--label]` | Importa tareas (`- [ ] Título #area !1`) |
| `list [--status]` / `show <id>` | Estado, veredictos e historial |
| `run [--once] [--watch] [--max N]` | Lanza agentes |
| `merge <id>` / `merge --all` | Integra tareas listas |
| `retry <id>` / `cancel <id>` | Reencola (conserva plan y feedback) o cancela |
| `stop` / `resume` | Kill switch |
| `report [--hours]` | Informe matutino en `.fleet/reports/` |
| `audit [--days]` | Auditor de calidad, resultados en `.fleet/audits/` |
| `dashboard [--port]` | Tablero web local |
| `config [clave] [valor]` | Ver o cambiar la configuración |

## Configuración (`.fleet/config.json`)

| Clave | Default | Nota |
|---|---|---|
| `mode` | `supervised` | `auto` mergea solo |
| `maxConcurrent` | 3 | Agentes en paralelo |
| `maxAttempts` | 2 | Reintentos con feedback antes de `needs_human` |
| `checkCommand` | detectado | Tiene que pasar siempre |
| `planOnly` | `true` | Nunca usa API key; solo tu plan |
| `maxAgentRunsPerDay` | 150 | Tope diario de ejecuciones de agentes |
| `limitPauseMin` | 30 | Espera cuando el plan llega a su límite (con `--watch`) |
| `models` | opus (plan/execute), sonnet (verify/review/audit) | Con el plan, opus consume la cuota más rápido |
| `maxTurns`, `stageTimeoutMin` | | Límites por etapa |
| `permissionMode`, `allowedTools` | `acceptEdits` + git/npm/node | Qué pueden hacer los Developers sin preguntar |
| `gitAuthor` | vacío | `{ "name", "email" }` con que firman los commits los agentes; tiene prioridad sobre la identidad global de git |

## Desarrollo

```powershell
npm test                               # usa un runner falso: no llama a Claude
$env:FLEET_RUNNER='fake'; fleet run     # probar el flujo sin agentes reales
```
