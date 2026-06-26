/**
 * Sanitizes a local name string to be safe for use in filenames.
 * Replaces spaces with underscores and removes special characters.
 * 
 * @param {string} name - The original local name
 * @returns {string} The sanitized local name
 */
export const sanitizeLocalName = (name) => {
  if (!name) return 'Local';
  return String(name)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '');
};

/**
 * Generates a standardized export filename with the format:
 * {prefix}_{nombre_del_local}_{fecha}_{hora}.xlsx
 * 
 * @param {string} localName - The name of the local/store (optional, defaults to "Local")
 * @param {string} prefix - The prefix for the file (optional, defaults to "precios")
 * @returns {string} The complete standardized filename with .xlsx extension
 */
export const generatePriceExportFilename = (localName = 'Local', prefix = 'precios') => {
  const sanitizedName = sanitizeLocalName(localName);
  const now = new Date();

  // Format Date: DDMMYYYY
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const fecha = `${day}${month}${year}`;

  // Format Time: HHMM (24-hour)
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const hora = `${hours}${minutes}`;

  return `${prefix}_${sanitizedName}_${fecha}_${hora}.xlsx`;
};

/**
 * Formats price data into the exact column structure required for export:
 * codigo, nombre, departamento, nuevo_precio
 * 
 * @param {Array} priceData - Array of article objects
 * @returns {Array} Array of formatted objects ready for XLSX conversion
 */
export const formatPriceDataForExport = (priceData) => {
  return priceData.map(item => {
    // Extract the numeric value strictly for nuevo_precio
    const precio = item.nuevo_precio !== undefined ? item.nuevo_precio 
                 : item.precio_nuevo !== undefined ? item.precio_nuevo 
                 : item.valor !== undefined ? item.valor 
                 : 0;
                 
    return {
      codigo: item.codigo || '',
      nombre: item.nombre || '',
      departamento: item.departamento || item.mappedDeptName || 'Sin Departamento',
      nuevo_precio: Number(precio)
    };
  });
};