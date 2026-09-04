// Dependencias declaradas en cualquier manifiesto → SDKs, gestores de secretos y registries.
import { join } from 'node:path';
import { readJsonSafe, readText, fileExists, filesWithExt, pkgDeps, readMany, listDir } from './manifests.mjs';

/** Nombres de dependencias (minúsculas) de todos los manifiestos presentes en dir. */
export function collectDeps(dir) {
  const out = new Set();
  const add = (s) => { if (s) out.add(String(s).trim().toLowerCase()); };
  const pkg = readJsonSafe(join(dir, 'package.json'));
  if (pkg) pkgDeps(pkg).forEach(add);
  for (const f of ['requirements.txt', 'requirements-dev.txt', 'requirements/base.txt']) {
    for (const line of (readText(join(dir, f)) ?? '').split('\n')) {
      const m = /^\s*([A-Za-z0-9_.-]+)/.exec(line);
      if (m && !line.trim().startsWith('#') && !line.trim().startsWith('-')) add(m[1]);
    }
  }
  const py = readMany(dir, ['pyproject.toml', 'Pipfile']);
  for (const m of py.matchAll(/^\s*"?([A-Za-z0-9_.-]+)"?\s*(?:[=<>~!\[]|$)/gm)) add(m[1]);
  for (const m of py.matchAll(/"([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*[<>=~!]/g)) add(m[1]);
  const java = readMany(dir, ['pom.xml', 'build.gradle', 'build.gradle.kts', 'app/build.gradle', 'app/build.gradle.kts']);
  for (const m of java.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) add(m[1]);
  for (const m of java.matchAll(/<groupId>([^<]+)<\/groupId>/g)) add(m[1]);
  for (const m of java.matchAll(/['"]([a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+)(?::[^'"]*)?['"]/g)) { add(m[1]); add(m[1].split(':')[1]); }
  for (const f of filesWithExt(dir, '.csproj')) {
    for (const m of (readText(join(dir, f)) ?? '').matchAll(/<PackageReference\s+Include="([^"]+)"/g)) add(m[1]);
  }
  const composer = readJsonSafe(join(dir, 'composer.json'));
  if (composer) Object.keys({ ...(composer.require || {}), ...(composer['require-dev'] || {}) }).forEach(add);
  for (const m of (readText(join(dir, 'Gemfile')) ?? '').matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)) add(m[1]);
  for (const m of (readText(join(dir, 'go.mod')) ?? '').matchAll(/^\s*([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v/gm)) add(m[1]);
  const pub = readText(join(dir, 'pubspec.yaml')) ?? '';
  for (const m of pub.matchAll(/^  ([a-z0-9_]+):/gm)) add(m[1]);
  return out;
}

const SDKS = [
  ['stripe', /(^|[/:.])stripe([/:.-]|$)|^stripe$|^stripe\.net$/],
  ['twilio', /twilio/],
  ['sendgrid', /sendgrid/],
  ['firebase', /firebase/],
  ['supabase', /supabase/],
  ['aws', /^aws-sdk$|^@aws-sdk\/|^boto3$|^botocore$|^awssdk\.|software\.amazon\.awssdk|^aws-sdk-|^github\.com\/aws\/aws-sdk-go/],
  ['clerk', /^@clerk\//],
  ['mapbox', /mapbox/],
  ['algolia', /algolia/],
  ['sentry', /sentry/],
  ['mercadopago', /mercadopago/],
  ['conekta', /conekta/],
  ['openpay', /openpay/],
  ['openai', /^openai$|^com\.theokanning|^openai-/],
  ['anthropic', /anthropic/],
  ['google-maps', /google-maps|googlemaps|@googlemaps/],
  ['auth0', /auth0/],
];

/** SDKs de terceros que suelen requerir llaves (para fakes tipados y adaptadores). */
export function detectSdks(dir) {
  const deps = collectDeps(dir);
  const found = new Set();
  for (const [sdk, re] of SDKS) for (const d of deps) if (re.test(d)) { found.add(sdk); break; }
  return [...found].sort();
}

const SECRET_MANAGERS = [
  ['azure-key-vault', /keyvault|key-vault/],
  ['aws-secrets-manager', /secrets-?manager|secretsmanager/],
  ['gcp-secret-manager', /secret-manager|secretmanager/],
  ['vault', /^node-vault$|^hvac$|vault-config|^vaultsharp$|hashicorp\/vault|^vault$/],
  ['spring-cloud-config', /spring-cloud-(starter-)?config/],
  ['doppler', /doppler/],
  ['dotenv-vault', /dotenv-vault/],
  ['infisical', /infisical/],
  ['sops', /^sops$|getsops/],
];

/** Gestores de secretos en dependencias, archivos marcadores o configuración. */
export function detectSecretManagers(dir) {
  const deps = collectDeps(dir);
  const found = new Set();
  for (const [name, re] of SECRET_MANAGERS) for (const d of deps) if (re.test(d)) { found.add(name); break; }
  if (fileExists(join(dir, 'doppler.yaml')) || fileExists(join(dir, '.doppler.yaml'))) found.add('doppler');
  if (fileExists(join(dir, '.env.vault'))) found.add('dotenv-vault');
  if (fileExists(join(dir, '.sops.yaml'))) found.add('sops');
  if (fileExists(join(dir, '.infisical.json'))) found.add('infisical');
  const cfg = readMany(dir, configFiles(dir));
  if (/keyvault|key-vault|vault\.azure\.net/i.test(cfg)) found.add('azure-key-vault');
  if (/secretsmanager|aws-secretsmanager/i.test(cfg)) found.add('aws-secrets-manager');
  if (/spring\.cloud\.config|configserver:|config\.import/i.test(cfg)) found.add('spring-cloud-config');
  if (/spring\.cloud\.vault|vault:\s*\n\s+(uri|host)/i.test(cfg)) found.add('vault');
  return [...found].sort();
}

function configFiles(dir) {
  const out = ['src/main/resources/application.yml', 'src/main/resources/application.yaml', 'src/main/resources/application.properties', 'src/main/resources/bootstrap.yml'];
  for (const f of listDir(dir)) if (/^appsettings.*\.json$/.test(f.name)) out.push(f.name);
  return out;
}

/** Registries privados: npm, pip, maven, nuget, go, composer. Devuelve URLs únicas. */
export function detectRegistries(dir) {
  const urls = new Set();
  const addUrl = (u) => { if (u && /^https?:\/\//.test(u.trim())) urls.add(u.trim().replace(/\/+$/, '')); };
  const npmrc = readText(join(dir, '.npmrc')) ?? '';
  for (const m of npmrc.matchAll(/^(?:@[\w-]+:)?registry\s*=\s*(\S+)/gm)) addUrl(m[1]);
  for (const m of (readText(join(dir, '.yarnrc.yml')) ?? '').matchAll(/npmRegistryServer:\s*["']?([^"'\s]+)/g)) addUrl(m[1]);
  const pip = readMany(dir, ['pip.conf', 'pip.ini', '.pip/pip.conf', 'pyproject.toml', 'requirements.txt']);
  for (const m of pip.matchAll(/(?:extra-)?index-url\s*[=:]?\s*["']?(https?:\/\/[^\s"']+)/g)) addUrl(m[1]);
  for (const m of pip.matchAll(/^\s*url\s*=\s*["'](https?:\/\/[^"']+)["']/gm)) addUrl(m[1]);
  const mvn = readMany(dir, ['settings.xml', '.mvn/settings.xml', 'pom.xml']);
  for (const m of mvn.matchAll(/<(?:repository|pluginRepository|mirror)>[\s\S]*?<url>([^<]+)<\/url>/g)) addUrl(m[1]);
  const gradle = readMany(dir, ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']);
  for (const m of gradle.matchAll(/maven\s*\{[^}]*?url\s*[=(]?\s*(?:uri\()?["']([^"']+)["']/g)) addUrl(m[1]);
  for (const f of listDir(dir)) {
    if (!/^nuget\.config$/i.test(f.name)) continue;
    for (const m of (readText(join(dir, f.name)) ?? '').matchAll(/<add\s+key="[^"]+"\s+value="(https?:\/\/[^"]+)"/g)) addUrl(m[1]);
  }
  const goenv = readMany(dir, ['go.env', '.env.example', 'Makefile', 'Dockerfile']);
  for (const m of goenv.matchAll(/GOPROXY\s*[=:]\s*["']?([^\s"',]+)/g)) addUrl(m[1]);
  const composer = readJsonSafe(join(dir, 'composer.json'));
  for (const r of Object.values(composer?.repositories ?? {})) addUrl(r?.url);
  // Los públicos por defecto no son "registries privados"
  const PUBLIC = /registry\.npmjs\.org|pypi\.org|repo\.maven\.apache\.org|repo1\.maven\.org|api\.nuget\.org|proxy\.golang\.org|packagist\.org|google\(\)|mavenCentral/;
  return [...urls].filter((u) => !PUBLIC.test(u)).sort();
}
