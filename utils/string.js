/**
 * Sanitiza o nome do período para uso como chave de dataset HTML.
 * @param {string} periodo - Ex: "1° Trim"
 * @returns {string} - Ex: "1Trim"
 */
function sanitizePeriodoKey(periodo) {
  return (periodo || '').replace(/\s+/g, '').replace(/[°º]/g, '');
}
