# CONTRACTS — interfaces entre módulos de bot-secure

Este archivo es la fuente de verdad para trabajar en paralelo. Cada módulo es dueño de su carpeta. Los archivos compartidos (`bin/`, `src/lib/`, `package.json`, este archivo) NO se modifican desde un módulo: si necesitas algo nuevo en ellos, documéntalo en tu resumen final y usa un helper local mientras tanto.

## Convenciones globales
- Node ≥ 20, ESM (`.mjs`), **cero dependencias de runtime** (solo `node:*`). esbuild solo en `scripts/build.mjs`.
- Mensajes al usuario vía i18n: `src/i18n/es/<modulo>.json` y `src/i18n/en/<modulo>.json` (un archivo por módulo; el nombre del archivo es el namespace). Uso: `ctx.t('modulo.clave', { var })`. Español por defecto.
- Errores para el usuario: `throw new BotSecureError('modulo.clave', { vars, fix: 'comando exacto', exitCode })` (`src/lib/errors.mjs`). **Todo error lleva `fix`.**
- Exit codes: `EXIT.OK=0`, `EXIT.FINDINGS=1`, `EXIT.ERROR=2`, `EXIT.DRIFT=3`.
- Logging: `ctx.log.{info,ok,warn,error,step,dim,table,data}`; con `--json` solo `log.data(obj)` imprime en stdout.
- Procesos: `run(cmd, args, {cwd})` / `git(args, {cwd})` de `src/lib/exec.mjs` (sin shell). Archivos: `src/lib/fsx.mjs` (`readJson`, `writeJson`, `writeText`, `writeGenerated`, `sha256`). Rutas: `src/lib/paths.mjs` (`findWorkspaceRoot`, `findGitRoot`, `currentBranch`). Plantillas: `src/lib/template.mjs` (`render(tpl, ctx)`).
- Nunca escribir el valor de un secreto en logs/reportes/tests. Fixtures con secretos FALSOS reconocibles (`AKIAIOSFODNN7EXAMPLE`, `sk_test_AIPLACEHOLDER…`).
- Tests: `node:test` en `test/unit/<modulo>*.test.mjs`; fixtures en `test/fixtures/<area>/`; e2e en `test/e2e/` con repos temporales bajo `test/e2e/tmp/` (gitignored) y evidencia real en `test/e2e/evidence/*.txt` (versionada).
- Windows: rutas con `path.join`, nunca `/` a mano; sin `bash`-ismos en scripts que corran en el destino (`sh` POSIX o Node).

## Comandos CLI (`src/cli/<nombre>.mjs`)
```js
export default {
  name: 'scan', aliases: [], advanced: false, hidden: false,
  summary: { es: '…', en: '…' }, usage: { es: 'bot-secure scan [--history] …', en: '…' },
  async run(ctx) { /* return EXIT.* o lanza BotSecureError */ }
}
// ctx = { args: string[], flags: {}, cwd, lang, t, log, pkg, version, dryRun, yes }
```
Comandos previstos: `start`, `menu` (existe), `up`, `down`, `status`, `init`, `workspace`, `scan`, `sanitize`, `branch`, `claude`, `guard`, `doctor`, `baseline`, `policy`, `db`, `mocks`, `sync`, `export-patches`, `ci`, `org-pack`, `attest`. Subcomandos: `ctx.args[0]`.

## Engine (`src/engine/`)
```ts
type Severity = 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'|'INFO'
type Finding = {
  id: string,                 // = fingerprint
  ruleId: string, category: 'secret'|'pii'|'file'|'placeholder-leak'|'config',
  severity: Severity,
  file: string,               // relativo a root (posix)
  line: number, column?: number,
  masked: string,             // NUNCA el valor: prefijo + '…' + '(len)' o máscara PCI
  fingerprint: string,        // HMAC-SHA256(key, ruleId|file|valorNormalizado)[0:16]; para PII sin el valor
  entropy?: number,           // omitir para PII
  verifiedChecksum?: boolean, inTestPath?: boolean, inBuildArtifact?: boolean, reachable?: boolean,
  remediation: { kind: 'secret'|'identifier'|'url'|'host'|'email'|'guid'|'bucket'|'region'|'sdk-key'|'file'|'pii',
                 action: string, envVar?: string, fake?: string, stackRefactor?: string },
  source: 'native'|'gitleaks', occurrences?: {file:string,line:number}[]
}
type Report = { tool:'bot-secure', version, rulesVersion, commit?, generatedAt, root, mode,
                findings: Finding[], stats: {files, bytes, ms, byRule:{}, bySeverity:{}},
                skipped: {path, reason, size?}[], warnings: string[], reportSha256? }
```
- `src/engine/index.mjs`: `scanPaths({root, paths?, mode:'scan'|'guard'|'ci'|'pre-commit', include?, exclude?, history?, build?, full?, baseline?, hmacKey, apps?}) → Promise<Report>`; `scanText(text, {path?, mode, hmacKey, maxMs?}) → Promise<Finding[]>` (en `guard` corre en worker con timeout → si vence lanza `ScanTimeout`); `writeReports(report, {dir, formats:['json','md','sarif'], lang}) → paths[]`; `loadRules() → Rule[]`; `RULES_VERSION`.
- Reglas en `src/engine/rules/*.json`: `{ id, category, severity, description:{es,en}, keywords:[], regex, flags?, secretGroup?, entropy?, minLen?, paths?:[glob], filesOnly?:bool, allowlist?:{regexes:[], stopwords:bool}, remediation:{kind, envVar?} }`. Regex JS sin cuantificadores anidados (checker ReDoS en build).
- `fingerprint.mjs`: `hmacFingerprint(key, ruleId, file, value)`, `piiFingerprint(key, ruleId, file, lineNormalized)`, `mask(value, kind)`; `loadHmacKey(root)` lee `~/.bot-secure/keys/<repo-id>.key` o `BOT_SECURE_HMAC_KEY` (crea si falta).
- `pii-mx.mjs`: `validateRFC, validateCURP, validateCLABE, validateNSS, luhn, validateINE, validateIBAN` → `{valid, reason}`; catálogos en `src/engine/catalogs/*.json` (`banxico.json` bancos+plazas, `iin.json`, `entidades.json`, `cp-mx.json`).
- `synthetic-mx.mjs` (lo usa también `db`): `createRng(seed)`, `person(rng) → {nombre, apellidos, rfc, curp, nss, clabe, tarjeta, email, telefono, direccion:{calle, colonia, cp, municipio, estado}}`, `SYNTHETIC_MARKER = 'bot-secure:synthetic'`.
- `columns.mjs`: detector de PII por columna en csv/tsv/sql/json/yaml/xlsx/xml; `office.mjs`: `extractText(path) → {text, partial, kind}`; `encoding.mjs`: `decode(buf) → {text, encoding, binary}`; `flatten.mjs`: `flattenConfig(text, ext) → [{keyPath, value, line}]`.
- `adapters/git-history.mjs`: `scanHistory({root, hmacKey, since?}) → Finding[]` con `cat-file --batch-all-objects`; `adapters/gitleaks.mjs`: `available()`, `candidates(root) → [{commit,file,line,ruleId}]`.
- `baseline.mjs`: `loadBaseline(root)`, `isSuppressed(finding, baseline)`, `add(root, fp, {reason, by, expiresAt})`.

## Policy (`src/policy/`)
- `policy.json` (versionado, `.bot-secure/policy.json`):
```json
{ "version": 1, "project": "tienda", "profile": "sensitive", "level": 1, "mode": "clone", "runtime": "tests",
  "autoSwitch": false, "requireOrgAccount": false, "lang": "es",
  "guard": { "mode": "block", "strictRead": false, "docsReminder": false, "promptBlockSeverity": "HIGH" },
  "branches": { "ai": "ai-dev", "taskPrefix": "ai/", "protected": ["dev","qa","prd","prod","main","master","release/*"] },
  "apps": [ { "name":"backend", "path":"backend", "kind":"backend", "stack":"spring", "envStrategy":"spring-profile",
              "packageManager":"maven", "runCmd":"./mvnw spring-boot:run", "testCmd":"./mvnw -q test", "port":8080,
              "dependsOn":["db"], "remote":"git@github.com:emp/tienda-api.git", "branch":"ai-dev" } ],
  "db": { "engine":"postgres", "port":5433, "database":"app_ai", "user":"app", "generic":false, "rows":1000, "seed":42 },
  "network": { "allowedDomains": [], "registries": [], "prodHosts": [] }, "mcp": { "allowed": [] },
  "owners": { "repoOwner": "", "infosec": "", "platform": "" },
  "scan": { "exclude": [], "failOn": "HIGH", "maxFileSizeMB": 1 } }
```
- `index.mjs`: `loadPolicy(root)`, `savePolicy(root, policy)`, `defaultPolicy({project, apps, db})`, `validatePolicy(policy) → errors[]`, `compile(policy, {os:'darwin'|'linux'|'win32', root}) → Artifact[]` con `Artifact = {path, content, mode?:'0755'}` (genera `.claude/settings.json` de raíz y de cada app, `.claude/hooks/run`, `run.ps1`, `.githooks/*`, workflows CI, `infosec/*`), `writeLock(root, artifacts)`, `readLock(root)`, `verifyIntegrity(root) → {ok, drift:[{path, expected, actual}]}`, `readLocal(root)`, `writeLocal(root, {node, os, shell, sandboxProbe, claudeVersion, account})`.
- `lock.json`: `{ version, rulesVersion, claudeCodeMin:'2.1.246', generated:[{path, sha256}], guardSha256 }`. `local.json` (gitignored): datos de máquina.

## Guard (`src/guard/`)
- `guard.mjs` es autocontenido tras `npm run build` (esbuild lo empaqueta con engine+policy a `dist/guard.mjs`; `init` copia `dist/guard.mjs` a `<ws>/.claude/hooks/guard.mjs`). Uso: `node guard.mjs <evento>` con JSON de Claude Code por stdin. Eventos: `session-start`, `prompt`, `pre-tool`, `post-tool`, `stop`, `session-end`, `config-change`, `statusline`.
- Resuelve raíz con `input.cwd` → `findWorkspaceRoot`; lee `policy.json`, `lock.json`, `local.json`; estado en `<ws>/.claude/state/`; audit en `<ws>/.bot-secure/audit.log` (sin valores de secretos).
- Salidas: `pre-tool` → JSON `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` + exit 0, o exit 2; `prompt`/`stop`/`config-change` → exit 2 para bloquear; `session-start` → JSON `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`; `statusline` → una línea. **Cualquier excepción → exit 2 con mensaje** (fail-closed) salvo `guard.mode:'warn'`.
- `bash-parser.mjs`: `parseBash(cmd) → {segments:[{argv:[], redirects:[]}], vars}`; `classify(segment, ctx) → {reads:[paths], writes:[paths], network:{hosts:[], binary}, envDump:bool, git:{sub, args}}` con expansión de `$VAR`, `~`, `realpath` contra `cwd`.
- `run.sh` / `run.ps1` en `templates/hooks/`: resuelven `node` (`local.json` → `command -v node` → rutas típicas) y ejecutan `guard.mjs`; si no hay node → mensaje + exit 2.

## Detect (`src/detect/`)
```ts
type App = { name, path, kind:'backend'|'frontend'|'mobile'|'lib'|'unknown', stack:string /* spring|dotnet|django|fastapi|flask|laravel|symfony|rails|go|node|nest|express|next|nuxt|vite|angular|cra|vue|svelte|expo|react-native|flutter|android|ios|php|unknown */,
  envStrategy:string, packageManager, manifests:string[], runCmd?, testCmd?, buildCmd?, lintCmd?, port?, registries:string[], sdks:string[], secretManagers:string[], orm?:string, migrationsDir?, hasDockerfile:boolean }
```
- `index.mjs`: `detectApps(root, {apps?}) → App[]` (monorepo: subcarpetas con manifiesto; una app si la raíz es la app), `detectKind(dir)`, `detectStack(dir)`, `detectCommands(dir, stack)`, `detectRegistries(dir)`, `detectSdks(dir)`, `detectSecretManagers(dir)`, `detectOrm(dir)`, `detectClaudeInstall() → {cli?, desktopApp?, version?, configDir}`, `detectAccount() → {type:'org'|'personal'|'unknown', email?, org?}` (lee `~/.claude.json` `oauthAccount`), `detectContainerRuntime() → {kind:'docker'|'podman'|null, compose:string[]}`.

## Workspace (`src/workspace/`)
- `createWorkspace(name, {cwd}) → root` (crea `<name>-ai/`, `git init`, `.bot-secure/policy.json` mínimo, `.gitignore`), `addApp(root, source, {kind, name}) → App` (clona single-branch `ai-dev` o registra subcarpeta; crea `ai-dev` en el remoto si falta vía `src/git`), `cloneWorkspace(root)` (reproduce apps de `policy.apps`), `status(root) → [{app, branch, dirty, behind}]`, `appMap(policy) → string` (bloque markdown para CLAUDE.md/AGENTS.md).

## DB (`src/db/`)
- `detectEngine(apps) → 'postgres'|'mysql'|'mongo'|'redis'|'mssql'|'oracle'|null`, `generate(root, policy) → Artifact[]` (`mocks/db/compose.db.yml`, `init/`, `schema-generic.<engine>.sql`, `migrate.sh`, `seeds/`, `README.md`), `up/down/reset/status/seed/dump(root, policy, opts)` usando `detectContainerRuntime`; sin runtime: `embedded(root, policy)` para postgres (descarga `embedded-postgres`? NO: cero deps → usa `pglite` vía `npx`? tampoco. Decisión: fallback = SQLite para `runtime:tests` + mensaje claro; documentar). Seeds con `synthetic-mx.person()` y `SYNTHETIC_MARKER` en cabecera. Credenciales: `policy.db.user` / contraseña = `__AI_PLACEHOLDER__DB_PASSWORD__` (literal), URL en `.env.ai`.

## Generate (`src/generate/`)
- `generateAll(root, policy, apps) → Artifact[]`: `AGENTS.md`, `CLAUDE.md` (raíz y por app), `README.md` del workspace, `docs/**`, `.claude/rules|skills|agents`, `.env.ai` (raíz y por app), `.env.example`, artefacto `envStrategy` por app (`env-strategies/<stack>.mjs` exporta `{ files(app, policy) → Artifact[], loaderSnippet(app), runCmdAi(app), docs }`), `mocks/*`, `compose.ai.yml`, `.github/*`, `infosec/*`. Plantillas en `templates/**` con `render()`. Placeholders `__AI_PLACEHOLDER__<VAR>__`; fakes tipados en `fakes.mjs` (`fakeFor(kind, name) → string`).
- `sdk-adapters.mjs`: `adaptersFor(app) → [{sdk, snippet, file, docs}]`; `refactor.mjs`: `proposeRefactors(findings, app) → [{file, diff, envVar}]`.

## Git (`src/git/`)
- `ensureAiDevBranch(repo, {from:'dev'})`, `cloneAi(remote, dest, {branch:'ai-dev'})` (single-branch + refspec restringido + submódulos), `verify(repo, policy) → {ok, problems:[{code, fix}]}`, `installHooks(repo, artifacts)` (`core.hooksPath=.githooks`, `+x`), `rewrite({mirrorDir, rules, out})` (fast-export|transform|fast-import; usa filter-repo si existe), `mirror(...)`, `sync(root, policy, {quarantine})`, `exportPatches(...)`, `protectedBranchRe(policy)`.

## Plantillas (`templates/`)
`templates/md/es/*.md` (CLAUDE, AGENTS, README-workspace, docs/*, HU, ADR), `templates/claude/` (rules, skills, agents), `templates/hooks/` (run, run.ps1, pre-commit, pre-push, post-checkout), `templates/db/<engine>/`, `templates/env-strategies/<stack>/`, `templates/ci/github/`, `templates/orgpack/`, `templates/devcontainer/`.
