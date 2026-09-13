import { formatearDisponibilidad, formatearLatencia, ordenarPorEstado, textoEstado } from "./estado.js";

const cuerpoTabla = document.querySelector("#monitores");
const resumen = document.querySelector("#resumen");
const formulario = document.querySelector("#alta");
const error = document.querySelector("#error");

function celda(texto, clase) {
  const td = document.createElement("td");
  td.textContent = texto;
  if (clase) td.className = clase;
  return td;
}

async function cargar() {
  try {
    const respuesta = await fetch("/api/estado");
    if (!respuesta.ok) throw new Error(`la api respondió ${respuesta.status}`);
    const monitores = ordenarPorEstado(await respuesta.json());
    const caidos = monitores.filter(m => m.estado === "abajo").length;
    resumen.textContent = `${monitores.length} monitores · ${caidos} caídos · actualizado ${new Date().toLocaleTimeString("es-AR")}`;
    cuerpoTabla.replaceChildren(
      ...monitores.map(m => {
        const fila = document.createElement("tr");
        const borrar = document.createElement("button");
        borrar.textContent = "Quitar";
        borrar.addEventListener("click", () => quitar(m.id));
        const acciones = document.createElement("td");
        acciones.append(borrar);
        fila.append(
          celda(textoEstado(m.estado), `estado ${m.estado}`),
          celda(m.url),
          celda(m.ultimoChequeo ? new Date(m.ultimoChequeo.momento).toLocaleTimeString("es-AR") : "—"),
          celda(formatearLatencia(m.ultimoChequeo?.latenciaMs ?? null)),
          celda(formatearDisponibilidad(m.disponibilidad24h)),
          acciones
        );
        return fila;
      })
    );
  } catch (e) {
    resumen.textContent = `No se pudo cargar el estado: ${e.message}`;
  }
}

async function quitar(id) {
  error.hidden = true;
  try {
    const respuesta = await fetch(`/api/monitores/${id}`, { method: "DELETE" });
    if (!respuesta.ok) {
      error.textContent = `No se pudo quitar el monitor (error ${respuesta.status})`;
      error.hidden = false;
      return;
    }
    await cargar();
  } catch (e) {
    error.textContent = `No se pudo conectar con la api: ${e.message}`;
    error.hidden = false;
  }
}

formulario.addEventListener("submit", async evento => {
  evento.preventDefault();
  error.hidden = true;
  const datos = new FormData(formulario);
  try {
    const respuesta = await fetch("/api/monitores", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: datos.get("url"), intervaloSegundos: Number(datos.get("intervalo")) }),
    });
    if (!respuesta.ok) {
      const cuerpo = await respuesta.json().catch(() => ({}));
      error.textContent = cuerpo.detalles?.join(" · ") ?? `Error ${respuesta.status}`;
      error.hidden = false;
      return;
    }
    formulario.reset();
    await cargar();
  } catch (e) {
    error.textContent = `No se pudo conectar con la api: ${e.message}`;
    error.hidden = false;
  }
});

cargar();
setInterval(cargar, 10_000);
