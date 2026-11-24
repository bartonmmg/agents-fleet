# Tienda demo

Carrito de compras mínimo para probar Fleet. Tiene errores a propósito, que están listados en `todos.md`:

- `total()` aplica el descuento dos veces.
- No se pueden quitar productos del carrito.
- La validación de email es muy permisiva.
- Los precios no usan formato argentino.

Los tests actuales pasan (`npm test`) porque no cubren esos casos. Los agentes tienen que arreglarlos y agregar los tests que faltan.
