import { test } from "node:test";
import assert from "node:assert/strict";
import { formatearDisponibilidad, formatearLatencia, ordenarPorEstado, textoEstado } from "../../web/estado.js";

test("textos del estado", () => {
  assert.equal(textoEstado("arriba"), "Arriba");
  assert.equal(textoEstado("abajo"), "Abajo");
  assert.equal(textoEstado("sin_datos"), "Sin datos");
});

test("latencia en ms o en segundos, con coma decimal", () => {
  assert.equal(formatearLatencia(40), "40 ms");
  assert.equal(formatearLatencia(999), "999 ms");
  assert.equal(formatearLatencia(1234), "1,2 s");
  assert.equal(formatearLatencia(null), "—");
});

test("disponibilidad con coma decimal o guion", () => {
  assert.equal(formatearDisponibilidad(66.7), "66,7 %");
  assert.equal(formatearDisponibilidad(100), "100 %");
  assert.equal(formatearDisponibilidad(null), "—");
});

test("primero los caídos, después sin datos, después arriba; dentro, por url", () => {
  const lista = [
    { url: "https://b.example", estado: "arriba" },
    { url: "https://c.example", estado: "sin_datos" },
    { url: "https://z.example", estado: "abajo" },
    { url: "https://a.example", estado: "arriba" },
    { url: "https://y.example", estado: "abajo" },
  ];
  assert.deepEqual(ordenarPorEstado(lista).map(m => m.url), [
    "https://y.example",
    "https://z.example",
    "https://c.example",
    "https://a.example",
    "https://b.example",
  ]);
  assert.equal(lista[0].url, "https://b.example", "no modifica la lista original");
});
