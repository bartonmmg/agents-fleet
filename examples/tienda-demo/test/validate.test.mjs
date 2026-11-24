import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail } from '../src/validate.mjs';

test('acepta un email común', () => {
  assert.equal(isValidEmail('ana@tienda.com'), true);
});

test('rechaza un texto sin arroba', () => {
  assert.equal(isValidEmail('ana.tienda.com'), false);
});
