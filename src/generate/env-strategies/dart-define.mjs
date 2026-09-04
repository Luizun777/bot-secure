// Flutter: --dart-define-from-file=ai.env.json (no hay .env en tiempo de ejecución).
import { aiContext, appVars, banner, docsBlock, esc, file } from './_common.mjs';

export const id = 'dart-define';

function aiEnvJson(c) {
  const obj = { AI_ENV: '1', API_URL: c.apiUrl, OIDC_ISSUER: c.issuer, DATABASE_URL: '' };
  delete obj.DATABASE_URL;
  for (const v of appVars(c).filter((x) => x.kind !== 'plain').slice(0, 20)) obj[v.name] = v.value;
  return JSON.stringify(obj, null, 2) + '\n';
}

function aiEnvDart(c) {
  const names = ['API_URL', 'OIDC_ISSUER', ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => v.name)];
  const seen = new Set();
  const uniq = names.filter((n) => (seen.has(n) ? false : seen.add(n)));
  return [
    banner('//'),
    '// Los valores llegan por --dart-define-from-file=ai.env.json (nunca se compilan valores reales).',
    'class AiEnv {',
    "  static const bool isAiEnv = String.fromEnvironment('AI_ENV') == '1';",
    '',
    ...uniq.map((n) => `  static const String ${camel(n)} = String.fromEnvironment('${esc(n)}');`),
    '',
    '  /// Regla del campo vacío: vacío + AI_ENV → valor de ai.env.json; vacío sin AI_ENV → error claro.',
    '  static String require(String name, String value) {',
    '    if (value.isNotEmpty) return value;',
    '    throw StateError(',
    "      '[bot-secure] Falta \$name. En el ambiente de IA viene de ai.env.json '",
    "      '(flutter run --dart-define-from-file=ai.env.json); en dev/qa/prd, de tu configuración.',",
    '    );',
    '  }',
    '}',
    '',
  ].join('\n');
}

function camel(name) {
  return String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .map((p, i) => (i ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join('') || 'valor';
}

export function runCmdAi() { return 'flutter run --dart-define-from-file=ai.env.json'; }

export function loaderSnippet() {
  return {
    file: 'lib/ai_env.dart',
    lang: 'dart',
    code: ["import 'ai_env.dart';", '', 'final base = AiEnv.require("API_URL", AiEnv.apiUrl);'].join('\n'),
  };
}

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  return [file(app, 'ai.env.json', aiEnvJson(c)), file(app, 'lib/ai_env.dart', aiEnvDart(c))];
}

export function docs(app) {
  return docsBlock({
    title: `Flutter (${app?.name ?? 'mobile'})`,
    runCmd: 'flutter run --dart-define-from-file=ai.env.json',
    files: ['ai.env.json', 'lib/ai_env.dart'],
    notes: [
      '`String.fromEnvironment` es **const**: el valor se fija en compilación. Por eso el ambiente de IA usa su propio archivo.',
      'El emulador no ve `localhost` del host: en Android usa `10.0.2.2`.',
    ],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
