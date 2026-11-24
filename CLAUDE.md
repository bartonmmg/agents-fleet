# Fleet — notas para agentes

CLI en Node (ESM, `.mjs`) sin dependencias, más Fleet Studio (interfaz web local). Orquesta sesiones `claude -p` en git worktrees. El método está en `docs/lauren-tan-flota-de-agentes.md`.

- Verificar: `npm test`. Usa `FLEET_RUNNER=fake`, así que no llama a Claude. `FLEET_FAKE_DELAY_MS` hace más lentos a los agentes simulados, para ver el movimiento en Studio.
- Estructura:
  - `src/` (pipeline, scheduler, merge, runner, store, git, cli).
  - `src/studio/` (engine, server, demo, `public/` con la UI en JS vanilla).
  - `prompts/` (roles).
  - `templates/` (skills y agentes que `fleet init` copia a `.claude/` del proyecto destino).
  - `examples/tienda-demo/` (proyecto demo).
  - `test/`.
- Sin dependencias externas, tampoco en la UI. Tiene que funcionar en Windows: nada de bash-ismos y nada de `shell: true` para invocar `claude`.
- Los textos para el usuario van en español.
- Toda etapa nueva del pipeline necesita su soporte en el runner falso y un test.
- `fleet init` nunca pisa archivos existentes del proyecto destino.
- Identidad git de ESTE repo: solo `bartonmmg` (configurada en local). Nunca commitear con la identidad global de la PC.
- Studio: solo `127.0.0.1`, verificación de Host y token en todo POST. No relajar esto.
