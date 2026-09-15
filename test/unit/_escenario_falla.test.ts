import test from "node:test";
import assert from "node:assert";

test("falla a propósito (escenario del módulo 1, se saca en el commit verde)", () => {
  assert.equal(1, 2);
});
