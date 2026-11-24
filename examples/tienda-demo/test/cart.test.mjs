import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, createCart, subtotal, total } from '../src/cart.mjs';

const remera = { id: 'r1', name: 'Remera', price: 100 };
const gorra = { id: 'g1', name: 'Gorra', price: 50 };

test('agregar el mismo producto suma cantidades', () => {
  const cart = addItem(addItem(createCart(), remera), remera, 2);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].qty, 3);
});

test('subtotal suma precio por cantidad', () => {
  const cart = addItem(addItem(createCart(), remera, 2), gorra);
  assert.equal(subtotal(cart), 250);
});

test('total sin descuento es igual al subtotal', () => {
  const cart = addItem(createCart(), gorra, 3);
  assert.equal(total(cart), 150);
});
