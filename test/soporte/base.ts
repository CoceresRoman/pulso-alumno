import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { migrar } from "../../src/compartido/migrar.ts";

export const CARPETA_MIGRACIONES = fileURLToPath(new URL("../../migraciones", import.meta.url));

export interface BaseDePrueba {
  pool: pg.Pool;
  cerrar(): Promise<void>;
}

// PGlite (WASM) resetea su socket apenas una consulta termina en error; si la
// siguiente consulta llega mientras tanto, revienta con "Connection terminated
// unexpectedly" aunque la base sigue sana. Contra un Postgres real esto no pasa
// (así que la corrección queda acá, no en `db.ts`): pausamos un toque antes de
// dejar pasar el error para darle tiempo al reset.
function conPausaTrasError(pool: pg.Pool): pg.Pool {
  const original = pool.query.bind(pool);
  (pool as unknown as { query: unknown }).query = async (...args: unknown[]) => {
    try {
      return await (original as (...a: unknown[]) => Promise<unknown>)(...args);
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 50));
      throw error;
    }
  };
  return pool;
}

// Sin TEST_DATABASE_URL: PGlite (Postgres 18 en WASM) en memoria, con una sola conexión.
// Con TEST_DATABASE_URL: esa base, con el esquema public borrado y vuelto a crear.
export async function abrirBaseDePrueba(opciones: { migrada?: boolean } = {}): Promise<BaseDePrueba> {
  const url = process.env.TEST_DATABASE_URL;
  let base: BaseDePrueba;
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query("drop schema public cascade; create schema public");
    base = { pool, cerrar: () => pool.end() };
  } else {
    const pglite = await PGlite.create();
    const socket = new PGLiteSocketServer({ db: pglite, port: 0, host: "127.0.0.1" });
    await socket.start();
    const pool = conPausaTrasError(
      new pg.Pool({ connectionString: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`, max: 1 })
    );
    base = {
      pool,
      cerrar: async () => {
        await pool.end();
        await socket.stop();
        await pglite.close();
      },
    };
  }
  if (opciones.migrada ?? true) await migrar(base.pool, CARPETA_MIGRACIONES);
  return base;
}
