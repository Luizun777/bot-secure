// Migraciones del proyecto: qué comando ejecutar EN EL HOST, con la URL de la BD de IA en el entorno.
// El bot nunca inventa migraciones: usa las del proyecto (Prisma, knex, TypeORM, Django, Alembic,
// Flyway, Liquibase, EF Core, Laravel, Rails, goose…). Si no hay, se usa el esquema genérico.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {object} MigrationPlan
 * @property {string} tool herramienta detectada (prisma, knex, django…)
 * @property {string[]} argv comando y argumentos a ejecutar en el HOST
 * @property {string} cwd ruta de la app (relativa a la raíz del workspace)
 * @property {string} envVar variable de entorno donde va la URL de la BD de IA
 * @property {string} [migrationsDir] carpeta de migraciones detectada
 */

/** Ejecutor de paquetes de Node según el gestor declarado por `detect`. */
function nodeRunner(pm) {
  if (pm === 'pnpm') return ['pnpm', 'exec'];
  if (pm === 'yarn') return ['yarn'];
  if (pm === 'bun') return ['bun', 'x'];
  return ['npx', '--no-install'];
}

/** Wrapper de Maven/Gradle del proyecto si existe (./mvnw, ./gradlew) o el binario global. */
function javaRunner(dir) {
  if (dir && existsSync(join(dir, 'mvnw'))) return ['./mvnw'];
  if (dir && existsSync(join(dir, 'gradlew'))) return ['./gradlew'];
  return ['mvn'];
}

/**
 * Comando de migración para una app. Devuelve null si la app no tiene herramienta de migraciones
 * (entonces se usa el esquema genérico).
 * @param {object} app App del contrato (`detect`): {path, orm, migrationsDir, packageManager, stack}
 * @param {{root?:string}} [opts] raíz del workspace, para resolver wrappers (./mvnw)
 * @returns {MigrationPlan|null}
 */
export function detectMigrations(app, { root } = {}) {
  if (!app) return null;
  const dir = root ? join(root, ...String(app.path || '.').split('/')) : null;
  const node = nodeRunner(app.packageManager);
  const plan = (tool, argv, envVar) => ({ tool, argv, cwd: app.path || '.', envVar, migrationsDir: app.migrationsDir });

  switch (app.orm) {
    case 'prisma': return plan('prisma', [...node, 'prisma', 'migrate', 'deploy'], 'DATABASE_URL');
    case 'knex': return plan('knex', [...node, 'knex', 'migrate:latest'], 'DATABASE_URL');
    case 'typeorm': return plan('typeorm', [...node, 'typeorm', 'migration:run'], 'DATABASE_URL');
    case 'sequelize': return plan('sequelize', [...node, 'sequelize-cli', 'db:migrate'], 'DATABASE_URL');
    case 'drizzle': return plan('drizzle', [...node, 'drizzle-kit', 'migrate'], 'DATABASE_URL');
    case 'django': return plan('django', ['python', 'manage.py', 'migrate'], 'DATABASE_URL');
    case 'alembic': return plan('alembic', ['alembic', 'upgrade', 'head'], 'DATABASE_URL');
    case 'flyway': return plan('flyway', [...javaRunner(dir), 'flyway:migrate'], 'FLYWAY_URL');
    case 'liquibase': return plan('liquibase', ['liquibase', 'update'], 'LIQUIBASE_COMMAND_URL');
    case 'efcore': return plan('efcore', ['dotnet', 'ef', 'database', 'update'], 'ConnectionStrings__Default');
    case 'laravel-migrations': return plan('laravel', ['php', 'artisan', 'migrate', '--force'], 'DATABASE_URL');
    case 'rails': return plan('rails', ['bin/rails', 'db:migrate'], 'DATABASE_URL');
    case 'goose': return plan('goose', ['goose', '-dir', app.migrationsDir || 'migrations', 'up'], 'GOOSE_DBSTRING');
    case 'golang-migrate': return plan('golang-migrate', ['migrate', '-path', app.migrationsDir || 'migrations', '-database', '$DATABASE_URL', 'up'], 'DATABASE_URL');
    default: break;
  }
  // Sin ORM declarado: se deduce por archivos característicos (apps que `detect` aún no clasificó).
  if (dir) {
    if (existsSync(join(dir, 'prisma', 'schema.prisma'))) return plan('prisma', [...node, 'prisma', 'migrate', 'deploy'], 'DATABASE_URL');
    if (existsSync(join(dir, 'manage.py'))) return plan('django', ['python', 'manage.py', 'migrate'], 'DATABASE_URL');
    if (existsSync(join(dir, 'alembic.ini'))) return plan('alembic', ['alembic', 'upgrade', 'head'], 'DATABASE_URL');
    if (existsSync(join(dir, 'artisan'))) return plan('laravel', ['php', 'artisan', 'migrate', '--force'], 'DATABASE_URL');
  }
  return null;
}

/** Planes de migración de todas las apps (las que tengan herramienta). */
export function migrationPlans(apps = [], opts = {}) {
  return apps.map((a) => detectMigrations(a, opts)).filter(Boolean);
}

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * `mocks/db/migrate.sh` (sh POSIX): corre las migraciones del proyecto en el HOST apuntando a la BD de IA.
 * Si no hay migraciones, explica que se usa el esquema genérico.
 */
export function renderMigrateSh(plans, url, { engine = 'postgres' } = {}) {
  const out = [
    '#!/bin/sh',
    '# Generado por bot-secure — aplica las migraciones del proyecto a la BD de PRUEBAS de IA.',
    '# Se ejecuta en el HOST (no dentro del contenedor): usa las herramientas del proyecto.',
    '# Regenerar con: bot-secure db init',
    'set -eu',
    '',
    `AI_DB_URL=${shQuote(url)}`,
    'AI_ENV=1',
    'export AI_ENV',
    `echo "bot-secure: migraciones contra la BD de IA (${engine})."`,
    '',
  ];
  if (!plans.length) {
    out.push('echo "No se detectaron migraciones en el proyecto: se usa el esquema genérico (bot-secure db up --generic)."', 'exit 0', '');
    return out.join('\n');
  }
  for (const p of plans) {
    out.push(
      `# ${p.tool}${p.migrationsDir ? ` (${p.migrationsDir})` : ''}`,
      '(',
      `  cd ${shQuote(p.cwd)}`,
      `  ${p.envVar}="$AI_DB_URL"`,
      `  export ${p.envVar}`,
      `  echo "  → ${p.tool} en ${p.cwd}"`,
      `  ${p.argv.map(shQuote).join(' ')}`,
      ')',
      '',
    );
  }
  out.push('echo "Listo. Siguiente paso: bot-secure db seed"', '');
  return out.join('\n');
}
