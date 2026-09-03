// Errores y códigos de salida del bot. Todo error para el usuario lleva un comando de arreglo.
export const EXIT = Object.freeze({ OK: 0, FINDINGS: 1, ERROR: 2, DRIFT: 3 });

export class BotSecureError extends Error {
  /**
   * @param {string} key clave i18n del mensaje (p. ej. 'cli.unknownCommand')
   * @param {object} [opts]
   * @param {object} [opts.vars] variables para el mensaje
   * @param {string} [opts.fix] comando exacto de arreglo (obligatorio salvo errores internos)
   * @param {number} [opts.exitCode]
   */
  constructor(key, { vars = {}, fix = null, exitCode = EXIT.ERROR, cause } = {}) {
    super(key, cause ? { cause } : undefined);
    this.name = 'BotSecureError';
    this.key = key; this.vars = vars; this.fix = fix; this.exitCode = exitCode;
  }
}
