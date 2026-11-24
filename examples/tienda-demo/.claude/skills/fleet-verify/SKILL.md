---
name: fleet-verify
description: Cómo demostrar que un cambio funciona en la tienda demo. Usar antes de declarar terminada una tarea y al verificar el trabajo de otro agente.
---

# Verificar con evidencia (tienda demo)

1. Corré `npm test`. Todos los tests tienen que pasar, incluidos los nuevos.
2. Comprobá que hay un test que cubre exactamente lo que pide la tarea, y que fallaría con el código anterior.
3. Demostrá el comportamiento real con un script de una línea, por ejemplo:
   ```
   node -e "import('./src/cart.mjs').then(c => { const k = c.addItem(c.createCart(), {id:'r', name:'Remera', price:100}); console.log(c.total(k, 10)) })"
   ```
   Pegá el comando y su salida como evidencia.
