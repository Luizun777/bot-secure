// Comandos de arranque/pruebas y ORM+migraciones por fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectCommands, detectOrm, detectStack, detectSdks, detectSecretManagers, detectRegistries } from '../../src/detect/index.mjs';

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'projects');
const dir = (n) => join(PROJECTS, n);
const cmds = (n) => detectCommands(dir(n), detectStack(dir(n)));

/** [fixture, runCmd, testCmd] */
const CASOS = [
  ['node-express', 'npm run dev', 'npm test'],
  ['react-vite', 'npm run dev', 'npm test'],
  ['nextjs', 'npm run dev', 'npm test'],
  ['angular', 'npm start', 'npm test'],
  ['spring', './mvnw spring-boot:run', './mvnw -q test'],
  ['dotnet', 'dotnet run --project Api.csproj', 'dotnet test'],
  ['go', 'go run .', 'go test ./...'],
  ['laravel', 'php artisan serve', 'php artisan test'],
  ['django', 'python manage.py runserver', 'python manage.py test'],
  ['fastapi', 'uvicorn main:app --reload', 'pytest'],
  ['flutter', 'flutter run', 'flutter test'],
  ['android', './gradlew installDebug', './gradlew testDebugUnitTest'],
  ['php', 'php -S 127.0.0.1:8080', undefined],
];

for (const [fixture, runCmd, testCmd] of CASOS) {
  test(`detectCommands ${fixture}: arranque y pruebas`, () => {
    const c = cmds(fixture);
    assert.equal(c.runCmd, runCmd, 'runCmd');
    assert.equal(c.testCmd, testCmd, 'testCmd');
  });
}

test('ios solo tiene build y test (no hay servidor que arrancar)', () => {
  const c = cmds('ios');
  assert.equal(c.runCmd, undefined);
  assert.equal(c.testCmd, 'xcodebuild test');
});

test('el comando de prueba de UN archivo lleva el marcador {file}', () => {
  assert.equal(cmds('node-express').testFileCmd, 'node --test {file}');
  assert.equal(cmds('react-vite').testFileCmd, 'npx vitest run {file}');
  assert.equal(cmds('nextjs').testFileCmd, 'npx jest {file}');
  assert.equal(cmds('spring').testFileCmd, './mvnw -q -Dtest={file} test');
  assert.equal(cmds('django').testFileCmd, 'python manage.py test {file}');
  for (const [fixture] of CASOS) {
    const t = cmds(fixture).testFileCmd;
    if (t) assert.match(t, /\{file\}/, `${fixture}: testFileCmd sin {file}`);
  }
});

/** [fixture, orm, migrationsDir] */
const ORM = [
  ['node-express', 'knex', 'migrations'],
  ['spring', 'flyway', 'src/main/resources/db/migration'],
  ['dotnet', 'efcore', 'Migrations'],
  ['django', 'django', 'tienda/migrations'],
  ['fastapi', 'alembic', 'alembic/versions'],
  ['laravel', 'laravel-migrations', 'database/migrations'],
  ['go', 'goose', 'migrations'],
];

for (const [fixture, orm, migrationsDir] of ORM) {
  test(`detectOrm ${fixture}: ${orm}`, () => {
    assert.deepEqual(detectOrm(dir(fixture)), { orm, migrationsDir });
  });
}

test('un frontend sin ORM devuelve objeto vacío', () => {
  assert.deepEqual(detectOrm(dir('react-vite')), {});
});

test('detectSdks reconoce SDKs con llaves y no inventa otros', () => {
  assert.deepEqual(detectSdks(dir('node-express')), ['stripe']);
  assert.deepEqual(detectSdks(dir('react-vite')), []);
});

test('sin configuración privada no hay registries ni gestores de secretos', () => {
  assert.deepEqual(detectRegistries(dir('nextjs')), []);
  assert.deepEqual(detectSecretManagers(dir('nextjs')), []);
});
