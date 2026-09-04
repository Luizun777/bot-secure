# bot-secure

**Prepara tu proyecto para usar Claude Code sin exponer contraseñas, tokens ni datos de clientes.**

Crea una carpeta de trabajo segura con tu back, tu front y una base de datos de pruebas. Te avisa si algo sensible se puede filtrar, y bloquea a la IA cuando intenta leer un archivo que no debe o trabajar sobre una rama de producción.

Lo que **no** hace: no garantiza que no queden secretos (ningún escáner lo garantiza) y no cubre otras herramientas de IA como Cursor o Copilot.

*English summary: bot-secure prepares any repo for Claude Code without leaking secrets or PII. It scans (including git history), builds an isolated AI workspace with your backend, frontend and a Dockerized test database, and installs guardrails (permissions, hooks, sandbox) plus the Markdown context Claude reads. Spanish-first CLI. See `docs/`.*

---

## Empieza en 3 comandos

```bash
npm i -g github:tu-org/bot-secure   # 1. instala (necesitas Node 20 o superior)
bot-secure start                    # 2. te guía con preguntas y prepara todo
bot-secure claude                   # 3. abre Claude Code ya protegido
```

Así se ve el segundo paso:

```
$ bot-secure start
¿Cómo se llama el proyecto? [tienda]
¿Repositorio del backend? (Enter para omitir) git@github.com:empresa/tienda-api.git
¿Repositorio del frontend? (Enter para omitir) git@github.com:empresa/tienda-web.git
Motor de base de datos [postgres]

▸ Creando workspace tienda-ai/
▸ backend  → Spring Boot  (puerto 8080)
▸ frontend → Angular      (puerto 4200)
▸ Base de datos de pruebas en 127.0.0.1:5433 con 1000 clientes inventados
▸ Revisando que no haya secretos… 2 hallazgos (ver .bot-secure/reports/report.md)

Listo ✅  Siguiente paso: bot-secure claude
```

---

## ¿Qué necesito?

| Necesitas | Cómo lo compruebas | Si falta |
|---|---|---|
| **Node 20 o superior** | `node -v` | [nodejs.org](https://nodejs.org) |
| **git** | `git --version` | [git-scm.com](https://git-scm.com) |
| Claude Code 2.1.246+ | la app o `claude --version` | [claude.com/code](https://claude.com/code) |
| *Opcional:* Docker, Podman o Colima | `docker -v` | Sin esto la base de datos de pruebas usa un modo reducido |

En Windows: instala Git for Windows, o mejor usa WSL2 (en Windows nativo no hay aislamiento reforzado).

---

## ¿Qué comando uso?

| Quiero… | Escribe |
|---|---|
| Empezar en un proyecto nuevo o existente | `bot-secure start` |
| Abrir Claude Code protegido | `bot-secure claude` |
| Saber si todo está bien | `bot-secure status` |
| Ver el detalle y cómo arreglar lo que falle | `bot-secure doctor` |
| Levantar / bajar la base de datos de pruebas | `bot-secure up` / `bot-secure down` |
| Volver a generar los datos de prueba | `bot-secure db reset` |
| Buscar secretos antes de compartir código | `bot-secure scan` |
| Aceptar un falso positivo | `bot-secure baseline add <huella> --reason "…"` |
| Traer los cambios nuevos de `dev` | `bot-secure sync` |
| Todo lo demás | `bot-secure --help` y [docs/comandos.md](docs/comandos.md) |

---

## ¿Qué me va a crear?

```
tienda-ai/                 ← tu carpeta de trabajo con la IA
├── backend/               ← tu back (Spring, .NET, Django… lo que uses)
├── frontend/              ← tu front (Angular, React, Vue…)
├── CLAUDE.md              ← lo que Claude lee al abrir: dónde está cada cosa
├── docs/                  ← arquitectura, convenciones, historias de usuario
├── mocks/db/              ← la base de datos de pruebas (Docker) y sus datos
├── .env.ai                ← los valores del ambiente de IA (ninguno es secreto)
└── .claude/               ← las reglas que bloquean a Claude cuando toca algo sensible
```

Tu código no se mueve de sitio: `backend/` y `frontend/` son tus repos de siempre, en su rama `ai-dev`.

---

## Cómo trabajo día a día

1. Abre la carpeta con `bot-secure claude`.
2. Pídele a Claude lo que necesites. Ya sabe dónde está el back y el front.
3. Claude trabaja en una rama `ai/<ticket>`, nunca en `dev`.
4. Subes el Pull Request a `dev` como siempre.
5. El revisor aprueba. Un check automático verifica que no se coló ningún secreto.

**Si ves ⛔ en la barra de estado**, es que estás en una rama de producción. Escribe `git switch ai-dev`.

---

## Conceptos en una frase

- **Workspace de IA**: la carpeta `<proyecto>-ai/` con tu back, tu front y todo lo que Claude necesita.
- **Rama `ai-dev`**: la rama donde trabaja la IA, antes de `dev`. Mismo código, ambiente controlado.
- **Campo vacío**: en `ai-dev` dejas las contraseñas y cadenas de conexión **vacías**; el ambiente de IA las rellena solo. Ver [docs/stacks.md](docs/stacks.md).
- **`.env.ai`**: el único archivo con los valores del ambiente de IA. Ninguno es un secreto real.
- **Base de datos de pruebas**: Postgres (o el motor que uses) en Docker, con clientes inventados que parecen reales.
- **Reporte**: la lista de secretos encontrados, siempre enmascarados, para que tú los rotes o los quites.

---

## Ya tengo un proyecto con años de historia

La historia de git guarda todo lo que alguna vez se commiteó: aunque hoy el `.env` no esté, `git log -p` lo recupera. Para esos repos, Claude no trabaja sobre tu repositorio sino sobre un **espejo** con la historia reescrita.

```bash
bot-secure scan --history --build --full    # qué hay que rotar
bot-secure sanitize --refactor auto --apply # saca literales y vacía campos sensibles
```

El flujo completo, paso a paso, está en [docs/avanzado.md](docs/avanzado.md).

---

## Algo no funciona

| Problema | Solución |
|---|---|
| «No encuentro node» o los hooks no hacen nada | `bot-secure doctor` (registra la ruta de node) |
| Claude dice ⛔ o «sesión bloqueada» | Mira la barra: casi siempre es `git switch ai-dev` |
| Un hallazgo es un falso positivo | `bot-secure baseline add <huella> --reason "…"` |
| No tengo Docker | Instala Podman o Colima, o sigue sin base de datos en contenedor |
| Windows sin Git Bash | Instala Git for Windows, o usa WSL2 |
| Mi cuenta de Claude es personal | `doctor` te avisa; lee [docs/infosec.md](docs/infosec.md) |

Más casos en [docs/solucion-de-problemas.md](docs/solucion-de-problemas.md).

---

## Para el equipo de Seguridad

Todo lo que Claude lee viaja a la API de Anthropic: ni un contenedor ni un sandbox cambian eso. Por eso bot-secure sanea el **contenido** antes que nada, y deja evidencia auditable (reportes con hash, `attest`, registro de cada bloqueo).

Qué está garantizado por servidor y qué depende de la máquina del desarrollador, el paquete para desplegar por MDM y el mapeo a OWASP LLM, ISO 27001, SOC 2 y LFPDPPP: [docs/infosec.md](docs/infosec.md).

---

## Reutilizarlo en tu empresa

Haz un fork y ajusta `src/policy/defaults.json` (reglas, severidades, ramas protegidas), los catálogos de `src/engine/catalogs/` y las plantillas de `templates/md/`. Todo el texto visible está en `src/i18n/`.

## Contribuir

```bash
npm install        # solo esbuild, para compilar
npm test           # pruebas unitarias
npm run test:e2e   # pruebas de extremo a extremo
npm run build      # genera dist/
```

Licencia MIT.
