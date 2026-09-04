// PHP clásico: config.ai.php leído vía getenv() cuando AI_ENV=1.
import { aiContext, appVars, banner, docsBlock, esc, file } from './_common.mjs';

export const id = 'php-config';

function configAiPhp(c) {
  const rows = [['DATABASE_URL', c.dbUrl], ['API_URL', c.apiUrl], ['OIDC_ISSUER', c.issuer],
    ['DB_HOST', c.db.host || '127.0.0.1'], ['DB_PORT', String(c.db.port || '5433')],
    ['DB_NAME', c.db.database || 'app_ai'], ['DB_USER', c.db.user || 'app'],
    ['DB_PASSWORD', c.db.password || '__AI_PLACEHOLDER__DB_PASSWORD__'],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name, v.value])];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    '<?php',
    '',
    banner('//'),
    '',
    '/** Valores del ambiente de IA (falsos pero válidos por formato). */',
    '$AI_VALUES = [',
    ...uniq.map(([k, v]) => `    '${esc(k)}' => '${esc(v)}',`),
    '];',
    '',
    "$IS_AI_ENV = getenv('AI_ENV') === '1';",
    '',
    '/**',
    ' * Regla del campo vacío: vacío + AI_ENV → valor de IA; vacío sin AI_ENV → excepción clara.',
    ' */',
    'function ai_config(string $name, string $current = \'\'): string',
    '{',
    '    global $AI_VALUES, $IS_AI_ENV;',
    "    if ($current !== '') {",
    '        return $current;',
    '    }',
    '    $value = getenv($name);',
    "    if ($value !== false && $value !== '') {",
    '        return (string) $value;',
    '    }',
    '    if ($IS_AI_ENV && isset($AI_VALUES[$name])) {',
    '        return $AI_VALUES[$name];',
    '    }',
    '    throw new RuntimeException(',
    '        "[bot-secure] Falta $name. En el ambiente de IA viene de config.ai.php " .',
    '        "(AI_ENV=1 php -S localhost:8000); en dev/qa/prd, del entorno."',
    '    );',
    '}',
    '',
    'if ($IS_AI_ENV) {',
    '    foreach ($AI_VALUES as $name => $value) {',
    '        if (getenv($name) === false) {',
    '            putenv("$name=$value");',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
}

export function runCmdAi() { return 'AI_ENV=1 php -S localhost:8000'; }

export function loaderSnippet() {
  return { file: 'config.php', lang: 'php', code: "<?php\n\nrequire_once __DIR__ . '/config.ai.php';\n\n$dsn = ai_config('DATABASE_URL', $config['dsn'] ?? '');" };
}

export function files(app, policy, ctx = {}) {
  return [file(app, 'config.ai.php', configAiPhp(aiContext(app, policy, ctx)))];
}

export function docs(app) {
  return docsBlock({
    title: `PHP (${app?.name ?? 'backend'})`,
    runCmd: 'AI_ENV=1 php -S localhost:8000',
    files: ['config.ai.php'],
    notes: ['En `ai-dev`, `config.php` deja los campos sensibles vacíos y llama a `ai_config()`.'],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
