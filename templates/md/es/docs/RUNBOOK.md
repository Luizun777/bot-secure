# Runbook — {{project}} (modo IA)

Lee esto cuando algo no arranque, necesites una variable nueva o quieras levantar el ambiente completo. Todo aquí apunta a servicios locales; nada a producción.

## Arranque rápido
```bash
bot-secure up          # BD de IA{{#if hasDb}} ({{db.engine}} en {{db.hostPort}}){{/if}} y mocks
bot-secure status      # ramas, BD, sandbox, cuenta
```
Luego, por app (cada una en su carpeta). En PowerShell usa `$env:AI_ENV=1` antes del comando.
{{#each apps}}
- **{{name}}** (`./{{pathPosix}}`{{#if hasPort}}, escucha en :{{port}}{{/if}}): `{{runCmdAi}}`{{#if consumes}} — necesita `{{consumesName}}` arriba en `{{consumes}}`{{/if}}{{#if usesDb}} — necesita la BD de IA{{/if}}
{{/each}}

## Cómo funciona `AI_ENV=1`
Los campos sensibles de la configuración versionada están vacíos (`""`). El loader de IA de cada app, si `AI_ENV=1`, toma el valor de `.env.ai` (raíz y de la app); si no hay `AI_ENV`, falla al arrancar nombrando el campo. No rellenes los campos: añade la variable a `.env.ai`.

## Base de datos de IA
{{#if hasDb}}
- Motor {{db.engine}}, host `{{db.hostPort}}`, base `{{db.database}}`, usuario `{{db.user}}`; contraseña = placeholder definido en `.env.ai` (es literalmente la contraseña del contenedor).
- `bot-secure db status` · `bot-secure db reset` (borra el volumen y re-siembra) · `bot-secure db seed --rows N` · `bot-secure db dump --synthetic` (exporta seeds para CI).
- Esquema: migraciones del proyecto si existen; si no, esquema genérico (`mocks/db/schema-generic.{{db.engine}}.sql`). Datos sintéticos es_MX marcados `bot-secure:synthetic`.
- No existe `db import`: los dumps reales no entran a este workspace.
{{/if}}
{{#unless hasDb}}
Sin motor configurado. Define `db.engine` en `.bot-secure/policy.json` y corre `bot-secure db init`.
{{/unless}}

## Puertos
| Servicio | Puerto local |
|---|---|
{{#each apps}}
| {{name}} | {{#if hasPort}}{{port}}{{/if}}{{#unless hasPort}}(pendiente){{/unless}} |
{{/each}}
{{#if hasDb}}
| BD de IA ({{db.engine}}) | {{db.port}} (solo 127.0.0.1) |
{{/if}}

## Matriz de dependencias externas → mock en IA
| Dependencia | En IA se resuelve a | Estado |
|---|---|---|
{{#if hasDb}}
| Base de datos | contenedor {{db.engine}} del workspace | listo |
{{/if}}
| Identidad (OIDC/JWT) | IdP mock (`bot-secure mocks idp`) | <!-- TODO: confirmar proveedor real (solo el nombre) --> |
| Pagos / mensajería / correo | adaptador por SDK → stub local o modo test del proveedor | <!-- TODO: listar SDKs detectados --> |
| Almacenamiento (S3/Blob) | endpoint local o carpeta | <!-- TODO --> |
| Otros servicios internos | pendiente | <!-- TODO: nombre del servicio, sin host -->  |

## Variables de `.env.ai`
Documenta aquí cada variable nueva: nombre, para qué sirve, tipo de valor (placeholder o fake) y qué app la usa. Nunca el valor real.
<!-- TODO: tabla VARIABLE | app | tipo | para qué -->

## Problemas frecuentes
- ⛔ en la barra de Claude → `git switch {{branches.ai}}` (o `git -C <app> switch {{branches.ai}}`).
- "node no encontrado" en hooks → `bot-secure doctor` (escribe la ruta en `.bot-secure/local.json`).
- Hook bloqueó → motivo en `.bot-secure/audit.log`.
- Puerto ocupado → cambia `port` en `.bot-secure/policy.json` y `bot-secure init`.
- La app pide un campo de configuración → falta en `.env.ai`; añade placeholder y documenta arriba.
