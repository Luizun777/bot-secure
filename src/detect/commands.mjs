// Comandos de arranque/test/build/lint por stack. Fuentes: scripts, Makefile, wrappers, CI.
import { join } from 'node:path';
import { readJsonSafe, readText, fileExists, filesWithExt, pkgDeps, listDir, findFile } from './manifests.mjs';
import { detectPackageManager } from './stack.mjs';

/**
 * @typedef {{runCmd?:string, testCmd?:string, buildCmd?:string, lintCmd?:string, testFileCmd?:string}} Commands
 * testFileCmd: prueba de UN archivo/clase con el marcador `{file}` (se rellena al usarlo).
 */

/** @returns {Commands} */
export function detectCommands(dir, stack) {
  const cmds = byStack(dir, stack);
  fromMakefile(dir, cmds);
  fromCi(dir, cmds);
  return prune(cmds);
}

function prune(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v)); }

function pmRun(pm, script) {
  if (pm === 'yarn') return `yarn ${script}`;
  if (pm === 'pnpm') return `pnpm ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return script === 'start' || script === 'test' ? `npm ${script}` : `npm run ${script}`;
}

function nodeCommands(dir, stack) {
  const pkg = readJsonSafe(join(dir, 'package.json')) ?? {};
  const scripts = pkg.scripts ?? {};
  const pm = detectPackageManager(dir, stack);
  const first = (...names) => names.find((n) => scripts[n]);
  const run = first('dev', 'start:dev', 'serve', 'start');
  const test = first('test', 'test:unit');
  const build = first('build');
  const lint = first('lint');
  const deps = new Set(pkgDeps(pkg));
  let testFileCmd;
  if (deps.has('vitest')) testFileCmd = 'npx vitest run {file}';
  else if (deps.has('jest')) testFileCmd = 'npx jest {file}';
  else if (deps.has('mocha')) testFileCmd = 'npx mocha {file}';
  else if (stack === 'angular') testFileCmd = 'npx ng test --watch=false --include={file}';
  else if (/node --test/.test(scripts.test ?? '')) testFileCmd = 'node --test {file}';
  return {
    runCmd: run ? pmRun(pm, run) : undefined,
    testCmd: test ? pmRun(pm, test) : undefined,
    buildCmd: build ? pmRun(pm, build) : undefined,
    lintCmd: lint ? pmRun(pm, lint) : undefined,
    testFileCmd,
  };
}

function javaCommands(dir, stack) {
  const maven = fileExists(join(dir, 'pom.xml'));
  const wrapper = maven ? (fileExists(join(dir, 'mvnw')) ? './mvnw' : 'mvn') : (fileExists(join(dir, 'gradlew')) ? './gradlew' : 'gradle');
  const runGoal = { spring: maven ? 'spring-boot:run' : 'bootRun', quarkus: maven ? 'quarkus:dev' : 'quarkusDev', micronaut: maven ? 'mn:run' : 'run' }[stack];
  return {
    runCmd: runGoal ? `${wrapper} ${runGoal}` : undefined,
    testCmd: maven ? `${wrapper} -q test` : `${wrapper} test`,
    buildCmd: maven ? `${wrapper} -q -DskipTests package` : `${wrapper} build -x test`,
    testFileCmd: maven ? `${wrapper} -q -Dtest={file} test` : `${wrapper} test --tests {file}`,
  };
}

function dotnetCommands(dir) {
  const proj = filesWithExt(dir, '.csproj')[0];
  const projArg = proj ? ` --project ${proj}` : '';
  return { runCmd: `dotnet run${projArg}`, testCmd: 'dotnet test', buildCmd: 'dotnet build', testFileCmd: 'dotnet test --filter FullyQualifiedName~{file}' };
}

function pythonCommands(dir, stack) {
  const reqs = ['requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'Pipfile'].map((f) => readText(join(dir, f)) ?? '').join('\n').toLowerCase();
  const pytest = /\bpytest\b/.test(reqs);
  const test = stack === 'django' && !pytest ? 'python manage.py test' : 'pytest';
  const testFile = stack === 'django' && !pytest ? 'python manage.py test {file}' : 'pytest {file}';
  let run;
  if (stack === 'django') run = 'python manage.py runserver';
  else if (stack === 'fastapi') run = `uvicorn ${fastapiModule(dir)} --reload`;
  else if (stack === 'flask') run = 'flask run';
  return { runCmd: run, testCmd: test, testFileCmd: testFile, lintCmd: /\bruff\b/.test(reqs) ? 'ruff check .' : undefined };
}

function fastapiModule(dir) {
  if (fileExists(join(dir, 'main.py'))) return 'main:app';
  if (fileExists(join(dir, 'app', 'main.py'))) return 'app.main:app';
  if (fileExists(join(dir, 'src', 'main.py'))) return 'src.main:app';
  return 'main:app';
}

function byStack(dir, stack) {
  switch (stack) {
    case 'angular': case 'next': case 'nuxt': case 'nest': case 'expo': case 'react-native':
    case 'cra': case 'svelte': case 'vue': case 'vite': case 'node':
      return nodeCommands(dir, stack);
    case 'spring': case 'quarkus': case 'micronaut': case 'java': return javaCommands(dir, stack);
    case 'dotnet': return dotnetCommands(dir);
    case 'django': case 'fastapi': case 'flask': case 'python': return pythonCommands(dir, stack);
    case 'laravel': return { runCmd: 'php artisan serve', testCmd: 'php artisan test', testFileCmd: 'php artisan test {file}' };
    case 'symfony': return { runCmd: 'php -S 127.0.0.1:8000 -t public', testCmd: 'php bin/phpunit', testFileCmd: 'php bin/phpunit {file}' };
    case 'php': return { runCmd: 'php -S 127.0.0.1:8080', testCmd: fileExists(join(dir, 'phpunit.xml')) ? 'vendor/bin/phpunit' : undefined };
    case 'rails': return { runCmd: 'bin/rails server', testCmd: 'bin/rails test', testFileCmd: 'bin/rails test {file}' };
    case 'go': return { runCmd: 'go run .', testCmd: 'go test ./...', buildCmd: 'go build ./...', lintCmd: 'go vet ./...', testFileCmd: 'go test {file}' };
    case 'flutter': return { runCmd: 'flutter run', testCmd: 'flutter test', buildCmd: 'flutter build apk --debug', lintCmd: 'flutter analyze', testFileCmd: 'flutter test {file}' };
    case 'android': {
      const w = fileExists(join(dir, 'gradlew')) ? './gradlew' : 'gradle';
      return { runCmd: `${w} installDebug`, testCmd: `${w} testDebugUnitTest`, buildCmd: `${w} assembleDebug`, lintCmd: `${w} lint`, testFileCmd: `${w} testDebugUnitTest --tests {file}` };
    }
    case 'ios': return { buildCmd: 'xcodebuild build', testCmd: 'xcodebuild test' };
    default: return {};
  }
}

/** Rellena huecos con targets del Makefile (run/dev/start/test/build/lint). */
function fromMakefile(dir, cmds) {
  const mk = readText(join(dir, 'Makefile'));
  if (!mk) return;
  const targets = new Set([...mk.matchAll(/^([A-Za-z0-9_.-]+):(?!=)/gm)].map((m) => m[1]));
  const pick = (...names) => names.find((n) => targets.has(n));
  if (!cmds.runCmd) { const t = pick('dev', 'run', 'start', 'serve'); if (t) cmds.runCmd = `make ${t}`; }
  if (!cmds.testCmd) { const t = pick('test', 'tests'); if (t) cmds.testCmd = `make ${t}`; }
  if (!cmds.buildCmd) { const t = pick('build'); if (t) cmds.buildCmd = `make ${t}`; }
  if (!cmds.lintCmd) { const t = pick('lint'); if (t) cmds.lintCmd = `make ${t}`; }
}

/** Último recurso: el comando de test de los workflows de CI. */
function fromCi(dir, cmds) {
  if (cmds.testCmd) return;
  const wf = join(dir, '.github', 'workflows');
  for (const f of listDir(wf)) {
    if (!/\.ya?ml$/.test(f.name)) continue;
    const txt = readText(join(wf, f.name)) ?? '';
    const m = /^\s*run:\s*(?:\|\s*\n\s*)?([^\n]*\btest\b[^\n]*)/m.exec(txt);
    if (m) { cmds.testCmd = m[1].trim(); return; }
  }
  const gl = readText(join(dir, '.gitlab-ci.yml'));
  const m = gl && /^\s*-\s*([^\n]*\btest\b[^\n]*)/m.exec(gl);
  if (m) cmds.testCmd = m[1].trim();
  // Evita reportar "test" sin contexto si no hay nada útil
  if (cmds.testCmd && !findFile(dir, 'package.json', 0) && cmds.testCmd.length < 4) delete cmds.testCmd;
}
