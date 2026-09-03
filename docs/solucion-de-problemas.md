# Algo no funciona

Antes que nada: `bot-secure doctor`. Cada fila que falla trae su `Arreglo:`.

## "No encuentro node" o los hooks no hacen nada

Claude Code ejecuta los hooks con un PATH mínimo. El bot resuelve `node` desde `.bot-secure/local.json` (lo escribe `doctor`), luego busca en el PATH y en rutas típicas (nvm, fnm, volta, Homebrew, `Program Files\nodejs`). Si no lo encuentra, **bloquea** (no permite) y te dice el comando.

```bash
bot-secure doctor          # registra la ruta de node en local.json
```

## Claude dice ⛔ o "Sesión bloqueada"

Mira la barra de estado: dice qué app está en una rama prohibida o qué falló. Lo normal:

```bash
git -C backend switch ai-dev      # o la app que indique
```
Si el motivo es "integridad" (alguien editó `.claude/settings.json` a mano): `bot-secure doctor` muestra el drift; regenera con `bot-secure policy compile` o revierte el cambio.

Para ver por qué se negó algo: `.bot-secure/audit.log`.

## Un hallazgo es un falso positivo

```bash
bot-secure baseline add <huella> --reason "clave de prueba oficial de reCAPTCHA" --expires 2026-12-31
```
La huella aparece en el reporte. Los hallazgos HIGH y CRITICAL requieren además la aprobación de otra persona en el PR (CODEOWNERS).

## No tengo Docker

Instala Podman, Colima u OrbStack, o sigue sin BD en contenedor: `doctor` te dirá qué queda cubierto. Ver [base-de-datos.md](base-de-datos.md).

## Windows

- Instala **Git for Windows** (trae `sh.exe`, necesario para los hooks git) o usa **WSL2** (recomendado; en Windows nativo no hay sandbox).
- Si Claude Code usa PowerShell, el bot genera `run.ps1`; `doctor` te dice cuál está usando.

## Uso la app de escritorio y `claude` no está en el PATH

Normal. `bot-secure doctor` detecta la app. Abre la app **en la raíz del workspace** (la carpeta `<proyecto>-ai/`), no en una subcarpeta ni en la carpeta padre: las guardas solo se cargan desde ahí. `bot-secure claude` te lo recuerda si no hay CLI.

## Mi cuenta de Claude es personal

`doctor` lo avisa. Apaga "Help improve Claude" en claude.ai/settings/privacy y lee [infosec.md](infosec.md) para la recomendación de plan.

## El sandbox bloquea `npm install` / `mvn` / `pip`

Falta el registro de tu stack en la lista de dominios permitidos. `init` los detecta (`.npmrc`, `pip.conf`, `settings.xml`, `NuGet.Config`, `GOPROXY`); si usas un registro privado añádelo en `policy.json` → `network.registries` y ejecuta `bot-secure policy compile`.

## `doctor` termina con código 3

Drift: un archivo generado cambió. Revisa `git diff .claude .githooks` y regenera o revierte.

## El gate de CI falla por "placeholder-leak"

Un `__AI_PLACEHOLDER__` o un valor `bot-secure:fake` llegó a `dev`. Deja el campo vacío o usa la variable de entorno; los valores de IA viven solo en `.env.ai`.
