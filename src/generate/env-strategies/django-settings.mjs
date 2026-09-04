// Django: settings/ai.py + ai_env.py. `AI_ENV=1 python manage.py runserver`.
import { aiContext, appVars, banner, docsBlock, esc, file } from './_common.mjs';

export const id = 'django-settings';

function aiEnvPy(c) {
  const rows = [
    ['DATABASE_URL', c.dbUrl], ['API_URL', c.apiUrl], ['OIDC_ISSUER', c.issuer], ['OIDC_JWKS_URI', c.jwks],
    ['DB_HOST', c.db.host || '127.0.0.1'], ['DB_PORT', String(c.db.port || '5433')],
    ['DB_NAME', c.db.database || 'app_ai'], ['DB_USER', c.db.user || 'app'],
    ['DB_PASSWORD', c.db.password || '__AI_PLACEHOLDER__DB_PASSWORD__'],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name, v.value]),
  ];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('#'),
    '"""Cargador del ambiente de IA para Django: .env.ai + la regla del campo vacío."""',
    'import os',
    'from pathlib import Path',
    '',
    'AI_VALUES = {',
    ...uniq.map(([k, v]) => `    "${esc(k)}": "${esc(v)}",`),
    '}',
    '',
    'IS_AI_ENV = os.environ.get("AI_ENV") == "1"',
    '',
    '',
    'def load_ai_env(path: str = ".env.ai") -> None:',
    '    """Carga .env.ai en os.environ sin pisar lo que ya venga del entorno real."""',
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
    'def ai_env(name: str, current: str = "") -> str:',
    '    """Vacío + AI_ENV=1 → valor de IA; vacío sin AI_ENV → error claro con el nombre del campo."""',
    '    if current:',
    '        return current',
    '    value = os.environ.get(name, "")',
    '    if value:',
    '        return value',
    '    if IS_AI_ENV and name in AI_VALUES:',
    '        return AI_VALUES[name]',
    '    raise RuntimeError(',
    '        f"[bot-secure] Falta {name}. En el ambiente de IA viene de .env.ai "',
    '        f"(AI_ENV=1 python manage.py runserver); en dev/qa/prd, del entorno."',
    '    )',
    '',
    '',
    'if IS_AI_ENV:',
    '    load_ai_env()',
    '',
  ].join('\n');
}

function settingsAiPy(c) {
  return [
    banner('#'),
    '"""Overlay del ambiente de IA. Úsalo así:',
    '',
    '    DJANGO_SETTINGS_MODULE=settings.ai AI_ENV=1 python manage.py runserver',
    '',
    'o añade al final de tu settings.py:',
    '',
    '    from ai_env import apply_ai_env',
    '    apply_ai_env(globals())',
    '"""',
    'import os',
    '',
    'from ai_env import IS_AI_ENV, ai_env, load_ai_env  # noqa: F401',
    '',
    'load_ai_env()',
    '',
    'DEBUG = True',
    'ALLOWED_HOSTS = ["localhost", "127.0.0.1"]',
    `CORS_ALLOWED_ORIGINS = ["${esc(c.frontendUrl)}"]`,
    '',
    '# Base de datos de PRUEBAS del workspace (Docker/Podman, solo 127.0.0.1). Datos sintéticos.',
    'DATABASES = {',
    '    "default": {',
    `        "ENGINE": "django.db.backends.${c.db.engine === 'mysql' ? 'mysql' : 'postgresql'}",`,
    `        "NAME": ai_env("DB_NAME"),`,
    `        "USER": ai_env("DB_USER"),`,
    `        "PASSWORD": ai_env("DB_PASSWORD"),`,
    `        "HOST": ai_env("DB_HOST"),`,
    `        "PORT": ai_env("DB_PORT"),`,
    '    }',
    '}',
    '',
    '# El secreto de firma es un placeholder: en el ambiente de IA no protege nada real.',
    'SECRET_KEY = os.environ.get("SECRET_KEY") or "__AI_PLACEHOLDER__SECRET_KEY__"',
    '',
    'EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"',
    `EMAIL_HOST = "localhost"`,
    `EMAIL_PORT = ${c.ports.smtp}`,
    '',
  ].join('\n');
}

export function runCmdAi() { return 'AI_ENV=1 python manage.py runserver'; }

export function loaderSnippet() {
  return {
    file: 'settings.py',
    lang: 'python',
    code: ['# al final de settings.py', 'from ai_env import IS_AI_ENV, ai_env, load_ai_env', '', 'load_ai_env()', 'if IS_AI_ENV:', '    from settings.ai import *  # noqa: F401,F403'].join('\n'),
  };
}

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  return [
    file(app, 'ai_env.py', aiEnvPy(c)),
    file(app, 'settings/ai.py', settingsAiPy(c)),
  ];
}

export function docs(app) {
  return docsBlock({
    title: `Django (${app?.name ?? 'backend'})`,
    runCmd: 'AI_ENV=1 python manage.py runserver',
    files: ['.env.ai', 'ai_env.py', 'settings/ai.py'],
    notes: [
      'En `ai-dev`, `settings.py` deja `DATABASES["default"]["PASSWORD"] = ""` (campo vacío).',
      '`load_ai_env()` usa `setdefault`: nunca pisa una variable real del entorno.',
      'La BD de IA es la del workspace (`bot-secure db up`), con datos sintéticos es_MX.',
    ],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
