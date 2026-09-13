import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Redis } from "ioredis";
import { requerirServicios } from "../soporte/servicios.ts";

const { databaseUrl, redisUrl } = requerirServicios();

test("Postgres responde y es la versión 18", async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const { rows } = await pool.query<{ server_version: string }>("show server_version");
    assert.match(rows[0].server_version, /^18\./);
  } finally {
    await pool.end();
  }
});

test("la cola responde a PING", async () => {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  try {
    assert.equal(await redis.ping(), "PONG");
  } finally {
    redis.disconnect();
  }
});
