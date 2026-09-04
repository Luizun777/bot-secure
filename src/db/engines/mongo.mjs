// Motor MongoDB para la BD de pruebas de IA (esquema = validadores $jsonSchema en JS).
import { buildDataset } from '../dataset.mjs';
import { renderSchemaMongo, renderSeedsMongo } from '../schema-generic.mjs';
import { DB_PASSWORD_PLACEHOLDER, dbOf, healthcheck } from './_common.mjs';

const engine = {
  name: 'mongo',
  image: 'mongo:7.0.14',
  defaultPort: 27017,
  altPort: 27018,
  dialect: 'mongo',
  dataPath: '/data/db',
  initPath: '/docker-entrypoint-initdb.d',
  schemaFile: 'schema-generic.mongo.js',
  seedFile: '001-sinteticos.mongo.js',
  notes: [],

  env(policy) {
    const d = dbOf(policy, engine);
    return { MONGO_INITDB_DATABASE: d.database, MONGO_INITDB_ROOT_USERNAME: d.user, MONGO_INITDB_ROOT_PASSWORD: DB_PASSWORD_PLACEHOLDER };
  },
  healthcheck() { return healthcheck("mongosh --quiet --eval 'db.adminCommand({ ping: 1 }).ok' || exit 1"); },
  connectionUrl(policy, { host = '127.0.0.1' } = {}) {
    const d = dbOf(policy, engine);
    return `mongodb://${d.user}:${DB_PASSWORD_PLACEHOLDER}@${host}:${d.port}/${d.database}?authSource=admin`;
  },
  schemaGeneric(policy) { return renderSchemaMongo(dbOf(policy, engine).database); },
  seedStatements(rows, rng, policy) { return renderSeedsMongo(dbOf(policy, engine).database, buildDataset(rows, rng), { seed: rng.seed, rows }); },
  applyCmd(policy, file) {
    const d = dbOf(policy, engine);
    return ['mongosh', '--quiet', '-u', d.user, '-p', DB_PASSWORD_PLACEHOLDER, '--authenticationDatabase', 'admin', file];
  },
  countCmd(policy, table) {
    const d = dbOf(policy, engine);
    return ['mongosh', '--quiet', '-u', d.user, '-p', DB_PASSWORD_PLACEHOLDER, '--authenticationDatabase', 'admin',
      '--eval', `db.getSiblingDB(${JSON.stringify(d.database)}).${table}.countDocuments()`];
  },
};
export default engine;
