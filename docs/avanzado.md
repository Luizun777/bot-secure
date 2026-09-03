# Flujo avanzado: proyectos con años de historia

> Lee esto si tu repo ya existe y probablemente tiene secretos commiteados en algún momento.

## La idea en una frase

La historia de git conserva todo lo que alguna vez se commiteó. Aunque hoy el `.env` no esté, `git log -p` lo recupera. Por eso, para repos con historia, Claude no trabaja sobre tu repo: trabaja sobre un **repo espejo** (`<repo>-ai`) cuya historia fue reescrita para quitar los valores reales.

## Pasos (por cada repo)

```bash
# 1. Escanea todo: árbol, historia completa y artefactos de build
bot-secure scan --history --build --full
```
Abre `.bot-secure/reports/report.md`. Cada hallazgo trae qué hacer: **rotar** (un secreto que estuvo en git se considera comprometido, aunque ya no esté), **mover a variable de entorno** o **dejar el campo vacío**. Plazo recomendado: 24 h.

```bash
# 2. Saca los literales del código y vacía los campos sensibles de la configuración
bot-secure sanitize --refactor auto --dry-run     # muestra el diff
bot-secure sanitize --refactor auto --apply       # lo aplica en tu rama dev
```
Después de este paso, `HEAD` de `dev` ya no tiene valores reales: solo variables de entorno y campos vacíos. Haz PR normal a `dev`.

```bash
# 3. Crea el espejo con la historia reescrita (v1.1)
bot-secure sanitize --mirror --dry-run --target git@github.com:empresa/tienda-api-ai
bot-secure sanitize --mirror --apply   --target git@github.com:empresa/tienda-api-ai
```
El espejo contiene el 100 % de los archivos; solo los valores reales fueron reemplazados en todos los commits. Los archivos binarios con secretos (keystores, `.p12`, dumps) se eliminan de la historia con reglas `path:`.

```bash
# 4. Añade el espejo al workspace de IA y prepara todo
cd ../tienda-ai
bot-secure workspace add git@github.com:empresa/tienda-api-ai --kind backend
bot-secure init
```

## Cómo vuelven los cambios de Claude a `dev`

En el espejo Claude trabaja en ramas `ai/<ticket>`. Un job de CI (`ai-return.yml`) toma cada PR aprobado en el espejo, lo convierte en parches (`export-patches`), los aplica sobre `dev` en el repo original y abre el PR allí. Si un parche no aplica, el job comenta en el PR del espejo qué archivo conflictúa.

## Ramas: quién puede tocar qué

```
ai/<ticket>  →  ai-dev  →  dev  →  qa  →  prd
```

- `ai/*`: ramas de trabajo de Claude. Es lo único a lo que Claude puede hacer `push`.
- `ai-dev`: base de la IA. Solo la actualiza el job de CI `ai-sync.yml` cuando `dev` cambia.
- `dev`, `qa`, `prd`: protegidas. Cualquier rama puede ir a `dev` por PR, pero el check `bot-secure` es obligatorio para todas.

Si `dev` recibe un secreto nuevo, `sync` no congela al equipo: reemplaza ese valor en el commit de saneamiento de `ai-dev`, sigue, y abre un incidente con plazo.

## Qué bloquea cada guarda

| Momento | Guarda | Qué hace |
|---|---|---|
| Abrir Claude Code | `SessionStart` | Verifica integridad, cuenta, ramas de cada app, clon correcto. Si algo falla, marca la sesión como bloqueada. |
| Escribir un prompt | `UserPromptSubmit` | Rechaza el prompt si la sesión está bloqueada o si contiene un secreto/PII. |
| Cada herramienta | `PreToolUse` | Bash tratado como lector: `cat`, `sed`, `python -c`… sobre archivos sensibles se niega; red solo a dominios permitidos; sin `git switch dev`; sin escribir secretos. |
| Cerrar sesión | `SessionEnd` | Escanea el transcript; si algo sensible viajó, crea `INCIDENT-*.md`. |
| `git commit` / `git push` | hooks git | Escanea lo staged; prohíbe push a `dev/qa/prd` desde ramas de IA. |
| PR a `dev` | CI | Check `bot-secure` obligatorio. |

## Niveles de aislamiento

- **Nivel 0**: hooks + reglas `deny` (todo sistema operativo).
- **Nivel 1** (por defecto en macOS/Linux/WSL2): + sandbox nativo de Claude Code (archivos y red). Perfil `sensitive` exige que esté activo.
- **Nivel 2**: + devcontainer endurecido (`bot-secure init --level 2`, requiere Docker/Podman).
- **Nivel 3**: máquina virtual dedicada.

En Windows nativo no hay sandbox: usa WSL2 para repos sensibles.

## Modo `runtime`

- `tests` (por defecto): Claude corre tests, lint y build con `AI_ENV=1`. Es lo que necesita el 90 % del trabajo.
- `app`: además levanta la app completa contra la BD de pruebas y mocks (IdP, colas, APIs de terceros). Requiere más preparación por repo; actívalo en `policy.json` cuando lo necesites.
