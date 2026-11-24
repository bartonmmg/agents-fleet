# Brújula del producto

## Qué es
Carrito de compras de una tienda de ropa de barrio. Es la lógica que usa la web para armar el pedido y calcular el total.

## Para quién
Clientes que compran desde el celular y quieren ver el total correcto antes de pagar. El dueño del local carga productos y promociones.

## Prioridades actuales (en orden)
1. Que el carrito y el total sean siempre correctos, incluyendo descuentos.
2. Cubrir con tests toda la lógica de precios y validaciones.
3. Mensajes claros para el cliente cuando algo no se puede hacer.

## Qué NO hacer (no-objetivos)
- No agregar dependencias externas.
- No crear interfaz gráfica ni servidor web: esto es solo la lógica.
- No cambiar los nombres de las funciones existentes (las usa la web).

## Zonas sensibles (siempre requieren aprobación humana)
- Cualquier cambio en cómo se calcula el total o se aplican descuentos (`total`, `applyDiscount`).

## Definición de "terminado"
- Todo cambio de comportamiento viene con su test y `npm test` pasa.
