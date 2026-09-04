// Motor PostgreSQL para la BD de pruebas de IA.
import { buildDataset } from '../dataset.mjs';
import { renderSchema, renderSeedsSql } from '../schema-generic.mjs';
import { DB_PASSWORD_PLACEHOLDER, dbOf, healthcheck } from './_common.mjs';

/** @type {import('./_common.mjs').Engine} */
const engine = {
  name: 'postgres',
  image: 'postgres:16.6-alpine',
  defaultPort: 5432,
  altPort: 5433,
  dialect: 'postgres',
  dataPath: '/var/lib/postgresql/data',
  initPath: '/docker-entrypoint-initdb.d',
  schemaFile: 'schema-generic.postgres.sql',
  seedFile: '001-sinteticos.postgres.sql',
  notes: [],

  /** Variables del contenedor; la contraseña es literalmente el placeholder de `.env.ai`. */
  env(policy) {
    const d = dbOf(policy, engine);
    return { POSTGRES_DB: d.database, POSTGRES_USER: d.user, POSTGRES_PASSWORD: DB_PASSWORD_PLACEHOLDER };
  },
  healthcheck(policy) {
    const d = dbOf(policy, engine);
    return healthcheck(`pg_isready -U ${d.user} -d ${d.database}`);
  },
  /** URL que va a `.env.ai` (misma que usa `db status`). */
  connectionUrl(policy, { host = '127.0.0.1' } = {}) {
    const d = dbOf(policy, engine);
    return `postgres://${d.user}:${DB_PASSWORD_PLACEHOLDER}@${host}:${d.port}/${d.database}`;
  },
  schemaGeneric() { return renderSchema('postgres'); },
  seedStatements(rows, rng) { return renderSeedsSql('postgres', buildDataset(rows, rng), { seed: rng.seed, rows }); },
  applyCmd(policy, file) {
    const d = dbOf(policy, engine);
    return ['psql', '-v', 'ON_ERROR_STOP=1', '-U', d.user, '-d', d.database, '-f', file];
  },
  countCmd(policy, table) {
    const d = dbOf(policy, engine);
    return ['psql', '-U', d.user, '-d', d.database, '-t', '-A', '-c', `SELECT count(*) FROM ${table}`];
  },
};
export default engine;
