// Workspace de IA: creación, registro de apps (clon y subcarpeta), estado y mapa de apps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { git } from '../../src/lib/exec.mjs';
import { readJson } from '../../src/lib/fsx.mjs';
import { validatePolicy } from '../../src/policy/index.mjs';
import { addApp, appMap, cloneWorkspace, createWorkspace, loadPolicyFile, status } from '../../src/workspace/index.mjs';
import { limpiar, makeRepo, PROJECTS } from '../fixtures/workspaces/repos.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'bs-ws-'));
const policyOf = (root) => readJson(join(root, '.bot-secure', 'policy.json'));

test('createWorkspace crea <nombre>-ai con git, .gitignore y política válida', async () => {
  const base = tmp();
  try {
    const root = await createWorkspace('tienda', { cwd: base });
    assert.equal(basename(root), 'tienda-ai');
    assert.ok(existsSync(join(root, '.git')), 'debe ser un repo git');
    assert.ok(existsSync(join(root, '.gitignore')));
    const policy = policyOf(root);
    assert.equal(policy.project, 'tienda');
    assert.deepEqual(policy.apps, []);
    assert.deepEqual(validatePolicy(policy), [], 'la política inicial debe ser válida');
    assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /\.bot-secure\/local\.json/);
  } finally { limpiar(base); }
});

test('createWorkspace no duplica el sufijo -ai y rechaza nombres con rutas', async () => {
  const base = tmp();
  try {
    const root = await createWorkspace('tienda-ai', { cwd: base });
    assert.equal(basename(root), 'tienda-ai');
    await assert.rejects(() => createWorkspace(join('a', 'b'), { cwd: base }), (e) => {
      assert.equal(e.key, 'workspace.badName');
      assert.ok(e.fix);
      return true;
    });
  } finally { limpiar(base); }
});

test('createWorkspace falla con arreglo si la carpeta ya tiene contenido', async () => {
  const base = tmp();
  try {
    mkdirSync(join(base, 'tienda-ai'), { recursive: true });
    writeFileSync(join(base, 'tienda-ai', 'algo.txt'), 'contenido\n');
    await assert.rejects(() => createWorkspace('tienda', { cwd: base }), (e) => {
      assert.equal(e.key, 'workspace.exists');
      assert.match(e.fix, /workspace status/);
      return true;
    });
  } finally { limpiar(base); }
});

test('addApp clona un repo en la rama ai-dev, lo registra y lo ignora en git', async () => {
  const base = tmp();
  try {
    const origen = makeRepo(join(base, 'tienda-api'), { fixture: 'spring' });
    const root = await createWorkspace('tienda', { cwd: base });
    const app = addApp(root, origen, { kind: 'backend' });

    assert.equal(app.name, 'backend');
    assert.equal(app.path, 'backend');
    assert.equal(app.stack, 'spring');
    assert.equal(app.envStrategy, 'spring-profile');
    assert.equal(app.branch, 'ai-dev');
    assert.equal(app.remote, origen);
    assert.ok(existsSync(join(root, 'backend', 'pom.xml')));
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: join(root, 'backend') }).stdout.trim(), 'ai-dev');

    const policy = policyOf(root);
    assert.equal(policy.apps.length, 1);
    assert.deepEqual(validatePolicy(policy), []);
    assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^backend\/$/m, 'el clon se ignora en el repo del workspace');
  } finally { limpiar(base); }
});

test('addApp registra una subcarpeta ya existente sin clonar', async () => {
  const base = tmp();
  try {
    const root = await createWorkspace('tienda', { cwd: base });
    cpSync(join(PROJECTS, 'angular'), join(root, 'frontend'), { recursive: true });
    const app = addApp(root, 'frontend', { kind: 'frontend' });
    assert.equal(app.name, 'frontend');
    assert.equal(app.path, 'frontend');
    assert.equal(app.stack, 'angular');
    assert.equal(app.port, 4200);
    assert.equal(app.remote, undefined, 'una subcarpeta local no tiene remoto');
    assert.doesNotMatch(readFileSync(join(root, '.gitignore'), 'utf8'), /^frontend\/$/m);
  } finally { limpiar(base); }
});

test('addApp rechaza dos apps con el mismo nombre y propone otro', async () => {
  const base = tmp();
  try {
    const root = await createWorkspace('tienda', { cwd: base });
    cpSync(join(PROJECTS, 'angular'), join(root, 'frontend'), { recursive: true });
    addApp(root, 'frontend', { kind: 'frontend' });
    assert.throws(() => addApp(root, 'frontend', { kind: 'frontend' }), (e) => {
      assert.equal(e.key, 'workspace.appExists');
      assert.match(e.fix, /--name/);
      return true;
    });
  } finally { limpiar(base); }
});

test('el frontend declara dependencia del backend ya registrado', async () => {
  const base = tmp();
  try {
    const origen = makeRepo(join(base, 'tienda-api'), { fixture: 'spring' });
    const root = await createWorkspace('tienda', { cwd: base });
    addApp(root, origen, { kind: 'backend' });
    cpSync(join(PROJECTS, 'angular'), join(root, 'frontend'), { recursive: true });
    const front = addApp(root, 'frontend', { kind: 'frontend' });
    assert.deepEqual(front.dependsOn, ['backend']);
  } finally { limpiar(base); }
});

test('status informa rama, cambios y apps que faltan', async () => {
  const base = tmp();
  try {
    const origen = makeRepo(join(base, 'tienda-api'), { fixture: 'spring' });
    const root = await createWorkspace('tienda', { cwd: base });
    addApp(root, origen, { kind: 'backend' });

    let filas = status(root);
    assert.equal(filas.length, 1);
    assert.deepEqual({ app: filas[0].app, branch: filas[0].branch, dirty: filas[0].dirty, ok: filas[0].ok }, { app: 'backend', branch: 'ai-dev', dirty: false, ok: true });

    writeFileSync(join(root, 'backend', 'pom.xml'), readFileSync(join(root, 'backend', 'pom.xml'), 'utf8') + '\n<!-- cambio local -->\n');
    filas = status(root);
    assert.equal(filas[0].dirty, true);

    const policy = loadPolicyFile(root);
    policy.apps.push({ name: 'perdida', path: 'perdida', kind: 'backend', stack: 'node', branch: 'ai-dev' });
    writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify(policy, null, 2));
    const perdida = status(root).find((f) => f.app === 'perdida');
    assert.equal(perdida.missing, true);
    assert.equal(perdida.ok, false);
  } finally { limpiar(base); }
});

test('cloneWorkspace reproduce las apps con remoto y respeta las que ya están', async () => {
  const base = tmp();
  try {
    const origen = makeRepo(join(base, 'tienda-api'), { fixture: 'spring' });
    const root = await createWorkspace('tienda', { cwd: base });
    addApp(root, origen, { kind: 'backend' });
    assert.deepEqual(cloneWorkspace(root), [{ app: 'backend', action: 'exists' }]);

    // Otra máquina: mismo policy.json, sin las carpetas clonadas.
    const otra = join(base, 'copia-ai');
    mkdirSync(join(otra, '.bot-secure'), { recursive: true });
    writeFileSync(join(otra, '.bot-secure', 'policy.json'), readFileSync(join(root, '.bot-secure', 'policy.json'), 'utf8'));
    assert.deepEqual(cloneWorkspace(otra), [{ app: 'backend', action: 'cloned' }]);
    assert.ok(existsSync(join(otra, 'backend', 'pom.xml')));
  } finally { limpiar(base); }
});

test('appMap describe cada app con stack, puerto, arranque, pruebas y consumo', () => {
  const policy = {
    lang: 'es',
    apps: [
      { name: 'backend', path: 'backend', kind: 'backend', stack: 'spring', port: 8080, runCmd: './mvnw spring-boot:run', testCmd: './mvnw -q test' },
      { name: 'frontend', path: 'frontend', kind: 'frontend', stack: 'angular', port: 4200, runCmd: 'npm start', testCmd: 'npm test', dependsOn: ['backend'] },
    ],
  };
  const mapa = appMap(policy).split('\n');
  assert.equal(mapa[0], '- backend → ./backend (Spring Boot, :8080) · arranque: ./mvnw spring-boot:run · pruebas: ./mvnw -q test');
  assert.equal(mapa[1], '- frontend → ./frontend (Angular, :4200) · arranque: npm start · pruebas: npm test · consume: http://localhost:8080');
  assert.match(appMap({ apps: [] }), /workspace add/);
});

test('loadPolicyFile falla con el comando de creación si no hay workspace', () => {
  const base = tmp();
  try {
    assert.throws(() => loadPolicyFile(base), (e) => {
      assert.equal(e.key, 'workspace.noPolicy');
      assert.match(e.fix, /workspace create/);
      return true;
    });
  } finally { limpiar(base); }
});
