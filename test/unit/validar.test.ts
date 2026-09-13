import { test } from "node:test";
import assert from "node:assert/strict";
import { detalleTimeout, leerId, leerLimite, validarCambios, validarNuevoMonitor } from "../../src/api/validar.ts";

test("con solo la url completa los valores por defecto", () => {
  assert.deepEqual(validarNuevoMonitor({ url: "https://example.com" }), {
    ok: true,
    valor: { url: "https://example.com", intervaloSegundos: 30, timeoutMs: 5000 },
  });
});

test("acepta un monitor completo", () => {
  assert.deepEqual(validarNuevoMonitor({ url: "http://sitio-lento:3001/ok", intervaloSegundos: 10, timeoutMs: 2000 }), {
    ok: true,
    valor: { url: "http://sitio-lento:3001/ok", intervaloSegundos: 10, timeoutMs: 2000 },
  });
});

test("junta todos los problemas", () => {
  assert.deepEqual(validarNuevoMonitor({ url: "ftp://x", intervaloSegundos: 5, timeoutMs: "1000", color: "rojo" }), {
    ok: false,
    detalles: [
      "campo desconocido: color",
      "url tiene que ser una URL http o https de hasta 2048 caracteres",
      "intervaloSegundos tiene que ser un entero entre 10 y 3600",
      "timeoutMs tiene que ser un entero entre 100 y 30000",
    ],
  });
});

test("sin url o sin objeto", () => {
  assert.deepEqual(validarNuevoMonitor({}), { ok: false, detalles: ["falta url"] });
  for (const cuerpo of [undefined, null, [], "texto"]) {
    assert.deepEqual(validarNuevoMonitor(cuerpo), { ok: false, detalles: ["el cuerpo tiene que ser un objeto JSON"] });
  }
});

test("el timeout tiene que ser menor que el intervalo", () => {
  assert.deepEqual(validarNuevoMonitor({ url: "https://example.com", intervaloSegundos: 10, timeoutMs: 10000 }), {
    ok: false,
    detalles: ["timeoutMs tiene que ser menor que el intervalo (10000 ms)"],
  });
  assert.equal(detalleTimeout(10, 9999), null);
});

test("validarCambios exige al menos un campo", () => {
  assert.deepEqual(validarCambios({}), { ok: false, detalles: ["no hay nada para cambiar"] });
  assert.deepEqual(validarCambios({ timeoutMs: 1000 }), { ok: true, valor: { timeoutMs: 1000 } });
});

test("leerId y leerLimite", () => {
  assert.equal(leerId("1"), 1);
  for (const texto of ["0", "01", "abc", "-1", "1.5", "2147483648"]) assert.equal(leerId(texto), null, texto);
  assert.equal(leerLimite(undefined), 50);
  assert.equal(leerLimite("10"), 10);
  for (const texto of ["0", "501", "x", ["1", "2"]]) assert.equal(leerLimite(texto), null, String(texto));
});
