import type { ResultadoChequeo } from "../compartido/monitores.ts";

// Un chequeo: GET al sitio, sin seguir redirecciones. Nunca tira: el resultado dice qué pasó.
// `ignorarTimeout` existe para la falla FALLA_SIN_TIMEOUT del curso: sin timeout, un sitio
// que no responde deja el chequeo colgado para siempre.
export async function chequear(
  url: string,
  timeoutMs: number,
  opciones: { ignorarTimeout?: boolean } = {}
): Promise<ResultadoChequeo> {
  const inicio = performance.now();
  const latencia = () => Math.round(performance.now() - inicio);
  try {
    const respuesta = await fetch(url, {
      signal: opciones.ignorarTimeout ? undefined : AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    await respuesta.body?.cancel();
    return { ok: respuesta.status >= 200 && respuesta.status < 400, codigo: respuesta.status, latenciaMs: latencia(), error: null };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, codigo: null, latenciaMs: latencia(), error: "timeout" };
    }
    const codigoCausa = (error as { cause?: { code?: unknown } }).cause?.code;
    const detalle = typeof codigoCausa === "string" ? codigoCausa : error instanceof Error ? error.message : String(error);
    return { ok: false, codigo: null, latenciaMs: latencia(), error: detalle };
  }
}
