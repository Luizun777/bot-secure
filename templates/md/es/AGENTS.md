# {{project}} — workspace de IA

**{{project}}** es un workspace de IA preparado por bot-secure: contiene las apps del proyecto ({{appNames}}) en la rama `{{branches.ai}}`, saneada, sin secretos ni datos reales.
Aquí se trabaja con asistentes de IA (Claude Code u otros). Lo generado (`.claude/`, `docs/`, `mocks/`, `.bot-secure/`) vive en la raíz; el código, en la carpeta de cada app.
Perfil `{{profile}}`, nivel {{level}}. El contexto detallado está en `docs/INDEX.md`: léelo antes de un cambio grande.

## Mapa de apps
{{appMap}}
{{#unless hasApps}}
<!-- TODO: registra las apps con `bot-secure workspace add <repo> --kind backend|frontend` y vuelve a correr `bot-secure init`. -->
{{/unless}}

## Comandos verificados (por app, desde su carpeta)
{{#each apps}}
- **{{name}}** (`./{{pathPosix}}`, {{stack}}): dev `{{runCmdAi}}` · test de UN archivo `{{testOneCmd}}`{{#if buildCmd}} · build `{{buildCmd}}`{{/if}}{{#if lintCmd}} · lint `{{lintCmd}}`{{/if}}
{{/each}}
{{#if hasDb}}
- BD de IA ({{db.engine}} en `{{db.hostPort}}`, base `{{db.database}}`): `bot-secure up` · `bot-secure down` · `bot-secure db reset` (regenera datos sintéticos).
{{/if}}
- Estado general: `bot-secure status` · buscar secretos antes de compartir: `bot-secure scan` · abrir Claude protegido: `bot-secure claude`.
{{#if hasConventions}}

## Convenciones que difieren del default
{{#each conventions}}
- {{.}}
{{/each}}
{{/if}}

## Flujo de ramas
`{{branches.taskPrefix}}<ticket>-<slug>` → `{{branches.ai}}` → `dev` → `qa` → `prd`. Trabaja siempre en `{{branches.ai}}` o en una rama `{{branches.taskPrefix}}*` creada desde ella.
Ramas protegidas ({{branches.protectedList}}): nunca commit ni push directo; los cambios llegan por PR a `dev`. `{{branches.ai}}` la actualiza solo CI (`bot-secure sync`).
Commits pequeños, en español, con el ticket; el PR usa `.github/PULL_REQUEST_TEMPLATE.md`.

## Secretos, datos y la regla del campo vacío
- Nunca escribas valores reales: contraseñas, tokens, connection strings, RFC/CURP/CLABE/NSS, tarjetas, correos o teléfonos de personas. Ni en código, ni en docs, ni en tests, ni en prompts.
- **Campo vacío**: en `{{branches.ai}}` los campos sensibles de la configuración versionada quedan `""`. El loader de IA de cada app, con `AI_ENV=1`, toma el valor de `.env.ai`; sin `AI_ENV` falla con un error claro. No los rellenes.
- `.env.ai` (versionado) es la única fuente de valores de IA: placeholders `__AI_PLACEHOLDER__<VAR>__` y fakes marcados `# bot-secure:fake <tipo>`. Los `.env` reales no existen aquí y no se leen.
- Datos de prueba: solo sintéticos (`bot-secure db seed`, marcados `bot-secure:synthetic`). Nunca dumps ni filas de producción.
- ¿Necesitas una credencial nueva? Añade un placeholder a `.env.ai` y documenta la variable en `docs/RUNBOOK.md`.

## Dónde leer más
- `docs/INDEX.md` — una línea por documento y cuándo leerlo.
- `docs/ARCHITECTURE.md` (mapa back ↔ front ↔ BD) · `docs/TESTING.md` · `docs/RUNBOOK.md` · `docs/SECURITY.md` · `docs/LESSONS.md`.
- Historias de usuario en `docs/user-stories/` · decisiones (ADR) en `docs/decisions/`.
