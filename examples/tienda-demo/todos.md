# Tareas de la tienda demo

- [ ] Corregir el total con descuento: aplica el descuento dos veces #carrito !1
  Con una remera de $100 y 10% de descuento, total() devuelve 81 en lugar de 90.
  Agregá un test que cubra este caso.
- [ ] Agregar removeItem(cart, id) para quitar un producto del carrito #carrito
  Si el producto no está en el carrito, no debe fallar: devuelve el carrito igual. Con tests.
- [ ] Validación de email más estricta #validacion
  Hoy isValidEmail acepta "ana@" o "@tienda.com". Tiene que exigir usuario, arroba y un dominio con punto. Con tests.
- [ ] formatPrice con formato argentino #formato !3
  formatPrice(1234.5) debe devolver "$ 1.234,50" (punto para miles, coma para decimales). Con tests.
