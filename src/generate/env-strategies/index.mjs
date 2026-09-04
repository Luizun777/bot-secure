// Registro de estrategias de entorno. Imports ESTÁTICOS: lo que se despliega es un bundle
// (dist/), donde un import dinámico por nombre no resolvería nada.
import angularEnvironments from './angular-environments.mjs';
import appsettingsAi from './appsettings-ai.mjs';
import dartDefine from './dart-define.mjs';
import djangoSettings from './django-settings.mjs';
import dotenv from './dotenv.mjs';
import dotenvEnvLocal from './dotenv-env-local.mjs';
import dotenvNative from './dotenv-native.mjs';
import expoConfig from './expo-config.mjs';
import goLoader from './go-loader.mjs';
import gradleFlavor from './gradle-flavor.mjs';
import manual from './manual.mjs';
import phpConfig from './php-config.mjs';
import springProfile from './spring-profile.mjs';
import xcconfig from './xcconfig.mjs';

export { patchAngularJson } from './angular-environments.mjs';

/** @typedef {{id:string, files:Function, loaderSnippet:Function, runCmdAi:Function, docs:Function}} EnvStrategy */

/** Todas las estrategias por id (uno por cada valor de `envStrategy` de src/detect). */
export const STRATEGIES = Object.freeze({
  'angular-environments': angularEnvironments,
  'appsettings-ai': appsettingsAi,
  'dart-define': dartDefine,
  'django-settings': djangoSettings,
  dotenv,
  'dotenv-env-local': dotenvEnvLocal,
  'dotenv-native': dotenvNative,
  'expo-config': expoConfig,
  'go-loader': goLoader,
  'gradle-flavor': gradleFlavor,
  manual,
  'php-config': phpConfig,
  'spring-profile': springProfile,
  xcconfig,
});

export const STRATEGY_IDS = Object.freeze(Object.keys(STRATEGIES));

/**
 * Estrategia de una app (por `app.envStrategy`; `manual` si no se reconoce).
 * @param {{envStrategy?:string}} app
 * @returns {EnvStrategy}
 */
export function strategyFor(app) {
  return STRATEGIES[app?.envStrategy] ?? STRATEGIES.manual;
}

/** ¿El stack de la app lee `.env` por sí mismo (o vía el loader que generamos)? */
export function usesEnvFile(app) {
  return ['dotenv', 'dotenv-native', 'dotenv-env-local', 'expo-config', 'go-loader', 'django-settings', 'php-config'].includes(app?.envStrategy);
}

/** Artefactos de la estrategia de una app. */
export function strategyFiles(app, policy, ctx = {}) {
  return strategyFor(app).files(app, policy, ctx) ?? [];
}

/** Comando de arranque en modo IA para una app. */
export function runCmdAi(app) { return strategyFor(app).runCmdAi(app); }
