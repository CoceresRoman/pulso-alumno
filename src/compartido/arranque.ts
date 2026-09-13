import { leerConfig, type Config, type VariableRequerida } from "./config.ts";
import type { Logger } from "./logger.ts";

// Para los procesos: con la configuración inválida no se arranca a medias.
export function configOSalir(logger: Logger, requeridas: readonly VariableRequerida[], puertoPorDefecto?: number): Config {
  try {
    return leerConfig(process.env, requeridas, puertoPorDefecto);
  } catch (error) {
    logger.fatal({ err: error }, "no se puede arrancar");
    process.exit(1);
  }
}
