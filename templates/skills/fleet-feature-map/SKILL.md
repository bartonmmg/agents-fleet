---
name: fleet-feature-map
description: Mapa de cada funcionalidad visible del producto → ruta en la UI, cómo llegar, selectores y cómo probarla. Usar para reproducir bugs a partir de reportes vagos y para saber qué flujo ejercitar al verificar.
---

# Feature map

Mantener una fila por funcionalidad. Si al trabajar descubrís una feature que no está, agregala.

| Feature | Ruta / pantalla | Cómo llegar | Selectores clave | Cómo probarla | Código |
|---|---|---|---|---|---|
| <!-- Ej: Login --> | `/login` | Abrir la app sin sesión | `[data-testid=email]`, `[data-testid=submit]` | Usuario de test del seed → debe ir a `/dashboard` | `src/features/auth/` |

## Convenciones
- Preferí `data-testid` estables a selectores por texto o por CSS.
- Cada feature vive en su propio directorio: eso permite que los agentes trabajen en paralelo sin pisarse.
