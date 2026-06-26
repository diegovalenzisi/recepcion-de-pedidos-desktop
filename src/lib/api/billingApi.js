import { getDatabase, ref, get } from 'firebase/database';
import { getLocalId } from '@/lib/firebase/core';

export const fetchBillingData = async () => {
  const localId = getLocalId();
  if (!localId) {
    throw new Error('Local ID no está configurado.');
  }

  const db = getDatabase();
  const salesRef = ref(db, `${localId}/VENTAS`);

  try {
    const snapshot = await get(salesRef);
    if (snapshot.exists()) {
      const salesData = snapshot.val();
      const salesArray = Object.keys(salesData).map(key => ({
        id: key,
        ...salesData[key],
      }));
      
      salesArray.sort((a, b) => {
        const fechaA = a.FECHA || a.fecha;
        const horaA = a.HORA || a.hora;
        const fechaB = b.FECHA || b.fecha;
        const horaB = b.HORA || b.hora;

        if (!fechaA || !horaA || !fechaB || !horaB) {
          return 0;
        }
        try {
          const dateA = new Date(`${fechaA.split('/').reverse().join('-')}T${horaA}`);
          const dateB = new Date(`${fechaB.split('/').reverse().join('-')}T${horaB}`);
          if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return 0;
          return dateB - dateA;
        } catch (e) {
          return 0;
        }
      });

      return salesArray.map(sale => ({
        id: sale.id,
        fecha: sale.FECHA || sale.fecha,
        hora: sale.HORA || sale.hora,
        numeroFactura: sale.NumeroFactura || sale.id,
        importe: sale.total || sale.TOTAL || sale.IMPORTE || 0,
        articulos: sale.ARTICULOS || [],
        cliente: sale.CLIENTE,
        modo: sale.MODO,
        pdfBase64: sale.PDF_BASE64,
      }));
    }
    return [];
  } catch (error) {
    console.error('Error fetching billing data:', error);
    throw error;
  }
};