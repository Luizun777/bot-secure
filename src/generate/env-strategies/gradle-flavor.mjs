// Android: local.properties.ai → BuildConfig del flavor `ai` (Gradle).
import { aiContext, appVars, banner, docsBlock, esc, file } from './_common.mjs';

export const id = 'gradle-flavor';

function localPropertiesAi(c) {
  const rows = [['AI_ENV', '1'], ['API_URL', c.apiUrl], ['OIDC_ISSUER', c.issuer],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [v.name, v.value])];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('#'),
    '# Lo lee ai-env.gradle y lo expone como BuildConfig del flavor `ai`.',
    '# Nota: el emulador NO ve el localhost del host; usa 10.0.2.2.',
    ...uniq.map(([k, v]) => `${k}=${v}`),
    '',
  ].join('\n');
}

const AI_ENV_GRADLE = [
  banner('//'),
  '// Aplícalo desde app/build.gradle:  apply from: "../ai-env.gradle"',
  'def aiProps = new Properties()',
  'def aiFile = rootProject.file("local.properties.ai")',
  'if (aiFile.exists()) {',
  '    aiFile.withInputStream { aiProps.load(it) }',
  '}',
  '',
  'android {',
  '    flavorDimensions "entorno"',
  '    productFlavors {',
  '        ai {',
  '            dimension "entorno"',
  '            applicationIdSuffix ".ai"',
  '            // Regla del campo vacío: si la propiedad falta, el build falla con su nombre.',
  '            aiProps.stringPropertyNames().each { name ->',
  '                def value = aiProps.getProperty(name)',
  '                if (value == null || value.isEmpty()) {',
  '                    throw new GradleException("[bot-secure] Falta " + name + " en local.properties.ai")',
  '                }',
  '                buildConfigField "String", name, "\\"" + value + "\\""',
  '            }',
  '        }',
  '        dev {',
  '            dimension "entorno"',
  '        }',
  '    }',
  '}',
  '',
].join('\n');

export function runCmdAi() { return './gradlew assembleAiDebug'; }

export function loaderSnippet() {
  return { file: 'app/build.gradle', lang: 'gradle', code: 'apply from: "../ai-env.gradle"\n\n// uso: BuildConfig.API_URL' };
}

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  return [
    file(app, 'local.properties.ai', localPropertiesAi(c)),
    file(app, 'ai-env.gradle', AI_ENV_GRADLE),
  ];
}

export function docs(app) {
  return docsBlock({
    title: `Android (${app?.name ?? 'mobile'})`,
    runCmd: './gradlew assembleAiDebug',
    files: ['local.properties.ai', 'ai-env.gradle'],
    notes: [
      '`local.properties` (el real) sigue en `.gitignore`; `local.properties.ai` se versiona porque solo tiene valores falsos.',
      'El emulador no ve `localhost` del host: usa `10.0.2.2` o `adb reverse tcp:8080 tcp:8080`.',
    ],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
