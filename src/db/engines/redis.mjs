// Motor Redis para la BD de pruebas de IA (sin DDL: hashes por fila + set de ids).
import { buildDataset } from '../dataset.mjs';
import { renderSchemaRedis, renderSeedsRedis } from '../schema-generic.mjs';
import { DB_PASSWORD_PLACEHOLDER, dbOf, healthcheck } from './_common.mjs';

const engine = {
  name: 'redis',
  image: 'redis:7.4.1-alpine',
  defaultPort: 6379,
  altPort: 6380,
  dialect: 'redis',
  dataPath: '/data',
  initPath: null,
  schemaFile: 'schema-generic.redis.txt',
  seedFile: '001-sinteticos.redis.txt',
  command: ['redis-server', '--requirepass', DB_PASSWORD_PLACEHOLDER, '--appendonly', 'yes'],
  notes: ['Redis no tiene esquema: el "esquema genérico" documenta el layout de claves y los seeds cargan hashes.'],

  env() { return { REDIS_PASSWORD: DB_PASSWORD_PLACEHOLDER }; },
  healthcheck() { return healthcheck(`redis-cli -a '${DB_PASSWORD_PLACEHOLDER}' --no-auth-warning ping | grep -q PONG`); },
  connectionUrl(policy, { host = '127.0.0.1' } = {}) {
    const d = dbOf(policy, engine);
    return `redis://:${DB_PASSWORD_PLACEHOLDER}@${host}:${d.port}/0`;
  },
  schemaGeneric() { return renderSchemaRedis(); },
  seedStatements(rows, rng) { return renderSeedsRedis(buildDataset(rows, rng), { seed: rng.seed, rows }); },
  applyCmd(_policy, file) {
    return ['sh', '-c', `grep -v '^#' ${file} | redis-cli -a '${DB_PASSWORD_PLACEHOLDER}' --no-auth-warning`];
  },
  countCmd(_policy, table) {
    return ['sh', '-c', `redis-cli -a '${DB_PASSWORD_PLACEHOLDER}' --no-auth-warning SCARD ${table}:ids`];
  },
};
export default engine;
