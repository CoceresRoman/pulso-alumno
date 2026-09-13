// Los tests de integración usan variables propias: nunca DATABASE_URL, porque los
// helpers borran el esquema de la base en cada archivo.
export function requerirServicios(): { databaseUrl: string; redisUrl: string } {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const redisUrl = process.env.TEST_REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error(
      "Los tests de integración necesitan TEST_DATABASE_URL (Postgres 18) y TEST_REDIS_URL (Valkey 9 o Redis 6.2+). " +
        "Su base se borra en cada archivo de test: no uses la de desarrollo."
    );
  }
  return { databaseUrl, redisUrl };
}
