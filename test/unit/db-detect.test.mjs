// Detección del motor y de las migraciones a partir de manifiestos mínimos, y comportamiento
// cuando NO hay Docker ni Podman (el usuario debe ver siempre el arreglo exacto).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectEngine, detectMigrations, up, embedded, dump } from '../../src/db/index.mjs';
import { detectContainerRuntime } from '../../src/db/runtime.mjs';
import { renderMigrateSh } from '../../src/db/migrations.mjs';

const SIN_RUNTIME = { kind: null, compose: [] };

/** Crea una app de mentira con los archivos indicados: {'package.json': '…'}. */
function appDir(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'bs-det-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const pkg = (deps) => JSON.stringify({ name: 'app', dependencies: deps });

const CASOS = [
  ['postgres', { 'package.json': pkg({ pg: '^8.11.0', express: '^4' }) }],
  ['postgres', { 'requirements.txt': 'Django==5.0\npsycopg[binary]==3.1\n' }],
  ['postgres', { 'app.csproj': '<Project><ItemGroup><PackageReference Include="Npgsql" Version="8.0.0" /></ItemGroup></Project>', 'appsettings.json': '{"ConnectionStrings":{"Default":"Host=localhost"}}' }],
  ['mysql', { 'package.json': pkg({ mysql2: '^3.9.0' }) }],
  ['mysql', { 'requirements.txt': 'PyMySQL==1.1.0\n' }],
  ['mongo', { 'package.json': pkg({ mongoose: '^8.0.0' }) }],
  ['mongo', { 'requirements.txt': 'pymongo==4.6.0\n' }],
  ['redis', { 'package.json': pkg({ ioredis: '^5.3.0' }) }],
  ['mssql', { 'app.csproj': '<Project><PackageReference Include="Microsoft.Data.SqlClient" Version="5.1.0" /></Project>' }],
  ['oracle', { 'package.json': pkg({ oracledb: '^6.3.0' }) }],
  ['oracle', { 'pom.xml': '<project><dependency><artifactId>ojdbc11</artifactId></dependency></project>' }],
];

for (const [esperado, files] of CASOS) {
  test(`detectEngine → ${esperado} con ${Object.keys(files).join(', ')}`, (t) => {
    const root = appDir(t, files);
    assert.equal(detectEngine([{ name: 'app', path: '.' }], { root }), esperado);
  });
}

test('detectEngine → postgres por application.yml de Spring (jdbc:postgresql)', (t) => {
  const root = appDir(t, { 'src/main/resources/application.yml': 'spring:\n  datasource:\n    url: jdbc:postgresql://db:5432/tienda\n' });
  assert.equal(detectEngine([{ name: 'back', path: '.' }], { root }), 'postgres');
});

test('detectEngine → postgres aunque también haya Redis (la caché no manda)', (t) => {
  const root = appDir(t, { 'package.json': pkg({ pg: '^8', ioredis: '^5' }) });
  assert.equal(detectEngine([{ name: 'app', path: '.' }], { root }), 'postgres');
});

test('detectEngine → null si el proyecto no declara ninguna base de datos', (t) => {
  const root = appDir(t, { 'package.json': pkg({ react: '^18' }) });
  assert.equal(detectEngine([{ name: 'web', path: '.' }], { root }), null);
});

/* ---------------------------------------- migraciones ---------------------------------------- */

const MIGRACIONES = [
  [{ orm: 'prisma', packageManager: 'npm' }, 'prisma', /prisma migrate deploy/],
  [{ orm: 'knex', packageManager: 'pnpm' }, 'knex', /knex migrate:latest/],
  [{ orm: 'typeorm', packageManager: 'npm' }, 'typeorm', /typeorm migration:run/],
  [{ orm: 'django' }, 'django', /python manage\.py migrate/],
  [{ orm: 'alembic' }, 'alembic', /alembic upgrade head/],
  [{ orm: 'flyway' }, 'flyway', /flyway:migrate/],
  [{ orm: 'liquibase' }, 'liquibase', /liquibase update/],
  [{ orm: 'efcore' }, 'efcore', /dotnet ef database update/],
  [{ orm: 'laravel-migrations' }, 'laravel', /php artisan migrate/],
  [{ orm: 'rails' }, 'rails', /rails db:migrate/],
  [{ orm: 'goose' }, 'goose', /goose .* up/],
];

for (const [app, tool, re] of MIGRACIONES) {
  test(`detectMigrations → ${tool}`, () => {
    const plan = detectMigrations({ path: 'backend', ...app });
    assert.equal(plan.tool, tool);
    assert.ok(plan.envVar, 'el plan dice en qué variable va la URL');
    assert.match(plan.argv.join(' '), re);
  });
}

test('detectMigrations → null si la app no tiene herramienta de migraciones', () => {
  assert.equal(detectMigrations({ path: 'web', orm: 'mongoose' }), null);
  assert.equal(detectMigrations({ path: 'web' }), null);
});

test('migrate.sh es sh POSIX, exporta la URL de IA y no lleva bashismos', () => {
  const plans = [detectMigrations({ path: 'backend', orm: 'prisma', packageManager: 'npm' })];
  const sh = renderMigrateSh(plans, 'postgres://app:__AI_PLACEHOLDER__DB_PASSWORD__@127.0.0.1:5433/app_ai');
  assert.match(sh, /^#!\/bin\/sh\n/);
  assert.match(sh, /export DATABASE_URL/);
  assert.doesNotMatch(sh, /\[\[|\bsource\b|\bfunction\b/, 'nada de bashismos: debe correr en sh POSIX');
});

test('sin migraciones, migrate.sh explica que se usa el esquema genérico', () => {
  assert.match(renderMigrateSh([], 'postgres://x'), /esquema genérico/);
});

/* -------------------------------------- sin runtime ------------------------------------------ */

test('detectContainerRuntime devuelve la forma del contrato', () => {
  const rt = detectContainerRuntime();
  assert.ok(rt.kind === null || ['docker', 'podman'].includes(rt.kind));
  assert.ok(Array.isArray(rt.compose));
});

test('sin Docker ni Podman: error con el comando de arreglo', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bs-nort-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = { version: 1, project: 'tienda', runtime: 'clone', apps: [], db: { rows: 3, seed: 42 } };
  await assert.rejects(() => up(root, policy, { runtime: SIN_RUNTIME }), (e) => {
    assert.equal(e.key, 'db.noRuntime');
    assert.match(e.fix, /bot-secure db up/);
    return true;
  });
});

test('sin Docker y runtime: tests → SQL equivalente (y SQLite si Node lo trae)', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bs-emb-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = { version: 1, project: 'tienda', runtime: 'tests', apps: [], db: { rows: 5, seed: 42 } };
  const res = await up(root, policy, { runtime: SIN_RUNTIME });
  assert.equal(res.mode, 'embedded');
  assert.ok(existsSync(join(root, 'mocks', 'db', 'schema-generic.sqlite.sql')), 'SQL de esquema para carga manual');
  assert.ok(existsSync(join(root, 'mocks', 'db', 'seeds', '001-sinteticos.sqlite.sql')), 'SQL de semillas para carga manual');
  if (res.sqlite) assert.equal(res.loaded, 5, 'node:sqlite disponible: la base queda cargada');
  else assert.ok(res.reason, 'sin node:sqlite se explica por qué');
});

test('`embedded` es determinista con la misma semilla', async (t) => {
  const mk = () => { const r = mkdtempSync(join(tmpdir(), 'bs-emb2-')); t.after(() => rmSync(r, { recursive: true, force: true })); return r; };
  const policy = { version: 1, project: 't', runtime: 'tests', apps: [], db: { rows: 4, seed: 11 } };
  const a = await embedded(mk(), policy, {});
  const b = await embedded(mk(), policy, {});
  assert.deepEqual({ ...a, artifacts: null, file: null }, { ...b, artifacts: null, file: null });
});

test('`db dump` sin --synthetic está prohibido por diseño', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bs-dump-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = { version: 1, project: 't', apps: [], db: { rows: 2, seed: 1 } };
  await assert.rejects(() => dump(root, policy, {}), (e) => {
    assert.equal(e.key, 'db.dumpRealForbidden');
    assert.match(e.fix, /--synthetic/);
    return true;
  });
  const ok = await dump(root, policy, { synthetic: true });
  assert.match(ok.file, /seeds\/001-sinteticos\.postgres\.sql$/);
});
