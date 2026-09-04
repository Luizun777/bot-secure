// Laravel / Symfony / Rails: .env.ai manteniendo APP_ENV=local / dev (no se inventa un entorno).
import { aiContext, appVars, banner, docsBlock, esc, file } from './_common.mjs';

export const id = 'dotenv-env-local';

const RAILS = (app) => app?.stack === 'rails';
const SYMFONY = (app) => app?.stack === 'symfony';

function aiEnvPhp(c) {
  const rows = [['DATABASE_URL', c.dbUrl], ['API_URL', c.apiUrl], ['OIDC_ISSUER', c.issuer],
    ['DB_HOST', c.db.host || '127.0.0.1'], ['DB_PORT', String(c.db.port || '5433')],
    ['DB_DATABASE', c.db.database || 'app_ai'], ['DB_USERNAME', c.db.user || 'app'],
    ['DB_PASSWORD', c.db.password || '__AI_PLACEHOLDER__DB_PASSWORD__'],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name, v.value])];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    '<?php',
    '',
    banner('//'),
    '',
    'final class AiEnv',
    '{',
    '    /** Valores del ambiente de IA (falsos pero válidos por formato). */',
    '    public const VALUES = [',
    ...uniq.map(([k, v]) => `        '${esc(k)}' => '${esc(v)}',`),
    '    ];',
    '',
    '    public static function isAiEnv(): bool',
    '    {',
    "        return getenv('AI_ENV') === '1';",
    '    }',
    '',
    '    /** Carga .env.ai sin pisar el entorno real. */',
    '    public static function load(string $path = __DIR__ . \'/../.env.ai\'): void',
    '    {',
    '        if (!self::isAiEnv() || !is_file($path)) {',
    '            return;',
    '        }',
    '        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {',
    "            $line = trim($line);",
    "            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {",
    '                continue;',
    '            }',
    "            [$name, $value] = explode('=', $line, 2);",
    "            $value = trim(explode(' #', $value, 2)[0], \" \\t'\\\"\");",
    '            $name = trim($name);',
    '            if (getenv($name) === false) {',
    "                putenv(\"$name=$value\");",
    '                $_ENV[$name] = $value;',
    '            }',
    '        }',
    '    }',
    '',
    '    /** Regla del campo vacío: vacío + AI_ENV → valor de IA; vacío sin AI_ENV → excepción clara. */',
    '    public static function get(string $name, string $current = \'\'): string',
    '    {',
    "        if ($current !== '') {",
    '            return $current;',
    '        }',
    '        $value = getenv($name);',
    "        if ($value !== false && $value !== '') {",
    '            return (string) $value;',
    '        }',
    '        if (self::isAiEnv() && isset(self::VALUES[$name])) {',
    '            return self::VALUES[$name];',
    '        }',
    '        throw new RuntimeException(',
    '            "[bot-secure] Falta $name. En el ambiente de IA viene de .env.ai " .',
    '            "(AI_ENV=1 php artisan serve); en dev/qa/prd, del entorno."',
    '        );',
    '    }',
    '}',
    '',
  ].join('\n');
}

function aiEnvRb(c) {
  const rows = [['DATABASE_URL', c.dbUrl], ['API_URL', c.apiUrl], ['OIDC_ISSUER', c.issuer],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name, v.value])];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('#'),
    '# frozen_string_literal: true',
    '',
    'module AiEnv',
    '  VALUES = {',
    ...uniq.map(([k, v]) => `    '${esc(k)}' => '${esc(v)}',`),
    '  }.freeze',
    '',
    "  def self.ai_env?",
    "    ENV['AI_ENV'] == '1'",
    '  end',
    '',
    "  def self.load!(path = '.env.ai')",
    '    return unless ai_env? && File.exist?(path)',
    '',
    '    File.readlines(path).each do |raw|',
    '      line = raw.strip',
    "      next if line.empty? || line.start_with?('#') || !line.include?('=')",
    '',
    "      name, value = line.split('=', 2)",
    "      value = value.split(' #', 2).first.to_s.strip.gsub(/\\A['\"]|['\"]\\z/, '')",
    '      ENV[name.strip] ||= value',
    '    end',
    '  end',
    '',
    '  # Regla del campo vacío: vacío + AI_ENV → valor de IA; vacío sin AI_ENV → error claro.',
    "  def self.fetch(name, current = '')",
    '    return current unless current.to_s.empty?',
    '',
    '    value = ENV[name]',
    '    return value unless value.to_s.empty?',
    '    return VALUES[name] if ai_env? && VALUES.key?(name)',
    '',
    '    raise "[bot-secure] Falta #{name}. En el ambiente de IA viene de .env.ai " \\',
    '          "(AI_ENV=1 bin/rails server); en dev/qa/prd, del entorno."',
    '  end',
    'end',
    '',
    'AiEnv.load!',
    '',
  ].join('\n');
}

export function runCmdAi(app) {
  if (RAILS(app)) return 'AI_ENV=1 bin/rails server';
  if (SYMFONY(app)) return 'AI_ENV=1 symfony serve';
  return 'AI_ENV=1 php artisan serve';
}

export function loaderSnippet(app) {
  if (RAILS(app)) return { file: 'config/ai_env.rb', lang: 'ruby', code: "require_relative 'ai_env'\n\nENV['DATABASE_URL'] = AiEnv.fetch('DATABASE_URL')" };
  const path = SYMFONY(app) ? 'config/AiEnv.php' : 'bootstrap/AiEnv.php';
  return { file: path, lang: 'php', code: `<?php\n\nrequire_once __DIR__ . '/AiEnv.php';\n\nAiEnv::load();\n$dsn = AiEnv::get('DATABASE_URL');` };
}

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  if (RAILS(app)) return [file(app, 'config/ai_env.rb', aiEnvRb(c))];
  return [file(app, SYMFONY(app) ? 'config/AiEnv.php' : 'bootstrap/AiEnv.php', aiEnvPhp(c))];
}

export function docs(app) {
  const rails = RAILS(app);
  return docsBlock({
    title: `${app?.stack ?? 'laravel'} (${app?.name ?? 'backend'})`,
    runCmd: runCmdAi(app),
    files: rails ? ['.env.ai', 'config/ai_env.rb'] : ['.env.ai', SYMFONY(app) ? 'config/AiEnv.php' : 'bootstrap/AiEnv.php'],
    notes: [
      '`AI_ENV=1` no cambia el entorno del framework: `APP_ENV` sigue siendo `local` (Laravel) o `dev` (Symfony/Rails).',
      'El cargador nunca pisa una variable que ya venga del entorno real.',
      rails ? '`config/master.key` y `credentials.yml.enc` NO se usan en el ambiente de IA.' : '`APP_KEY` del ambiente de IA es un `base64:` determinista y falso.',
    ],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
