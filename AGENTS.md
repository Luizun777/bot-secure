# bot-secure

CLI en Node (ESM, cero dependencias de runtime) que prepara cualquier proyecto para usar Claude Code sin exponer secretos ni PII: escanea, crea el workspace de IA (`<proyecto>-ai/` con back y front dentro), la rama `ai-dev`, una BD de pruebas en Docker, las guardas de Claude Code (permissions + hooks + sandbox) y la estructura de contexto `.md`.

## Mapa del repo
- `bin/bot-secure.mjs` — dispatcher: descubre comandos en `src/cli/*.mjs`, flags globales, i18n, exit codes.
- `src/cli/` — un archivo por comando (`export default { name, aliases, summary, usage, run(ctx) }`).
- `src/engine/` — motor de detección (walker, reglas, entropía, PII MX, reporte). Contrato en `CONTRACTS.md`.
- `src/policy/` — `policy.json` → `settings.json`/hooks/CI; `lock.json` (versionado) vs `local.json` (gitignored).
- `src/guard/` — `guard.mjs` (hooks de Claude Code; se empaqueta a `dist/guard.mjs` y se copia al workspace), `run.sh`/`run.ps1`.
- `src/detect/`, `src/workspace/`, `src/db/`, `src/generate/`, `src/git/` — ver `CONTRACTS.md`.
- `templates/` — plantillas (MD en español, settings, hooks, compose, loaders por stack).
- `test/unit` (`node:test`), `test/e2e` (repos temporales; evidencia real en `test/e2e/evidence/`).

## Comandos
- Test de UN archivo: `node --test test/unit/<archivo>.test.mjs`
- Todos los unit: `npm test` · e2e: `npm run test:e2e` · build: `npm run build`
- Probar el CLI desde el código: `node bin/bot-secure.mjs --help`

## Convenciones (las que difieren del default)
- Cero dependencias de runtime. Solo `node:` built-ins. esbuild solo para `build`.
- Mensajes al usuario SIEMPRE vía i18n (`src/i18n/<lang>/<módulo>.json`, `t('modulo.clave')`), en español por defecto. Todo mensaje de error incluye el comando exacto de arreglo (`fix`).
- Exit codes: 0 ok · 1 hallazgos/violación · 2 error · 3 drift.
- Fail-closed: si una guarda no puede evaluar, bloquea.
- Nunca escribir el valor de un secreto en logs, reportes ni tests (usar máscara + HMAC). Los fixtures usan secretos FALSOS con sufijo `EXAMPLE`/`AIPLACEHOLDER`.
- Cada módulo es dueño de su carpeta; los archivos compartidos (`bin/`, `src/lib/`, `package.json`) se cambian solo con acuerdo.
- Ramas: `ai/*` → `dev`; nunca commitear en `main` directo salvo bootstrap.

## Seguridad
- No leer `.env*`, `*.pem`, `~/.aws` etc. El bot se aplica a sí mismo (`.bot-secure/`).
- Ver `docs/` para el diseño completo.
