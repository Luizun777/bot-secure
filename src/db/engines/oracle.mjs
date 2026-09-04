// Motor Oracle para la BD de pruebas de IA (imagen comunitaria gvenzl con Oracle Database Free).
import { buildDataset } from '../dataset.mjs';
import { renderSchema, renderSeedsSql } from '../schema-generic.mjs';
import { DB_PASSWORD_PLACEHOLDER, dbOf, healthcheck } from './_common.mjs';

const SERVICE = 'FREEPDB1';

const engine = {
  name: 'oracle',
  image: 'gvenzl/oracle-free:23.5-slim',
  defaultPort: 1521,
  altPort: 15210,
  dialect: 'oracle',
  dataPath: '/opt/oracle/oradata',
  initPath: '/container-entrypoint-initdb.d',
  schemaFile: 'schema-generic.oracle.sql',
  seedFile: '001-sinteticos.oracle.sql',
  notes: [
    'LICENCIA: Oracle Database Free se usa bajo la Oracle Free Use Terms and Conditions (OTN). Revisa con tu área legal antes de usarla en la empresa; el bot no redistribuye la imagen.',
    'La imagen oficial de Oracle (container-registry.oracle.com) exige aceptar la licencia y autenticarse; aquí se usa la comunitaria gvenzl/oracle-free.',
    'Primer arranque lento (1-3 minutos) y sin build arm64 oficial: en Mac ARM corre emulada.',
  ],

  env(policy) {
    const d = dbOf(policy, engine);
    return { ORACLE_PASSWORD: DB_PASSWORD_PLACEHOLDER, APP_USER: d.user, APP_USER_PASSWORD: DB_PASSWORD_PLACEHOLDER };
  },
  healthcheck() { return healthcheck('healthcheck.sh', { retries: 30, startPeriod: '30s' }); },
  connectionUrl(policy, { host = '127.0.0.1' } = {}) {
    const d = dbOf(policy, engine);
    return `oracle://${d.user}:${DB_PASSWORD_PLACEHOLDER}@${host}:${d.port}/${SERVICE}`;
  },
  schemaGeneric() { return renderSchema('oracle'); },
  seedStatements(rows, rng) { return renderSeedsSql('oracle', buildDataset(rows, rng), { seed: rng.seed, rows }); },
  applyCmd(policy, file) {
    const d = dbOf(policy, engine);
    return ['sh', '-c', `sqlplus -s ${d.user}/'${DB_PASSWORD_PLACEHOLDER}'@//localhost:1521/${SERVICE} @${file}`];
  },
  countCmd(policy, table) {
    const d = dbOf(policy, engine);
    return ['sh', '-c', `printf 'set heading off feedback off pagesize 0\\nselect count(*) from ${table};\\nexit\\n' | sqlplus -s ${d.user}/'${DB_PASSWORD_PLACEHOLDER}'@//localhost:1521/${SERVICE}`];
  },
};
export default engine;
