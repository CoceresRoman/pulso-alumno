import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizarUrl } from "../../src/compartido/url.ts";

test("sanitizarUrl saca usuario, contraseña y query string", () => {
  assert.equal(sanitizarUrl("https://usuario:secreto@example.com/path?token=abc123"), "https://example.com/path");
});

test("sanitizarUrl deja igual una URL sin nada que sacar", () => {
  assert.equal(sanitizarUrl("https://example.com/sin-nada"), "https://example.com/sin-nada");
});

test("sanitizarUrl no tira con una URL inválida", () => {
  assert.equal(sanitizarUrl("no es una url"), "url_invalida");
});
