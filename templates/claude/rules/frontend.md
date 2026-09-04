---
description: Reglas del frontend de {{project}} ({{ruleNames}}).
paths: {{rulePaths}}
---
# Frontend — {{ruleNames}}

## Configuración y llaves
- Todo lo que compila al bundle es **público**: cualquiera lo puede leer en el navegador. Nunca pongas una clave secreta (`sk_…`, `service_role`, client secret, contraseña, token de servidor) en el código del front ni en un archivo de entorno del front.
- Llaves públicas (publishable/anon/site key): en el workspace de IA usa siempre la de test o un fake de `.env.ai`, nunca la de producción.
- Campo sensible en la configuración versionada = `""`; el loader de IA lo resuelve con `AI_ENV=1` desde `.env.ai`. No lo rellenes.
- El backend está en local: usa la URL del mapa de apps de `AGENTS.md`. Nada de hosts de producción, ni siquiera comentados.

## Datos en el cliente
- No guardes datos personales ni tokens en `localStorage`/`sessionStorage` salvo que ya sea el patrón del proyecto y esté documentado.
- No mandes datos personales en la URL (query string) ni a analítica o telemetría de terceros.
- Los ejemplos, mocks y fixtures de UI usan datos sintéticos: nombres inventados, correos `@ai.local`, RFC/CLABE del seed.

## Interfaz
- Textos de cara al usuario en español (México) salvo que el proyecto diga otra cosa; los mensajes de error no muestran identificadores completos ni detalles técnicos del backend.
- Accesibilidad: etiquetas en los campos, foco visible, contraste suficiente. Formularios con datos sensibles: sin autocompletado de navegador para RFC/CLABE/tarjeta.
- Reutiliza los componentes existentes antes de crear uno nuevo; busca primero con el subagente `explorador`.

## Cambios
- Cambio que depende de un endpoint nuevo → confirma el contrato con el backend (`docs/ARCHITECTURE.md`) antes de implementar.
- Tras cada cambio corre el test del archivo tocado (comando en `docs/TESTING.md`) y pega la salida real.
