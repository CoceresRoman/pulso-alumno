import { pino, type Logger } from "pino";

export type { Logger };

// Logs JSON a stdout, uno por línea, con el servicio que los emitió.
export function crearLogger(servicio: string, nivel = "info"): Logger {
  return pino({ level: nivel, base: { servicio } });
}
