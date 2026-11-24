const round = (n) => Math.round(n * 100) / 100;

export function createCart() {
  return { items: [] };
}

export function addItem(cart, product, qty = 1) {
  const existing = cart.items.find((i) => i.id === product.id);
  if (existing) existing.qty += qty;
  else cart.items.push({ id: product.id, name: product.name, price: product.price, qty });
  return cart;
}

export function subtotal(cart) {
  return round(cart.items.reduce((sum, i) => sum + i.price * i.qty, 0));
}

export function applyDiscount(amount, percent) {
  return amount - (amount * percent) / 100;
}

export function total(cart, discountPercent = 0) {
  const base = cart.items.reduce((sum, i) => sum + applyDiscount(i.price, discountPercent) * i.qty, 0);
  return round(applyDiscount(base, discountPercent));
}
