// Detección de stack, kind, envStrategy, gestor de paquetes y puerto por manifiestos.
import { join } from 'node:path';
import { readJsonSafe, readText, fileExists, filesWithExt, entriesWithExt, pkgDeps, findFile, listDir, readMany } from './manifests.mjs';

const NODE_SERVER_DEPS = ['express', 'fastify', 'koa', '@hapi/hapi', 'hapi', 'restify', 'hono', 'h3', '@adonisjs/core', '@feathersjs/feathers', '@apollo/server', 'apollo-server', 'graphql-yoga', 'socket.io'];
const FRONTEND = new Set(['angular', 'next', 'nuxt', 'vite', 'cra', 'vue', 'svelte']);
const MOBILE = new Set(['expo', 'react-native', 'flutter', 'android', 'ios']);
const BACKEND = new Set(['spring', 'quarkus', 'micronaut', 'dotnet', 'django', 'fastapi', 'flask', 'laravel', 'symfony', 'rails', 'go', 'nest', 'php', 'node']);

/** Estrategia de entorno por stack (plan, decisión 8c). */
export const ENV_STRATEGY = Object.freeze({
  angular: 'angular-environments',
  vite: 'dotenv-native', cra: 'dotenv-native', vue: 'dotenv-native', next: 'dotenv-native', nuxt: 'dotenv-native', svelte: 'dotenv-native',
  expo: 'expo-config', 'react-native': 'expo-config',
  flutter: 'dart-define',
  node: 'dotenv', nest: 'dotenv', express: 'dotenv',
  spring: 'spring-profile', quarkus: 'spring-profile', micronaut: 'spring-profile',
  dotnet: 'appsettings-ai',
  django: 'django-settings',
  fastapi: 'dotenv', flask: 'dotenv', python: 'dotenv',
  laravel: 'dotenv-env-local', symfony: 'dotenv-env-local', rails: 'dotenv-env-local',
  go: 'go-loader',
  php: 'php-config',
  android: 'gradle-flavor',
  ios: 'xcconfig',
  java: 'manual', unknown: 'manual',
});

/** Puerto por defecto del servidor de desarrollo de cada stack. */
export const DEFAULT_PORT = Object.freeze({
  angular: 4200, vite: 5173, svelte: 5173, cra: 3000, next: 3000, nuxt: 3000, vue: 8080,
  node: 3000, nest: 3000, express: 3000, expo: 8081, 'react-native': 8081,
  spring: 8080, quarkus: 8080, micronaut: 8080, dotnet: 5000, django: 8000, fastapi: 8000, flask: 5000,
  laravel: 8000, symfony: 8000, rails: 3000, go: 8080, php: 8080,
});

/** Etiqueta legible para el mapa de apps. */
export const STACK_LABEL = Object.freeze({
  angular: 'Angular', next: 'Next.js', nuxt: 'Nuxt', vite: 'Vite', cra: 'Create React App', vue: 'Vue', svelte: 'SvelteKit',
  expo: 'Expo', 'react-native': 'React Native', flutter: 'Flutter', android: 'Android', ios: 'iOS',
  node: 'Node.js', nest: 'NestJS', express: 'Express', spring: 'Spring Boot', quarkus: 'Quarkus', micronaut: 'Micronaut',
  dotnet: '.NET', django: 'Django', fastapi: 'FastAPI', flask: 'Flask', python: 'Python', laravel: 'Laravel', symfony: 'Symfony',
  rails: 'Rails', go: 'Go', php: 'PHP', java: 'Java', unknown: 'desconocido',
});

export function envStrategyFor(stack) { return ENV_STRATEGY[stack] ?? 'manual'; }
export function detectStack(dir) { return detectStackInfo(dir).stack; }

/**
 * Detecta el stack y los manifiestos que lo delatan.
 * @returns {{stack:string, manifests:string[], server:boolean}}
 */
export function detectStackInfo(dir) {
  const manifests = [];
  const has = (f) => { const ok = fileExists(join(dir, f)); if (ok && !manifests.includes(f)) manifests.push(f); return ok; };
  const out = (stack, server = true) => ({ stack, manifests, server });

  // Móvil primero: Flutter/Android/iOS comparten manifiestos con otros stacks.
  if (has('pubspec.yaml')) return out('flutter');
  const gradle = ['build.gradle', 'build.gradle.kts'].find(has);
  if (gradle && findFile(dir, 'AndroidManifest.xml', 4)) return out('android');
  if (has('Podfile') || entriesWithExt(dir, '.xcodeproj').length || entriesWithExt(dir, '.xcworkspace').length) return out('ios');

  if (has('package.json')) {
    const pkg = readJsonSafe(join(dir, 'package.json')) ?? {};
    const deps = new Set(pkgDeps(pkg));
    const d = (...names) => names.some((n) => deps.has(n));
    if (d('@angular/core')) { has('angular.json'); return out('angular'); }
    if (d('next')) return out('next');
    if (d('nuxt', 'nuxt3')) return out('nuxt');
    if (d('@nestjs/core')) return out('nest');
    if (d('expo')) return out('expo');
    if (d('react-native')) return out('react-native');
    if (d('react-scripts')) return out('cra');
    if (d('@sveltejs/kit', 'svelte')) return out('svelte');
    if (d('vue', '@vue/cli-service')) return out('vue');
    if (d('vite')) return out('vite');
    return out('node', NODE_SERVER_DEPS.some((n) => deps.has(n)));
  }

  const java = readMany(dir, ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']);
  if (has('pom.xml') || gradle) {
    if (/spring-boot/.test(java)) return out('spring');
    if (/quarkus/.test(java)) return out('quarkus');
    if (/micronaut/.test(java)) return out('micronaut');
    return out('java', false);
  }

  const csproj = [...filesWithExt(dir, '.csproj'), ...filesWithExt(dir, '.fsproj'), ...filesWithExt(dir, '.sln')];
  if (csproj.length) { csproj.forEach((f) => has(f)); return out('dotnet', isDotnetWeb(dir)); }

  if (has('manage.py')) { ['requirements.txt', 'pyproject.toml', 'Pipfile'].forEach(has); return out('django'); }
  const py = ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg'].filter(has);
  if (py.length) {
    const txt = readMany(dir, py).toLowerCase();
    if (/\bfastapi\b/.test(txt)) return out('fastapi');
    if (/\bflask\b/.test(txt)) return out('flask');
    if (/\bdjango\b/.test(txt)) return out('django');
    return out('python', false);
  }

  if (has('composer.json')) {
    const composer = readJsonSafe(join(dir, 'composer.json')) ?? {};
    const req = Object.keys({ ...(composer.require || {}), ...(composer['require-dev'] || {}) });
    if (req.includes('laravel/framework') || has('artisan')) return out('laravel');
    if (req.some((r) => /^symfony\/(framework-bundle|symfony|http-kernel)$/.test(r))) return out('symfony');
    return out('php');
  }
  if (has('Gemfile') && /\brails\b/.test(readText(join(dir, 'Gemfile')) ?? '')) return out('rails');
  if (has('go.mod')) return out('go', hasGoMain(dir));
  if (has('index.php')) return out('php');
  return out('unknown', false);
}

/** ¿Algún .csproj es web (Sdk Web o AspNetCore)? */
function isDotnetWeb(dir) {
  for (const f of filesWithExt(dir, '.csproj')) {
    const t = readText(join(dir, f)) ?? '';
    if (/Sdk="Microsoft\.NET\.Sdk\.Web"/.test(t) || /Microsoft\.AspNetCore/.test(t)) return true;
  }
  return false;
}

/** ¿Hay un `package main` (main.go, cmd/*, o cualquier .go de raíz)? */
function hasGoMain(dir) {
  if (fileExists(join(dir, 'main.go')) || listDir(join(dir, 'cmd')).length) return true;
  return filesWithExt(dir, '.go').some((f) => /^package\s+main\b/m.test(readText(join(dir, f)) ?? ''));
}

/** Kind a partir de la info de stack. */
export function kindFor(info) {
  const { stack, server } = info;
  if (FRONTEND.has(stack)) return 'frontend';
  if (MOBILE.has(stack)) return 'mobile';
  if (stack === 'node' || stack === 'dotnet' || stack === 'go') return server ? 'backend' : 'lib';
  if (BACKEND.has(stack)) return 'backend';
  if (stack === 'java' || stack === 'python') return 'lib';
  return 'unknown';
}
export function detectKind(dir) { return kindFor(detectStackInfo(dir)); }

/** Gestor de paquetes por lockfiles/wrappers. */
export function detectPackageManager(dir, stack = detectStack(dir)) {
  const has = (f) => fileExists(join(dir, f));
  const nodeLike = ['angular', 'next', 'nuxt', 'nest', 'expo', 'react-native', 'cra', 'svelte', 'vue', 'vite', 'node'];
  if (nodeLike.includes(stack)) {
    if (has('pnpm-lock.yaml')) return 'pnpm';
    if (has('yarn.lock')) return 'yarn';
    if (has('bun.lockb') || has('bun.lock')) return 'bun';
    return 'npm';
  }
  if (['spring', 'quarkus', 'micronaut', 'java'].includes(stack)) return has('pom.xml') || has('mvnw') ? 'maven' : 'gradle';
  if (stack === 'android') return 'gradle';
  if (stack === 'dotnet') return 'dotnet';
  if (['django', 'fastapi', 'flask', 'python'].includes(stack)) {
    if (has('poetry.lock')) return 'poetry';
    if (has('uv.lock')) return 'uv';
    if (has('Pipfile')) return 'pipenv';
    return 'pip';
  }
  if (['laravel', 'symfony', 'php'].includes(stack)) return 'composer';
  if (stack === 'rails') return 'bundler';
  if (stack === 'go') return 'go';
  if (stack === 'flutter') return 'pub';
  if (stack === 'ios') return has('Podfile') ? 'cocoapods' : 'spm';
  return 'unknown';
}

/** Puerto: configuración del proyecto si es deducible; si no, el default del stack. */
export function detectPort(dir, stack = detectStack(dir)) {
  const num = (m) => (m ? Number(m[1]) : null);
  const yml = readMany(dir, ['src/main/resources/application.yml', 'src/main/resources/application.yaml', 'application.yml']);
  let p = num(/^server:\s*\n(?:[ \t]+.*\n)*?[ \t]+port:\s*(\d+)/m.exec(yml));
  if (!p) p = num(/^server\.port\s*=\s*(\d+)/m.exec(readMany(dir, ['src/main/resources/application.properties', 'application.properties'])));
  if (!p) p = num(/applicationUrl"\s*:\s*"https?:\/\/[^:"]+:(\d+)/.exec(readMany(dir, ['Properties/launchSettings.json'])));
  if (!p) p = num(/"port"\s*:\s*(\d+)/.exec(angularServeOptions(dir)));
  if (!p) p = num(/^PORT\s*=\s*(\d+)/m.exec(readMany(dir, ['.env.example', '.env.sample', '.env.ai'])));
  return p || DEFAULT_PORT[stack] || undefined;
}

function angularServeOptions(dir) {
  const ng = readJsonSafe(join(dir, 'angular.json'));
  if (!ng?.projects) return '';
  for (const p of Object.values(ng.projects)) {
    const opts = p?.architect?.serve?.options;
    if (opts?.port) return JSON.stringify(opts);
  }
  return '';
}

export function hasDockerfile(dir) {
  return fileExists(join(dir, 'Dockerfile')) || filesWithExt(dir, '.Dockerfile').length > 0 || fileExists(join(dir, 'Containerfile'));
}
