// ORM / herramienta de migraciones y carpeta de migraciones (para `db` y el mapa de apps).
import { join } from 'node:path';
import { readText, fileExists, dirExists, findDirs, listDir } from './manifests.mjs';
import { collectDeps } from './deps.mjs';

/**
 * @returns {{orm?:string, migrationsDir?:string}} rutas relativas posix
 */
export function detectOrm(dir) {
  const deps = collectDeps(dir);
  const has = (...names) => names.some((n) => deps.has(n));
  const existing = (...cands) => cands.find((c) => dirExists(join(dir, ...c.split('/'))));
  const out = (orm, migrationsDir) => (migrationsDir ? { orm, migrationsDir } : { orm });

  if (has('prisma', '@prisma/client') || fileExists(join(dir, 'prisma', 'schema.prisma'))) return out('prisma', existing('prisma/migrations') ?? 'prisma/migrations');
  if (has('typeorm')) return out('typeorm', existing('src/migrations', 'src/database/migrations', 'migrations'));
  if (has('knex')) return out('knex', knexDir(dir) ?? existing('migrations', 'db/migrations'));
  if (has('sequelize', 'sequelize-cli')) return out('sequelize', existing('migrations', 'db/migrations'));
  if (has('drizzle-orm')) return out('drizzle', existing('drizzle', 'migrations'));
  if (has('mongoose')) return out('mongoose');
  if (fileExists(join(dir, 'alembic.ini')) || has('alembic')) return out('alembic', alembicDir(dir));
  if (fileExists(join(dir, 'manage.py')) || has('django')) return out('django', findDirs(dir, 'migrations', 2)[0]);
  if (has('sqlalchemy')) return out('sqlalchemy');
  if (has('flyway-core', 'flyway-database-postgresql', 'flyway-mysql', 'org.flywaydb') || [...deps].some((d) => d.includes('flyway'))) return out('flyway', existing('src/main/resources/db/migration') ?? 'src/main/resources/db/migration');
  if ([...deps].some((d) => d.includes('liquibase'))) return out('liquibase', existing('src/main/resources/db/changelog') ?? 'src/main/resources/db/changelog');
  if ([...deps].some((d) => d.startsWith('microsoft.entityframeworkcore'))) return out('efcore', existing('Migrations', 'Data/Migrations') ?? 'Migrations');
  if (fileExists(join(dir, 'artisan'))) return out('laravel-migrations', existing('database/migrations') ?? 'database/migrations');
  if (has('rails', 'activerecord')) return out('rails', existing('db/migrate') ?? 'db/migrate');
  if (has('github.com/pressly/goose/v3', 'github.com/pressly/goose')) return out('goose', existing('migrations', 'db/migrations'));
  if ([...deps].some((d) => d.startsWith('github.com/golang-migrate/migrate'))) return out('golang-migrate', existing('migrations', 'db/migrations'));
  if (has('gorm.io/gorm')) return out('gorm');
  if (has('spring-boot-starter-data-jpa')) return out('jpa');
  return {};
}

function knexDir(dir) {
  for (const f of listDir(dir)) {
    if (!/^knexfile\.(js|cjs|mjs|ts)$/.test(f.name)) continue;
    const m = /directory\s*:\s*['"]\.?\/?([^'"]+)['"]/.exec(readText(join(dir, f.name)) ?? '');
    if (m) return m[1].replace(/\/+$/, '');
  }
  return null;
}

function alembicDir(dir) {
  const m = /^script_location\s*=\s*(.+)$/m.exec(readText(join(dir, 'alembic.ini')) ?? '');
  const base = (m ? m[1].trim() : 'alembic').replace(/\\/g, '/');
  return `${base}/versions`;
}
