// Funciones puras de la status page. Sin DOM: se prueban con node:test.

const TEXTOS = { arriba: "Arriba", abajo: "Abajo", sin_datos: "Sin datos" };
const ORDEN = { abajo: 0, sin_datos: 1, arriba: 2 };

export function textoEstado(estado) {
  return TEXTOS[estado] ?? estado;
}

export function formatearLatencia(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

export function formatearDisponibilidad(valor) {
  if (valor === null || valor === undefined) return "—";
  return `${String(valor).replace(".", ",")} %`;
}

export function ordenarPorEstado(lista) {
  return [...lista].sort((a, b) => (ORDEN[a.estado] ?? 3) - (ORDEN[b.estado] ?? 3) || a.url.localeCompare(b.url));
}
