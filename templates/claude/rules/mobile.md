---
description: Reglas de la app móvil de {{project}} ({{ruleNames}}).
paths: {{rulePaths}}
---
# Móvil — {{ruleNames}}

## Configuración y llaves
- El binario es distribuible: todo lo empaquetado se puede extraer. Nunca embebas claves secretas, contraseñas ni certificados de firma en el código o en los recursos.
- Archivos de servicios (`google-services.json`, `GoogleService-Info.plist`, perfiles de aprovisionamiento, keystores) no viven en este workspace: en IA se usan los de `.env.ai` o fakes.
- Campo sensible en configuración versionada = `""`; se resuelve con `AI_ENV=1` desde `.env.ai`.
- El backend apunta a local (ver mapa de apps en `AGENTS.md`). En emulador Android, `localhost` del host es `10.0.2.2`: usa la variable, no un host de producción.

## Datos en el dispositivo
- Datos personales y tokens solo en el almacenamiento seguro de la plataforma (Keychain / EncryptedSharedPreferences), nunca en preferencias en claro, archivos ni logs.
- Sin datos personales en logs de release; sin telemetría de terceros con PII.
- Permisos: pide solo los que la funcionalidad necesita y justifica cada uno nuevo en el PR.

## Pruebas y datos
- Fixtures y pantallas de ejemplo con datos sintéticos (`bot-secure:synthetic`): nombres inventados, correos `@ai.local`, RFC/CLABE del seed.
- Prueba con red lenta y sin red: los errores no muestran identificadores completos ni detalles del backend.

## Cambios
- Cambio que toca el contrato con el backend → confírmalo en `docs/ARCHITECTURE.md` antes de implementar.
- Tras cada cambio corre el test del archivo tocado (comando en `docs/TESTING.md`) y pega la salida real.
