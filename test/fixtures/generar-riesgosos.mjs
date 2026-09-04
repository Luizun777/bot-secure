// Algunos valores de prueba tienen la MISMA forma que una credencial real: aunque son
// inventados, la protección de GitHub los bloquea al subir y cualquier herramienta los
// confundiría. Por eso no se guardan en el repositorio: se arman aquí en tiempo de prueba
// a partir de trozos, de modo que en git no queda ninguna cadena con forma de credencial.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'secrets-falsos');
const hex32 = 'abcdef0123456789'.repeat(2);           // 32 caracteres hexadecimales
const relleno = 'FAKE0000'.repeat(3);

/** Escribe los ficheros de prueba que no pueden vivir en el repositorio. */
export function generarRiesgosos() {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'ia-mail.txt'), [
    `MAILGUN=${'key' + '-' + hex32}`,
    `OPENAI=${'sk' + '-proj-' + 'FAKE0000'.repeat(6)}`,
    `ANTHROPIC=${'sk' + '-ant-api03-' + 'FAKE0000'.repeat(11) + 'FAKE0AA'}`,
    '',
  ].join('\n'));
  writeFileSync(join(DIR, 'slack.txt'), [
    `SLACK_BOT=${'xox' + 'b-1234567890123-1234567890123-' + relleno}`,
    `hook: ${'https://hooks.slack.com/' + 'services/T0000FAKE/B0000FAKE/' + relleno}`,
    '',
  ].join('\n'));
  writeFileSync(join(DIR, 'twilio-sendgrid.txt'), [
    `TWILIO_API_KEY=${'S' + 'K' + hex32}`,
    `SENDGRID=${'SG' + '.' + 'FAKE0000FAKE0000FAKE00' + '.' + 'FAKE0000'.repeat(5) + 'FAK'}`,
    '',
  ].join('\n'));
  return ['ia-mail.txt', 'slack.txt', 'twilio-sendgrid.txt'].map((f) => join(DIR, f));
}
