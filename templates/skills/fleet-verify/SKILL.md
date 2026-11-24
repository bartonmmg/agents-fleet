---
name: fleet-verify
description: Cómo demostrar que un cambio funciona en ESTE proyecto (levantar la app, ejercitar flujos, obtener evidencia). Usar antes de declarar terminada cualquier tarea y al verificar el trabajo de otro agente.
---

# Verificar con evidencia

Principio: ningún cambio está terminado hasta que se **demuestra** que funciona. "Compila" no alcanza.

## 1. Check determinístico (siempre)
<!-- COMPLETAR: el comando que corre lint + typecheck + tests + build. Ej: npm run check -->
```
npm run check
```

## 2. Levantar la app
<!-- COMPLETAR: cómo se levanta, en qué puerto, datos de prueba (seed), usuario de test. -->
```
npm run dev   # http://localhost:3000
```

## 3. Ejercitar el flujo afectado
- Buscá la feature en la skill `fleet-feature-map` (ruta, selectores, cómo llegar).
- Usá Playwright para recorrer el flujo real:
  ```
  npx playwright test <spec>            # si existe un test
  npx playwright screenshot <url> .fleet-evidence/<tarea>-<paso>.png
  ```
- Si es una API: llamala de verdad (curl / script node) y mostrá request + respuesta.

## 4. Evidencia
Guardá screenshots/logs en `.fleet-evidence/` (está en .gitignore) y listalos en tu respuesta:
- qué comando corriste → qué salida viste
- qué pantalla abriste → qué se ve (con la ruta del screenshot)

## Cuando aparezca un modo de falla nuevo
Si un agente "verificó" algo que en realidad no funcionaba, agregá aquí el paso que lo habría detectado.
