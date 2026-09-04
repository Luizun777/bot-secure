# Todos los comandos

Opciones globales: `--json` · `--dry-run` · `--yes` · `--lang es|en` · `--help` · `--version`

Códigos de salida: **0** todo bien · **1** se encontraron hallazgos o hubo una violación · **2** error · **3** los archivos generados fueron modificados a mano (drift).

## Los que usarás siempre

| Comando | Para qué sirve | Ejemplo |
|---|---|---|
| `start` | Asistente: detecta dónde estás, pregunta lo mínimo y prepara todo (workspace → init → base de datos → verificación) | `bot-secure start` |
| `claude` | Abre Claude Code en el workspace con el entorno limpio y las reglas activas | `bot-secure claude` |
| `status` | Resumen en una pantalla: ramas de cada app, base de datos, aislamiento | `bot-secure status` |
| `doctor` | Diagnóstico completo. Cada fila que falla trae su `Arreglo:` | `bot-secure doctor --smoke` |
| `up` / `down` | Levanta o baja la base de datos de pruebas y los mocks | `bot-secure up` |

## Workspace y apps

| Comando | Para qué sirve |
|---|---|
| `workspace create <nombre>` | Crea la carpeta `<nombre>-ai/` |
| `workspace add <repo\|ruta> --kind backend\|frontend\|mobile` | Añade una app: clona su rama `ai-dev` dentro del workspace |
| `workspace clone` | Reproduce el workspace completo en otra máquina |
| `workspace status` | Rama, cambios sin commitear y retraso de cada app |
| `init [--level 0\|1\|2] [--mode clone\|mirror\|worktree] [--profile standard\|sensitive]` | Genera todo: contexto Markdown, reglas de Claude, hooks, base de datos, CI |
| `branch clone-ai\|create\|verify [--fix]` | Crea la rama `ai-dev` y el clon aislado; `verify` comprueba que el clon no arrastre `dev`/`qa`/`prd` |

## Base de datos y mocks

| Comando | Para qué sirve |
|---|---|
| `db init` | Genera `mocks/db/` (compose, esquema o migraciones, datos sintéticos) |
| `db up` / `db down` | Levanta o baja el contenedor |
| `db reset` | Borra el volumen y regenera datos idénticos (misma semilla) |
| `db seed --rows N --seed n` | Genera más filas |
| `db dump --synthetic` | Exporta los datos a `mocks/db/seeds/` para CI |
| `db status` | Motor, puerto, filas cargadas |
| `mocks up\|down\|status` | Servicios auxiliares (Redis, MinIO, WireMock, Prism, Mailpit) |
| `mocks idp` | Proveedor de identidad simulado (OAuth2/OIDC) con JWKS local |
| `mocks keys generate` | Llaves y certificados desechables para el ambiente de IA |

Detalles en [base-de-datos.md](base-de-datos.md).

## Buscar y limpiar secretos

| Comando | Para qué sirve |
|---|---|
| `scan` | Escanea el árbol de trabajo |
| `scan --history` | Escanea **toda la historia de git**, incluidos objetos inalcanzables |
| `scan --build` | Incluye artefactos compilados (`dist/`, `target/`, `.apk`, `.jar`) |
| `scan --full` | Sin límite de tamaño de archivo |
| `scan --staged` | Solo lo que está en el índice (lo usa el hook de `git commit`) |
| `scan --placeholder-leak` | Busca valores del ambiente de IA que se colaron a `dev`/`qa`/`prd` |
| `scan --fail-on SEV` | Código de salida 1 a partir de esa severidad |
| `sanitize --dry-run` | Muestra qué cambiaría, sin tocar nada |
| `sanitize --refactor auto --apply` | Saca literales a variables de entorno y deja vacíos los campos sensibles |
| `sanitize --mirror --apply --target <repo>` | Crea el repo espejo con la historia reescrita |
| `baseline add <huella> --reason --by --expires` | Acepta un falso positivo (los HIGH y CRITICAL requieren segunda persona) |
| `baseline list` / `baseline expire <huella>` | Consulta y caducidad de excepciones |

El reporte nunca contiene el valor del secreto: solo una máscara y una huella criptográfica.

## Equipo y auditoría

| Comando | Para qué sirve |
|---|---|
| `sync` | Trae los cambios de `dev` a `ai-dev` (normalmente lo hace CI) |
| `export-patches <rama>` | Convierte el trabajo del espejo en parches para el repo original |
| `ci github [--mode warn\|block]` | Genera los workflows del gate obligatorio |
| `org-pack` | Paquete para Seguridad: managed settings, protección de ramas, checklist |
| `attest --rotation-id <ticket>` | Manifiesto de evidencia con hashes y versiones |
| `policy compile\|diff\|validate` | Regenera los archivos de configuración desde `policy.json` |
| `guard <evento>` | Uso interno: es lo que Claude Code ejecuta en cada hook |

## Qué genera el bot y para qué sirve

| Archivo | Para qué | Quién lo mantiene |
|---|---|---|
| `CLAUDE.md` | Lo primero que lee Claude: mapa de apps y reglas críticas | El bot; tú añades lecciones |
| `AGENTS.md` | Lo mismo para otras herramientas (Cursor, Copilot) | El bot |
| `.claude/settings.json` | Qué puede y qué no puede hacer Claude | El bot (no editar a mano) |
| `.claude/hooks/guard.mjs` | El vigilante que bloquea en tiempo real | El bot |
| `.claude/rules/*.md` | Reglas por tipo de archivo (back, front, tests, docs) | Tú |
| `.claude/skills/*` | Comandos `/hu`, `/adr`, `/bootstrap-contexto` | Tú |
| `docs/ARCHITECTURE.md` y demás | Contexto que Claude lee cuando lo necesita | Tú, con ayuda de Claude |
| `docs/user-stories/` | Historias de usuario con criterios en Gherkin español | Tú |
| `.env.ai` | Valores del ambiente de IA | El bot |
| `mocks/db/` | Base de datos de pruebas | El bot |
| `.bot-secure/policy.json` | La política del proyecto | Tú (con revisión de Seguridad) |
| `.githooks/` | Verificaciones al hacer commit y push | El bot |

## Plantilla de historia de usuario

```markdown
---
id: HU-0001
epica: Autenticación
estado: refinada
prioridad: alta
owner: nombre.apellido
datos-sensibles: [ninguno]
---

## Historia
**Como** cliente registrado, **quiero** entrar con mi correo y contraseña, **para** ver mis pedidos.

## Criterios de aceptación
```gherkin
# language: es
Característica: Inicio de sesión
  Escenario: Credenciales correctas
    Dado que existe un cliente con correo "ana@ai.local"
    Cuando envía su correo y contraseña correctos
    Entonces recibe un token de sesión válido
```

## Datos sensibles involucrados
Ninguno. Los datos de prueba son sintéticos.

## Definición de Hecho
- [ ] Las pruebas pasan con `AI_ENV=1`
- [ ] No hay datos reales en fixtures
- [ ] Documentación actualizada
```
