import { fileURLToPath } from "node:url";
import { leerConfig } from "./compartido/config.ts";
import { crearPool } from "./compartido/db.ts";
import { crearLogger } from "./compartido/logger.ts";
import { migrar } from "./compartido/migrar.ts";

// Desde src/ y desde dist/ la carpeta queda un nivel arriba.
const CARPETA = fileURLToPath(new URL("../migraciones", import.meta.url));

// Antes de leer la configuración todavía no sabemos LOG_LEVEL: este logger de arranque
// solo se usa para el fatal de una configuración inválida.
let config;
try {
  config = leerConfig(process.env, ["DATABASE_URL"]);
} catch (error) {
  crearLogger("migrar").fatal({ err: error }, "no se pudieron aplicar las migraciones");
  process.exit(1);
}

const logger = crearLogger("migrar", config.nivelLog);
const pool = crearPool(config.databaseUrl, logger);
try {
  const aplicadas = await migrar(pool, CARPETA, logger);
  logger.info({ aplicadas }, aplicadas.length > 0 ? "migraciones aplicadas" : "la base ya estaba al día");
} catch (error) {
  logger.fatal({ err: error }, "no se pudieron aplicar las migraciones");
  process.exitCode = 1;
} finally {
  await pool.end();
}
