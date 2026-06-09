import * as XLSX from 'xlsx';

export const exportOptionalsToExcel = (optionals, groups) => {
  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2, '0')}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getFullYear()}`;
  const filename = `opcionales_${dateStr}.xlsx`;

  const groupMap = groups.reduce((acc, group) => {
    acc[group.id] = group.nombre;
    return acc;
  }, {});

  const data = optionals.map(opt => ({
    Orden: opt.numeroOrden !== undefined ? opt.numeroOrden : '',
    Código: opt.codigo || '',
    Nombre: opt.nombre || '',
    Grupo: groupMap[opt.grupo] || 'Sin Grupo'
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Opcionales');
  
  XLSX.writeFile(workbook, filename);
};

export const mapGroupNameToId = (groupName, groups) => {
  if (!groupName) return null;
  const normalizedName = String(groupName).trim().toLowerCase();
  const group = groups.find(g => String(g.nombre).trim().toLowerCase() === normalizedName);
  return group ? group.id : null;
};

export const validateOptionalRow = (row, index, groups) => {
  const errors = [];
  
  const ordenRaw = row['Orden'];
  const codigo = String(row['Código'] || '').trim();
  const nombre = String(row['Nombre'] || '').trim();
  const grupoName = String(row['Grupo'] || '').trim();

  let numeroOrden = '';
  if (ordenRaw !== undefined && ordenRaw !== null && ordenRaw !== '') {
    const parsed = Number(ordenRaw);
    if (isNaN(parsed)) {
      errors.push('El campo Orden debe ser un número válido o estar vacío.');
    } else {
      numeroOrden = parsed;
    }
  }

  if (!codigo) errors.push('El Código es obligatorio.');
  if (!nombre) errors.push('El Nombre es obligatorio.');
  if (!grupoName) errors.push('El Grupo es obligatorio.');

  const grupoId = mapGroupNameToId(grupoName, groups);
  if (grupoName && !grupoId) {
    errors.push(`El Grupo '${grupoName}' no existe en la base de datos.`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      numeroOrden: numeroOrden,
      codigo,
      nombre,
      grupo: grupoId,
      grupoName: grupoName,
      rowNumber: index + 2
    }
  };
};

export const formatOptionalForFirebase = (parsedData) => {
  return {
    numeroOrden: parsedData.numeroOrden,
    codigo: parsedData.codigo,
    nombre: parsedData.nombre,
    grupo: parsedData.grupo,
    activo: true
  };
};

export const parseOptionalsExcel = async (file, groups) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

        if (rows.length === 0) {
          resolve({ validRows: [], invalidRows: [], globalError: 'El archivo está vacío.' });
          return;
        }

        const headers = Object.keys(rows[0]);
        const requiredHeaders = ['Orden', 'Código', 'Nombre', 'Grupo'];
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));

        if (missingHeaders.length > 0) {
          resolve({ 
            validRows: [], 
            invalidRows: [], 
            globalError: `Faltan columnas requeridas: ${missingHeaders.join(', ')}` 
          });
          return;
        }

        const validRows = [];
        const invalidRows = [];

        rows.forEach((row, index) => {
          // Skip completely empty rows
          if (!row['Código'] && !row['Nombre'] && !row['Grupo']) return;

          const validation = validateOptionalRow(row, index, groups);
          if (validation.isValid) {
            validRows.push(validation.data);
          } else {
            invalidRows.push(validation);
          }
        });

        resolve({ validRows, invalidRows, globalError: null });
      } catch (err) {
        resolve({ validRows: [], invalidRows: [], globalError: 'Error al leer el archivo Excel.' });
      }
    };
    reader.onerror = () => reject(new Error('Error de lectura del archivo'));
    reader.readAsArrayBuffer(file);
  });
};