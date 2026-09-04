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
