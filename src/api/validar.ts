import type { DatosMonitor } from "../compartido/monitores.ts";

export type Validacion<T> = { ok: true; valor: T } | { ok: false; detalles: string[] };

const CAMPOS = ["url", "intervaloSegundos", "timeoutMs"];
const RANGOS = { intervaloSegundos: [10, 3600], timeoutMs: [100, 30_000] } as const;

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

function esUrlHttp(texto: string): boolean {
  try {
    const url = new URL(texto);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function revisar(cuerpo: unknown, urlObligatoria: boolean): Validacion<Partial<DatosMonitor>> {
  if (!esObjeto(cuerpo)) return { ok: false, detalles: ["el cuerpo tiene que ser un objeto JSON"] };
  const detalles: string[] = [];
  for (const clave of Object.keys(cuerpo)) {
    if (!CAMPOS.includes(clave)) detalles.push(`campo desconocido: ${clave}`);
  }

  const valor: Partial<DatosMonitor> = {};
  if (cuerpo.url === undefined) {
    if (urlObligatoria) detalles.push("falta url");
  } else if (typeof cuerpo.url !== "string" || cuerpo.url.length > 2048 || !esUrlHttp(cuerpo.url)) {
    detalles.push("url tiene que ser una URL http o https de hasta 2048 caracteres");
  } else {
    valor.url = cuerpo.url;
  }

  for (const campo of ["intervaloSegundos", "timeoutMs"] as const) {
    const [minimo, maximo] = RANGOS[campo];
    const dato = cuerpo[campo];
    if (dato === undefined) continue;
    if (typeof dato !== "number" || !Number.isInteger(dato) || dato < minimo || dato > maximo) {
      detalles.push(`${campo} tiene que ser un entero entre ${minimo} y ${maximo}`);
    } else {
      valor[campo] = dato;
    }
  }
  return detalles.length > 0 ? { ok: false, detalles } : { ok: true, valor };
}

// Un chequeo que puede tardar más que el intervalo se superpone con el siguiente.
export function detalleTimeout(intervaloSegundos: number, timeoutMs: number): string | null {
  const intervaloMs = intervaloSegundos * 1000;
  return timeoutMs < intervaloMs ? null : `timeoutMs tiene que ser menor que el intervalo (${intervaloMs} ms)`;
}

export function validarNuevoMonitor(cuerpo: unknown): Validacion<DatosMonitor> {
  const revision = revisar(cuerpo, true);
  if (!revision.ok) return revision;
  const valor: DatosMonitor = {
    url: revision.valor.url ?? "",
    intervaloSegundos: revision.valor.intervaloSegundos ?? 30,
    timeoutMs: revision.valor.timeoutMs ?? 5000,
  };
  const conflicto = detalleTimeout(valor.intervaloSegundos, valor.timeoutMs);
  return conflicto ? { ok: false, detalles: [conflicto] } : { ok: true, valor };
}

export function validarCambios(cuerpo: unknown): Validacion<Partial<DatosMonitor>> {
  const revision = revisar(cuerpo, false);
  if (revision.ok && Object.keys(revision.valor).length === 0) return { ok: false, detalles: ["no hay nada para cambiar"] };
  return revision;
}

export function leerId(texto: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(texto)) return null;
  const id = Number(texto);
  return id <= 2_147_483_647 ? id : null;
}

export function leerLimite(texto: unknown): number | null {
  if (texto === undefined) return 50;
  if (typeof texto !== "string" || !/^\d+$/.test(texto)) return null;
  const limite = Number(texto);
  return limite >= 1 && limite <= 500 ? limite : null;
}
