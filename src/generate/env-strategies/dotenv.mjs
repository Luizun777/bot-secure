// Node / Nest / Express (node --env-file=.env.ai) y FastAPI / Flask / Python (python-dotenv).
import { aiContext, appVars, banner, docsBlock, esc, file, packageScripts } from './_common.mjs';

export const id = 'dotenv';

const PY = new Set(['fastapi', 'flask', 'python', 'django']);
const isPython = (app) => PY.has(app?.stack);

function aiEnvTs(c) {
  const rows = [['API_URL', c.apiUrl], ['DATABASE_URL', c.dbUrl], ['OIDC_ISSUER', c.issuer],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name, v.value])];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('//'),
    '// Valores del ambiente de IA (respaldo de .env.ai; falsos pero válidos por formato).',
    'const AI_VALUES: Readonly<Record<string, string>> = {',
    ...uniq.map(([k, v]) => `  '${esc(k)}': '${esc(v)}',`),
    '};',
    '',
    "export const IS_AI_ENV = process.env.AI_ENV === '1';",
    '',
    '/**',
    ' * Regla del campo vacío: vacío + AI_ENV=1 → valor de .env.ai; vacío sin AI_ENV → error claro.',
    ' * @param name nombre de la variable de entorno',
    ' */',
    'export function aiEnv(name: string): string {',
    "  const v = process.env[name] ?? '';",
    '  if (v) return v;',
    '  if (IS_AI_ENV && AI_VALUES[name] !== undefined) return AI_VALUES[name];',
    '  throw new Error(',
    '    `[bot-secure] Falta ${name}. En el ambiente de IA viene de .env.ai; en dev/qa/prd, del entorno. ` +',
    "    'Arreglo: npm run start:ai',",
    '  );',
    '}',
    '',
  ].join('\n');
}

function aiEnvPy(c) {
  const rows = [['API_URL', c.apiUrl], ['DATABASE_URL', c.dbUrl], ['OIDC_ISSUER', c.issuer],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name, v.value])];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('#'),
    '"""Cargador del ambiente de IA: .env.ai + la regla del campo vacío."""',
    'import os',
    'from pathlib import Path',
    '',
    'AI_VALUES = {',
    ...uniq.map(([k, v]) => `    "${esc(k)}": "${esc(v)}",`),
    '}',
    '',
    '',
    'def load_ai_env(path: str = ".env.ai") -> None:',
    '    """Carga .env.ai sin dependencias (python-dotenv es opcional). No pisa el entorno real."""',
    '    p = Path(path)',
    '    if not p.exists():',
    '        return',
    '    for raw in p.read_text(encoding="utf-8").splitlines():',
    '        line = raw.strip()',
    '        if not line or line.startswith("#") or "=" not in line:',
    '            continue',
    '        name, _, value = line.partition("=")',
    '        value = value.split(" #", 1)[0].strip().strip("\'\\"")',
    '        os.environ.setdefault(name.strip(), value)',
    '',
    '',
    'IS_AI_ENV = os.environ.get("AI_ENV") == "1"',
    '',
    '',
    'def ai_env(name: str) -> str:',
    '    """Vacío + AI_ENV=1 → valor de .env.ai; vacío sin AI_ENV → error claro."""',
    '    value = os.environ.get(name, "")',
    '    if value:',
    '        return value',
    '    if IS_AI_ENV and name in AI_VALUES:',
    '        return AI_VALUES[name]',
    '    raise RuntimeError(',
    '        f"[bot-secure] Falta {name}. En el ambiente de IA viene de .env.ai; "',
    '        f"en dev/qa/prd, del entorno. Arreglo: AI_ENV=1 python -c \'import ai_env; ai_env.load_ai_env()\'"',
    '    )',
    '',
    '',
    'if IS_AI_ENV:',
    '    load_ai_env()',
    '',
  ].join('\n');
}

export function runCmdAi(app) {
  if (isPython(app)) {
    if (app?.stack === 'flask') return 'AI_ENV=1 flask run';
    return 'AI_ENV=1 uvicorn main:app --reload';
  }
  return 'npm run start:ai';
}

export function loaderSnippet(app) {
  if (isPython(app)) {
    return {
      file: 'main.py',
      lang: 'python',
      code: ['from ai_env import ai_env, load_ai_env', '', 'load_ai_env()', 'DATABASE_URL = ai_env("DATABASE_URL")'].join('\n'),
    };
  }
  return {
    file: 'src/ai-env.ts',
    lang: 'ts',
    code: ["import { aiEnv } from './ai-env';", '', "const dbUrl = aiEnv('DATABASE_URL');"].join('\n'),
  };
}

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  if (isPython(app)) return [file(app, 'ai_env.py', aiEnvPy(c))];
  const out = [file(app, 'src/ai-env.ts', aiEnvTs(c))];
  // `--run` ejecuta el script del propio package.json: respeta el comando que ya usa el equipo.
  const pkg = packageScripts(app, ctx, {
    'start:ai': 'node --env-file=.env.ai --run start',
    'test:ai': 'node --env-file=.env.ai --run test',
  });
  if (pkg) out.push(pkg);
  return out;
}

export function docs(app) {
  const py = isPython(app);
  return docsBlock({
    title: `${app?.stack ?? 'node'} (${app?.name ?? 'app'})`,
    runCmd: runCmdAi(app),
    files: py ? ['.env.ai', 'ai_env.py'] : ['.env.ai', 'src/ai-env.ts', 'package.json (scripts `start:ai`/`test:ai`)'],
    notes: py
      ? ['`load_ai_env()` usa `os.environ.setdefault`: nunca pisa una variable real del entorno.',
        'Si usas `python-dotenv`, `load_dotenv(".env.ai")` es equivalente.']
      : ['`node --env-file=.env.ai` no necesita ninguna dependencia (Node ≥ 20).',
        'Si usas `dotenv`, `dotenv -e .env.ai --` hace lo mismo.'],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
