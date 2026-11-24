---
name: fleet-code-review
description: Code Review adversarial de un diff con 1 a 3 enfoques (Corrección, Arquitectura, Simplicidad) según su tamaño. Usar para revisar el trabajo de otro agente antes de integrarlo. No edita código: entrega un veredicto.
---

# Code Review adversarial

1. Mirá el diff: `git diff <base>...HEAD --stat` y luego el diff completo.
2. Elegí los enfoques según el tamaño:
   - < 200 líneas: Corrección
   - 200–800: Corrección + Arquitectura
   - > 800: Corrección + Arquitectura + Simplicidad (y considerá pedir que se parta el PR)
3. Por cada enfoque:
   - **Corrección**: ¿es correcto? Casos borde, errores tragados, carreras, ¿resuelve de verdad la tarea?
   - **Arquitectura**: ¿respeta patrones y límites? ¿Qué pasa si otros agentes copian este patrón?
   - **Simplicidad**: ¿sobra código, abstracción o comentarios? ¿Hay una versión más simple?
4. Si un problema es recurrente, proponé la defensa más fuerte: arquitectura > CI/estático > lint > skill.

Salida:
```json
{"verdict": "pass" | "fail", "problems": [], "nits": [], "preventions": []}
```
