// Un caso por fixture de test/fixtures/projects: stack, kind, envStrategy, gestor y puerto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack, detectKind, envStrategyFor, detectPackageManager, detectPort, hasDockerfile, ENV_STRATEGY } from '../../src/detect/index.mjs';

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'projects');
const dir = (n) => join(PROJECTS, n);

/** [fixture, stack, kind, envStrategy, packageManager, puerto esperado (null = sin puerto)] */
const CASOS = [
  ['node-express', 'node', 'backend', 'dotenv', 'npm', 3000],
  ['react-vite', 'vite', 'frontend', 'dotenv-native', 'npm', 5173],
  ['nextjs', 'next', 'frontend', 'dotenv-native', 'npm', 3000],
  ['angular', 'angular', 'frontend', 'angular-environments', 'npm', 4200],
  ['spring', 'spring', 'backend', 'spring-profile', 'maven', 8081],
  ['dotnet', 'dotnet', 'backend', 'appsettings-ai', 'dotnet', 5080],
  ['go', 'go', 'backend', 'go-loader', 'go', 8080],
  ['laravel', 'laravel', 'backend', 'dotenv-env-local', 'composer', 8000],
  ['django', 'django', 'backend', 'django-settings', 'pip', 8000],
  ['fastapi', 'fastapi', 'backend', 'dotenv', 'pip', 8000],
  ['flutter', 'flutter', 'mobile', 'dart-define', 'pub', null],
  ['android', 'android', 'mobile', 'gradle-flavor', 'gradle', null],
  ['ios', 'ios', 'mobile', 'xcconfig', 'cocoapods', null],
  ['php', 'php', 'backend', 'php-config', 'composer', 8080],
];

for (const [fixture, stack, kind, envStrategy, pm, port] of CASOS) {
  test(`detect ${fixture}: stack, kind, envStrategy, gestor y puerto`, () => {
    const d = dir(fixture);
    assert.equal(detectStack(d), stack, 'stack');
    assert.equal(detectKind(d), kind, 'kind');
    assert.equal(envStrategyFor(detectStack(d)), envStrategy, 'envStrategy');
    assert.equal(detectPackageManager(d), pm, 'packageManager');
    assert.equal(detectPort(d) ?? null, port, 'puerto');
  });
}

test('el puerto sale de la configuración del proyecto, no solo del default del stack', () => {
  // spring: application.yml dice 8081 (el default del stack es 8080)
  assert.equal(detectPort(dir('spring')), 8081);
  // dotnet: launchSettings.json dice 5080 (el default es 5000)
  assert.equal(detectPort(dir('dotnet')), 5080);
});

test('una carpeta sin manifiestos es stack desconocido y estrategia manual', () => {
  const vacio = join(PROJECTS, 'no-existe-esta-carpeta');
  assert.equal(detectStack(vacio), 'unknown');
  assert.equal(detectKind(vacio), 'unknown');
  assert.equal(envStrategyFor(detectStack(vacio)), 'manual');
});

test('cada stack conocido tiene estrategia de entorno declarada', () => {
  const stacks = CASOS.map(([, s]) => s);
  for (const s of stacks) assert.ok(ENV_STRATEGY[s], `falta envStrategy para ${s}`);
  assert.equal(envStrategyFor('stack-inventado'), 'manual');
});

test('hasDockerfile distingue proyectos con y sin Dockerfile', () => {
  assert.equal(hasDockerfile(dir('spring')), false);
});
