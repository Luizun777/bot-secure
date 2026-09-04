// API pública del módulo detect (ver CONTRACTS.md § Detect).
export { detectStack, detectStackInfo, detectKind, kindFor, envStrategyFor, detectPackageManager, detectPort, hasDockerfile, ENV_STRATEGY, DEFAULT_PORT, STACK_LABEL } from './stack.mjs';
export { detectCommands } from './commands.mjs';
export { detectRegistries, detectSdks, detectSecretManagers, collectDeps } from './deps.mjs';
export { detectOrm } from './orm.mjs';
export { detectApps, describeApp, monorepoMembers } from './apps.mjs';
export { detectClaudeInstall, detectAccount, detectContainerRuntime, findInPath, maskEmail } from './system.mjs';
