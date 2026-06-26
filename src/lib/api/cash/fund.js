import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { formatDateForFirebase } from '@/lib/utils';

export const setInitialCashFund = async (shiftId, amount, dateString) => {
  checkLocalId();
  const API_URL = getFirebaseUrl();
  const LOCAL_ID = getCurrentLocalId();

  if (!shiftId || !dateString) {
    throw new Error("Shift ID and date are required to set the initial fund.");
  }
  
  const shiftRefUrl = `${API_URL}/${LOCAL_ID}/CAJAS/${dateString}/turnos/${shiftId}.json`;
  
  const payload = { 
    fondoInicial: amount,
  };

  const response = await fetch(shiftRefUrl, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error("No se pudo actualizar el fondo de caja.");

  const shiftResponse = await fetch(shiftRefUrl);
  if (!shiftResponse.ok) throw new Error("Could not retrieve updated shift data.");
  return await shiftResponse.json();
};