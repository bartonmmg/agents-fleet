# Fleet — notas para agentes

CLI en Node (ESM, `.mjs`) sin dependencias. Orquesta sesiones `claude -p` en git worktrees. El método está en `docs/lauren-tan-flota-de-agentes.md`.

- Verificar: `npm test`. Usa `FLEET_RUNNER=fake`, así que no llama a Claude.
- Estructura: `src/` (pipeline, scheduler, merge, runner, store, git, cli), `prompts/` (roles), `templates/` (skills y agentes que `fleet init` copia a `.claude/` del proyecto destino), `test/`.
- Sin dependencias externas. Tiene que funcionar en Windows: nada de bash-ismos y nada de `shell: true` para invocar `claude`.
- Los textos para el usuario van en español.
- Toda etapa nueva del pipeline necesita su soporte en el runner falso y un test.
- `fleet init` nunca pisa archivos existentes del proyecto destino.
