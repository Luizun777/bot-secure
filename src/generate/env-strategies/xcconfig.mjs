// iOS: AI.xcconfig + scheme `AI` (los valores llegan a Info.plist como variables de build).
import { aiContext, appVars, banner, docsBlock, file } from './_common.mjs';

export const id = 'xcconfig';

function aiXcconfig(c) {
  const rows = [['AI_ENV', '1'], ['API_URL', c.apiUrl], ['OIDC_ISSUER', c.issuer],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name, v.value])];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('//'),
    '// xcconfig: `//` es comentario y `$()` es sustitución; las URLs se parten para que `//` no',
    '// se coma el resto de la línea (truco estándar de Xcode).',
    'AI_SCHEME = http',
    'AI_SLASHES = //',
    ...uniq.map(([k, v]) => `${k} = ${String(v).replace(/^http:\/\//, '$(AI_SCHEME):$(AI_SLASHES)')}`),
    '',
  ].join('\n');
}

const README = [
  '# Ambiente de IA en iOS',
  '',
  '1. En Xcode: *Project → Info → Configurations* → añade `AI` (basada en `Debug`) y asígnale `AI.xcconfig`.',
  '2. Duplica el scheme como `AI` y en *Run → Build Configuration* elige `AI`.',
  '3. En `Info.plist` añade `API_URL` con valor `$(API_URL)` y léelo con',
  '   `Bundle.main.object(forInfoDictionaryKey: "API_URL") as? String ?? ""`.',
  '4. Regla del campo vacío: si el valor llega vacío y no estás en el ambiente de IA, lanza un error',
  '   con el nombre del campo (nunca un valor por defecto silencioso).',
  '',
].join('\n');

export function runCmdAi() { return 'xcodebuild -scheme AI -configuration AI build'; }

export function loaderSnippet() {
  return {
    file: 'AiEnv.swift',
    lang: 'swift',
    code: [
      'enum AiEnv {',
      '    static func require(_ key: String) -> String {',
      '        let value = Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""',
      '        if !value.isEmpty { return value }',
      '        fatalError("[bot-secure] Falta \\(key): usa el scheme AI (AI.xcconfig).")',
      '    }',
      '}',
    ].join('\n'),
  };
}

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  return [file(app, 'AI.xcconfig', aiXcconfig(c)), file(app, 'AI-README.md', README)];
}

export function docs(app) {
  return docsBlock({
    title: `iOS (${app?.name ?? 'mobile'})`,
    runCmd: runCmdAi(app),
    files: ['AI.xcconfig', 'AI-README.md'],
    notes: ['Los pasos de Xcode son manuales (el bot no toca `project.pbxproj`).', 'El simulador sí ve `localhost` del host; un dispositivo real no.'],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
