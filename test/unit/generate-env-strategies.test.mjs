// Una estrategia por cada valor de `envStrategy` de src/detect. Lo que se comprueba:
// que existan todas, que lo generado sea texto real (sin plantilla sin renderizar ni `undefined`)
// y que el parche de angular.json sea puro e idempotente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV_STRATEGY } from '../../src/detect/stack.mjs';
import { STRATEGIES, STRATEGY_IDS, patchAngularJson, runCmdAi, strategyFiles, strategyFor } from '../../src/generate/env-strategies/index.mjs';

const POLICY = {
  project: 'tienda',
  db: { engine: 'postgres', port: 5433, database: 'app_ai', user: 'app' },
  apps: [
    { name: 'backend', path: 'backend', kind: 'backend', stack: 'spring', envStrategy: 'spring-profile', port: 8080 },
    { name: 'frontend', path: 'frontend', kind: 'frontend', stack: 'angular', envStrategy: 'angular-environments', port: 4200 },
  ],
};

/** Una app de ejemplo por estrategia (el stack determina las variantes internas). */
const STACK_OF = {
  'angular-environments': 'angular', 'dotenv-native': 'vite', dotenv: 'node', 'expo-config': 'expo',
  'dart-define': 'flutter', 'spring-profile': 'spring', 'appsettings-ai': 'dotnet', 'django-settings': 'django',
  'dotenv-env-local': 'laravel', 'go-loader': 'go', 'php-config': 'php', 'gradle-flavor': 'android',
  xcconfig: 'ios', manual: 'unknown',
};

const appFor = (id) => ({ name: 'app', path: 'app', kind: 'backend', stack: STACK_OF[id], envStrategy: id, port: 8080, packageManager: 'npm' });

test('existe una estrategia por cada envStrategy de src/detect', () => {
  const declaradas = [...new Set(Object.values(ENV_STRATEGY))].sort();
  const faltan = declaradas.filter((id) => !STRATEGY_IDS.includes(id));
  assert.deepEqual(faltan, [], `sin implementación: ${faltan.join(', ')}`);
});

test('un envStrategy desconocido cae en `manual`, nunca en undefined', () => {
  assert.equal(strategyFor({ envStrategy: 'no-existe' }).id, 'manual');
  assert.equal(strategyFor(null).id, 'manual');
  assert.equal(strategyFor({}).id, 'manual');
});

test('cada estrategia genera archivos sin plantilla sin renderizar ni `undefined`', () => {
  for (const id of STRATEGY_IDS) {
    const app = appFor(id);
    const artifacts = strategyFiles(app, POLICY, { apps: POLICY.apps });
    assert.ok(artifacts.length > 0, `${id} no genera nada`);
    for (const a of artifacts) {
      assert.equal(typeof a.path, 'string');
      assert.ok(a.path.startsWith('app'), `${id}: la ruta debe quedar dentro de la app (${a.path})`);
      assert.ok(a.content.length > 0, `${id}: ${a.path} vacío`);
      assert.ok(!a.content.includes('{{'), `${id}: ${a.path} tiene una plantilla sin renderizar`);
      assert.ok(!a.content.includes('[object Object]'), `${id}: ${a.path} serializó un objeto`);
      // `undefined` solo se admite en comparaciones de código (`!== undefined`), nunca como valor.
      const comoValor = a.content.match(/(?<![=!<>])[=:]\s*undefined\b|['"`]undefined['"`]/g);
      assert.equal(comoValor, null, `${id}: ${a.path} escribió undefined como valor (${comoValor})`);
    }
  }
});

test('cada estrategia da un comando de arranque en modo IA y documentación', () => {
  for (const id of STRATEGY_IDS) {
    const app = appFor(id);
    const cmd = runCmdAi(app);
    assert.equal(typeof cmd, 'string');
    assert.ok(cmd.trim().length > 0, `${id} sin comando`);
    const docs = strategyFor(app).docs(app);
    assert.ok(docs.includes(cmd), `${id}: la documentación no menciona el comando de arranque`);
    assert.ok(!docs.includes('undefined'), `${id}: documentación con undefined`);
    const snippet = strategyFor(app).loaderSnippet(app);
    assert.equal(typeof snippet.file, 'string');
    assert.equal(typeof snippet.code, 'string');
  }
});

test('spring mantiene el perfil dev y .NET mantiene Development', () => {
  const spring = { name: 'api', path: 'api', kind: 'backend', stack: 'spring', envStrategy: 'spring-profile' };
  assert.match(runCmdAi(spring), /SPRING_PROFILES_ACTIVE=dev,ai/);

  const files = strategyFiles(spring, POLICY, {});
  const yml = files.find((f) => f.path.endsWith('application-ai.yml')).content;
  assert.match(yml, /\$\{JDBC_DATABASE_URL:\}/, 'las propiedades deben usar ${VAR:} (default vacío)');
  const java = files.find((f) => f.path.endsWith('AiEnv.java')).content;
  assert.match(java, /"1"\.equals\(env\.getProperty\("AI_ENV"\)\)/, 'AiEnv solo actúa con AI_ENV=1');
  assert.match(java, /isBlank\(\)/, 'AiEnv solo rellena propiedades vacías');

  const dotnet = { name: 'api', path: 'api', kind: 'backend', stack: 'dotnet', envStrategy: 'appsettings-ai' };
  const cs = strategyFiles(dotnet, POLICY, {}).find((f) => f.path.endsWith('AiEnv.cs')).content;
  assert.match(cs, /IsNullOrWhiteSpace/, 'solo se rellena lo vacío');
  const program = strategyFor(dotnet).loaderSnippet(dotnet).code;
  assert.match(program, /IsDevelopment\(\)/, 'el entorno sigue siendo Development');
  assert.match(program, /!BotSecure\.AiEnv\.IsAiEnv/, 'con AI_ENV se apagan Swagger y la página de errores');
});

test('el .env.ai de un stack que no lee .env no promete lo que no cumple', () => {
  // Angular no lee .env: su estrategia genera environment.ai.ts, no un cargador de dotenv.
  const app = { name: 'web', path: 'web', kind: 'frontend', stack: 'angular', envStrategy: 'angular-environments' };
  const paths = strategyFiles(app, POLICY, {}).map((f) => f.path);
  assert.ok(paths.some((p) => p.endsWith('environment.ai.ts')), paths.join(', '));
  assert.ok(paths.some((p) => p.endsWith('ai-env.ts')), paths.join(', '));
});

/* --------------------------------- patchAngularJson --------------------------------- */

const ANGULAR_JSON = {
  version: 1,
  projects: { 'web-angular': { architect: { serve: { options: { port: 4200 } } } } },
};

test('patchAngularJson añade la configuración `ai` sin romper el JSON', () => {
  const out = patchAngularJson(ANGULAR_JSON, { project: 'web-angular' });
  const arch = out.projects['web-angular'].architect;
  assert.deepEqual(arch.build.configurations.ai.fileReplacements, [
    { replace: 'src/environments/environment.ts', with: 'src/environments/environment.ai.ts' },
  ]);
  assert.equal(arch.serve.configurations.ai.buildTarget, 'web-angular:build:ai');
  assert.equal(arch.serve.options.port, 4200, 'no debe perder lo que ya estaba');
  assert.equal(out.version, 1);
  // Serializable: si no lo fuera, el artefacto sería inválido.
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test('patchAngularJson es PURA: no muta la entrada', () => {
  const original = JSON.parse(JSON.stringify(ANGULAR_JSON));
  patchAngularJson(ANGULAR_JSON, { project: 'web-angular' });
  assert.deepEqual(ANGULAR_JSON, original, 'la entrada quedó modificada');
});

test('patchAngularJson es IDEMPOTENTE: aplicarla dos veces da lo mismo', () => {
  const una = patchAngularJson(ANGULAR_JSON, { project: 'web-angular' });
  const dos = patchAngularJson(una, { project: 'web-angular' });
  assert.deepEqual(dos, una);
  assert.equal(dos.projects['web-angular'].architect.build.configurations.ai.fileReplacements.length, 1,
    'el fileReplacement no se debe duplicar');
  const tres = patchAngularJson(dos, { project: 'web-angular' });
  assert.deepEqual(tres, dos);
});

test('patchAngularJson respeta browserTarget en proyectos Angular ≤ 16', () => {
  const viejo = {
    projects: { app: { architect: { serve: { configurations: { development: { browserTarget: 'app:build:development' } } } } } },
  };
  const out = patchAngularJson(viejo, { project: 'app' });
  assert.equal(out.projects.app.architect.serve.configurations.ai.browserTarget, 'app:build:ai');
  assert.equal(out.projects.app.architect.serve.configurations.ai.buildTarget, undefined);
});

test('patchAngularJson soporta `targets` (Nx) y un angular.json vacío', () => {
  const nx = { projects: { web: { targets: { build: { executor: '@angular-devkit/build-angular:browser' } } } } };
  const out = patchAngularJson(nx, { project: 'web' });
  assert.ok(out.projects.web.targets.build.configurations.ai);
  assert.equal(out.projects.web.targets.build.executor, '@angular-devkit/build-angular:browser');
  assert.deepEqual(patchAngularJson({}), { projects: {} });
  assert.deepEqual(patchAngularJson(null), { projects: {} });
});

test('la estrategia de Angular parchea el angular.json real del workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'bs-ng-'));
  try {
    mkdirSync(join(root, 'web'), { recursive: true });
    writeFileSync(join(root, 'web', 'angular.json'), JSON.stringify(ANGULAR_JSON, null, 2));
    writeFileSync(join(root, 'web', 'package.json'), JSON.stringify({ name: 'web-angular', scripts: { start: 'ng serve' } }, null, 2));
    const app = { name: 'web-angular', path: 'web', kind: 'frontend', stack: 'angular', envStrategy: 'angular-environments' };
    const files = strategyFiles(app, POLICY, { root, apps: POLICY.apps });

    const angular = JSON.parse(files.find((f) => f.path.endsWith('angular.json')).content);
    assert.ok(angular.projects['web-angular'].architect.build.configurations.ai);

    const pkg = JSON.parse(files.find((f) => f.path.endsWith('package.json')).content);
    assert.equal(pkg.scripts['start:ai'], 'ng serve -c ai');
    assert.equal(pkg.scripts.start, 'ng serve', 'no debe pisar los scripts existentes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
