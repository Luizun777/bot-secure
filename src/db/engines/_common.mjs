// Constantes y helpers compartidos por los motores.

/** Contraseña del contenedor de IA: literalmente el placeholder que va en .env.ai. */
export const DB_PASSWORD_PLACEHOLDER = '__AI_PLACEHOLDER__DB_PASSWORD__';

/** Defaults de policy.db aplicados por cada motor. */
export function dbOf(policy, engine) {
  const db = policy?.db ?? {};
  return {
    engine: db.engine ?? engine.name,
    port: Number(db.port ?? engine.altPort),
    database: db.database ?? 'app_ai',
    user: db.user ?? 'app',
    generic: !!db.generic,
    rows: Number(db.rows ?? 1000),
    seed: Number(db.seed ?? 42),
  };
}

/** Texto de ayuda de migraciones común (el ORM decide el comando; la URL viene del entorno). */
export function genericMigrationHint(orm, envVar) {
  const base = `Ejecuta las migraciones en el HOST con ${envVar} apuntando a la BD de IA (bot-secure db up las corre por ti si detecta el ORM).`;
  return orm ? `${base} ORM detectado: ${orm}.` : base;
}

/** Punto de montaje (solo lectura) de `mocks/db` dentro del contenedor. */
export const SQL_MOUNT = '/sql';

/** Ruta dentro del contenedor de un archivo relativo a `mocks/db`. */
export const inContainer = (rel) => `${SQL_MOUNT}/${String(rel).split('\\').join('/')}`;

/** Healthcheck con los tiempos por defecto del bot (≤ 90 s de espera total). */
export function healthcheck(test, { interval = '5s', timeout = '5s', retries = 18, startPeriod = '10s' } = {}) {
  return { test: ['CMD-SHELL', test], interval, timeout, retries, start_period: startPeriod };
}

/** Nombre del contenedor y del volumen de la BD de IA del proyecto. */
export const dbContainerName = (policy) => `${policy?.project || 'proyecto'}-ai-db`;
