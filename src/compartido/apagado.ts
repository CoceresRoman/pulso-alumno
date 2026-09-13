import type { Logger } from "./logger.ts";

export interface OpcionesApagado {
  timeoutMs?: number;
  senales?: readonly NodeJS.Signals[];
  salir?: (codigo: number) => void;
}

// Docker y Kubernetes mandan SIGTERM y esperan un rato antes de matar el proceso.
// Al recibirla se corren las tareas (dejar de aceptar trabajo, terminar lo que está en
// curso, cerrar conexiones); si no terminan a tiempo se sale con 1.
export function alApagar(logger: Logger, tareas: () => Promise<void>, opciones: OpcionesApagado = {}): () => void {
  const timeoutMs = opciones.timeoutMs ?? 10_000;
  const senales = opciones.senales ?? ["SIGTERM", "SIGINT"];
  const salir = opciones.salir ?? ((codigo: number) => process.exit(codigo));
  let apagando = false;

  const manejar = (senal: NodeJS.Signals) => {
    if (apagando) return;
    apagando = true;
    logger.info({ senal }, "apagando");
    // Si el timeout ya disparó salir(1), las tareas pueden seguir corriendo y terminar
    // (bien o mal) más tarde: este cerrojo evita que salir() se llame una segunda vez.
    let terminado = false;
    const limite = setTimeout(() => {
      terminado = true;
      logger.error({ timeoutMs }, "el apagado no terminó a tiempo");
      salir(1);
    }, timeoutMs);
    limite.unref();
    tareas().then(
      () => {
        clearTimeout(limite);
        if (terminado) return;
        terminado = true;
        logger.info("apagado completo");
        salir(0);
      },
      error => {
        clearTimeout(limite);
        if (terminado) return;
        terminado = true;
        logger.error({ err: error }, "falló el apagado");
        salir(1);
      }
    );
  };

  for (const senal of senales) process.on(senal, manejar);
  return () => {
    for (const senal of senales) process.off(senal, manejar);
  };
}
