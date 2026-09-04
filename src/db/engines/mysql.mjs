// Motor MySQL para la BD de pruebas de IA.
import { buildDataset } from '../dataset.mjs';
import { renderSchema, renderSeedsSql } from '../schema-generic.mjs';
import { DB_PASSWORD_PLACEHOLDER, dbOf, healthcheck } from './_common.mjs';

const engine = {
  name: 'mysql',
  image: 'mysql:8.0.40',
  defaultPort: 3306,
  altPort: 3307,
  dialect: 'mysql',
  dataPath: '/var/lib/mysql',
  initPath: '/docker-entrypoint-initdb.d',
  schemaFile: 'schema-generic.mysql.sql',
  seedFile: '001-sinteticos.mysql.sql',
  notes: ['En Mac ARM la imagen oficial de MySQL 8 corre en arm64 nativo; si tu Docker no lo soporta, usa `platform: linux/amd64` (lento).'],

  env(policy) {
    const d = dbOf(policy, engine);
    return {
      MYSQL_DATABASE: d.database, MYSQL_USER: d.user,
      MYSQL_PASSWORD: DB_PASSWORD_PLACEHOLDER, MYSQL_ROOT_PASSWORD: DB_PASSWORD_PLACEHOLDER,
    };
  },
  healthcheck() { return healthcheck('mysqladmin ping -h 127.0.0.1 --silent'); },
  connectionUrl(policy, { host = '127.0.0.1' } = {}) {
    const d = dbOf(policy, engine);
    return `mysql://${d.user}:${DB_PASSWORD_PLACEHOLDER}@${host}:${d.port}/${d.database}`;
  },
  schemaGeneric() { return renderSchema('mysql'); },
  seedStatements(rows, rng) { return renderSeedsSql('mysql', buildDataset(rows, rng), { seed: rng.seed, rows }); },
  applyCmd(policy, file) {
    const d = dbOf(policy, engine);
    return ['mysql', '-u', 'root', `-p${DB_PASSWORD_PLACEHOLDER}`, d.database, '-e', `source ${file}`];
  },
  countCmd(policy, table) {
    const d = dbOf(policy, engine);
    return ['mysql', '-u', 'root', `-p${DB_PASSWORD_PLACEHOLDER}`, '-N', '-B', d.database, '-e', `SELECT count(*) FROM ${table}`];
  },
};
export default engine;
