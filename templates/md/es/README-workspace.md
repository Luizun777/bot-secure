# {{project}}-ai — workspace de IA

## ¿Qué es esta carpeta?
Es la copia segura de **{{project}}** para trabajar con Claude Code. Contiene las apps ({{appNames}}) en la rama `{{branches.ai}}`, sin contraseñas, tokens ni datos de clientes, más una base de datos de pruebas con datos inventados.
Lo que Claude lee al abrir está en `CLAUDE.md`, `AGENTS.md` y `docs/`. Lo que lo protege está en `.claude/` y `.bot-secure/` (no los edites a mano).
No garantiza que un secreto pegado a mano no viaje a la API: si lo ves, no lo copies y avisa.

## Empieza
```bash
bot-secure claude      # abre Claude Code ya protegido, desde esta carpeta
```
Si es tu primer día, dentro de Claude escribe `/bootstrap-contexto` para que complete `docs/` leyendo el código (sin copiar valores reales).

## ¿Qué comando uso?
| Quiero… | Escribe |
|---|---|
| Abrir Claude Code protegido | `bot-secure claude` |
| Saber si todo está bien | `bot-secure status` (detalle: `bot-secure doctor`) |
{{#if hasDb}}
| Levantar / bajar la BD de pruebas ({{db.engine}} en `{{db.hostPort}}`) | `bot-secure up` / `bot-secure down` |
| Volver a generar los datos de prueba | `bot-secure db reset` |
{{/if}}
{{#each apps}}
| Arrancar **{{name}}** en modo IA (desde `./{{pathPosix}}`) | `{{runCmdAi}}` |
| Correr UN test de **{{name}}** | `{{testOneCmd}}` |
{{/each}}
| Buscar secretos antes de compartir código | `bot-secure scan` |
| Aceptar un falso positivo | `bot-secure baseline add <id> --reason "…"` |
| Traer los cambios nuevos de `dev` | `bot-secure sync` |
| Todo lo demás | `bot-secure --help` |

## Dónde está cada cosa
{{#each apps}}
- `{{pathPosix}}/` — {{kindLabel}} ({{stack}}{{#if hasPort}}, puerto {{port}}{{/if}}). Tiene su propio `CLAUDE.md` corto.
{{/each}}
- `docs/` — arquitectura, convenciones, pruebas, runbook, seguridad, glosario, decisiones (ADR) e historias de usuario (HU). Empieza por `docs/INDEX.md`.
{{#if hasDb}}
- `mocks/db/` — la base de datos de pruebas ({{db.engine}}): compose, esquema y datos sintéticos marcados `bot-secure:synthetic`.
{{/if}}
- `.env.ai` — valores del ambiente de IA (placeholders y fakes). Es la única fuente; los `.env` reales no existen aquí.
- `.claude/` — reglas, skills, agentes y guardas de Claude Code. `.bot-secure/` — política, lock y reportes del bot.
- `.github/` — plantilla de PR y CODEOWNERS (rutas protegidas por InfoSec).

## Si algo falla
- ⛔ en la barra de estado de Claude → estás en una rama protegida: `git switch {{branches.ai}}` (o `git -C <app> switch {{branches.ai}}`).
- "node no encontrado" al arrancar un hook → `bot-secure doctor` te dice la ruta y la escribe en `.bot-secure/local.json`.
- Un hook bloqueó una acción → el motivo está en `.bot-secure/audit.log`; casi siempre es rama o secreto.
- La app no arranca y pide una variable → falta en `.env.ai`: añade un placeholder y anótala en `docs/RUNBOOK.md`.
- Falso positivo del escáner → `bot-secure baseline add <id> --reason "…"` con revisión humana.
- Docker/Podman no instalado → `bot-secure doctor` indica el fallback disponible para {{db.engine}}.
- Cualquier otra cosa → `bot-secure doctor` y `docs/RUNBOOK.md`.
