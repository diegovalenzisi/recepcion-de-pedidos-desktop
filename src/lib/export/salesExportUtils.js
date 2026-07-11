import ExcelJS from 'exceljs';

// Exportación de ventas de Caja a un único archivo .xlsx con una sola hoja "Ventas".
// Una fila por venta. Columnas fijas, en este orden exacto (no agregar otras):
export const VENTAS_COLUMNS = [
  { header: 'Fecha de sistema', key: 'fechaSistema', numFmt: 'dd/mm/yyyy' },
  { header: 'Fecha de caja',    key: 'fechaCaja',    numFmt: 'dd/mm/yyyy' },
  { header: 'Turno',            key: 'turno' },
  { header: 'Hora',             key: 'hora' },
  { header: 'Número de pedido', key: 'pedido' },
  { header: 'Tipo de entrega',  key: 'entrega' },
  { header: 'Medio de pago',    key: 'medioPago' },
  { header: 'Total',            key: 'total',        numFmt: '"$"#,##0.00' },
];

// 'dd-MM-yyyy' → Date local (medianoche). Para exportar como fecha REAL de Excel.
const ddmmyyyyToDate = (s) => {
  if (!s || typeof s !== 'string') return null;
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  if (!d || !m || !y) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date) ? null : date;
};

// 'HH:MM:SS' o 'HH:MM' → 'HH:mm'
const toHHmm = (t) => {
  if (!t || typeof t !== 'string') return '';
  const [h, m] = t.split(':');
  if (h === undefined || m === undefined) return t;
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
};

// Medio de pago REAL de la venta: junta los métodos de payments, sin duplicar.
const medioDePago = (sale) => {
  const methods = (sale.payments || [])
    .map((p) => (p && p.method != null ? String(p.method) : ''))
    .filter(Boolean);
  return [...new Set(methods)].join(', ');
};

// Mapea las ventas (shape formateado de fetchSalesForShift) a las filas de export.
// Cada venta = una fila. No inventa campos: usa los reales agregados en formatSale.
export const buildVentasRows = (sales) => {
  return (sales || []).map((s) => ({
    fechaSistema: ddmmyyyyToDate(s.fechaSistema),   // Date | null → fecha real de Excel
    fechaCaja: ddmmyyyyToDate(s.fechacaja),          // Date | null → fecha real de Excel
    turno: s.turno ?? '',
    hora: toHHmm(s.hora),                            // 'HH:mm'
    pedido: s.id != null ? s.id : '',
    entrega: s.entregaTipo || '',                    // Mostrador | Delivery | Retiro
    medioPago: medioDePago(s),
    total: Number(s.total) || 0,                     // número real
  }));
};

// Construye el Workbook de exceljs (núcleo testeable, sin descargar).
export const buildVentasWorkbook = (sales) => {
  const rows = buildVentasRows(sales);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ventas', {
    // Congelar la primera fila (encabezados).
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = VENTAS_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    ...(c.numFmt ? { style: { numFmt: c.numFmt } } : {}),
  }));

  rows.forEach((r) => ws.addRow(r));

  // Encabezados en negrita.
  ws.getRow(1).font = { bold: true };

  // Filtros en los encabezados (A1:H1).
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: VENTAS_COLUMNS.length } };

  // Ancho automático por columna según el contenido (encabezado + celdas).
  ws.columns.forEach((col) => {
    let max = String(col.header || '').length;
    col.eachCell({ includeEmpty: false }, (cell) => {
      let len;
      if (cell.value instanceof Date) len = 10;                 // dd/mm/yyyy
      else if (typeof cell.value === 'number') len = String(Math.round(cell.value)).length + 4;
      else len = String(cell.value ?? '').length;
      if (len > max) max = len;
    });
    col.width = Math.min(Math.max(max + 2, 8), 40);
  });

  const total = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
  return { wb, count: rows.length, total };
};

const triggerDownload = (buffer, fileName) => {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Genera y descarga el .xlsx de ventas. Devuelve { count, total } para verificación.
 * - Una sola hoja "Ventas", una fila por venta.
 * - Primera fila congelada, filtros en encabezados, anchos automáticos.
 * - Fechas reales de Excel; hora HH:mm; total numérico con formato moneda.
 */
export const exportVentasXlsx = async (sales, fileName) => {
  const { wb, count, total } = buildVentasWorkbook(sales);
  const buffer = await wb.xlsx.writeBuffer();
  triggerDownload(buffer, fileName);
  return { count, total };
};

// Nombre de archivo seguro para la exportación.
export const buildVentasFileName = (label) => {
  const safe = String(label || 'ventas').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `Ventas_${safe || 'export'}.xlsx`;
};
