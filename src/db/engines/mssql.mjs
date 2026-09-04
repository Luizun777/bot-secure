// Motor SQL Server para la BD de pruebas de IA.
import { buildDataset } from '../dataset.mjs';
import { renderSchema, renderSeedsSql } from '../schema-generic.mjs';
import { DB_PASSWORD_PLACEHOLDER, dbOf, healthcheck } from './_common.mjs';

const SQLCMD = '/opt/mssql-tools18/bin/sqlcmd';

const engine = {
  name: 'mssql',
  image: 'mcr.microsoft.com/mssql/server:2022-CU12-ubuntu-22.04',
  defaultPort: 1433,
  altPort: 14330,
  dialect: 'mssql',
  dataPath: '/var/opt/mssql',
  initPath: null,
  schemaFile: 'schema-generic.mssql.sql',
  seedFile: '001-sinteticos.mssql.sql',
  notes: [
    'En Mac con chip ARM la imagen corre emulada (linux/amd64): el arranque tarda 1-3 minutos y consume ~2 GB de RAM.',
    'SQL Server exige contraseñas de 3 de 4 categorías (mayúscula, minúscula, dígito, símbolo): el placeholder __AI_PLACEHOLDER__DB_PASSWORD__ solo tiene 2. Si el contenedor no arranca, pon una contraseña que cumpla en mocks/db/compose.db.yml y en .env.ai.',
    'La base app_ai se crea al aplicar el esquema (la imagen solo trae master).',
  ],

  env() { return { ACCEPT_EULA: 'Y', MSSQL_PID: 'Developer', MSSQL_SA_PASSWORD: DB_PASSWORD_PLACEHOLDER }; },
  healthcheck() { return healthcheck(`${SQLCMD} -S localhost -U sa -P '${DB_PASSWORD_PLACEHOLDER}' -C -Q 'SELECT 1' || exit 1`, { retries: 24, startPeriod: '20s' }); },
  connectionUrl(policy, { host = '127.0.0.1' } = {}) {
    const d = dbOf(policy, engine);
    return `sqlserver://${host}:${d.port};database=${d.database};user=sa;password=${DB_PASSWORD_PLACEHOLDER};trustServerCertificate=true`;
  },
  schemaGeneric(policy) {
    const d = dbOf(policy, engine);
    return [`IF DB_ID('${d.database}') IS NULL CREATE DATABASE ${d.database};`, 'GO', `USE ${d.database};`, 'GO', '', renderSchema('mssql')].join('\n');
  },
  seedStatements(rows, rng, policy) {
    const d = dbOf(policy, engine);
    const body = renderSeedsSql('mssql', buildDataset(rows, rng), { seed: rng.seed, rows });
    const [header, ...rest] = body.split('\n');
    return [header, `USE ${d.database};`, ...rest].join('\n');
  },
  applyCmd(policy, file) {
    const d = dbOf(policy, engine);
    return [SQLCMD, '-S', 'localhost', '-U', 'sa', '-P', DB_PASSWORD_PLACEHOLDER, '-C', '-b', '-d', 'master', '-v', `DB=${d.database}`, '-i', file];
  },
  countCmd(policy, table) {
    const d = dbOf(policy, engine);
    return [SQLCMD, '-S', 'localhost', '-U', 'sa', '-P', DB_PASSWORD_PLACEHOLDER, '-C', '-h', '-1', '-W', '-d', d.database, '-Q', `SET NOCOUNT ON; SELECT count(*) FROM ${table}`];
  },
};
export default engine;
