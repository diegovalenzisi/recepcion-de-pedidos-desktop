import { getLocalId, getCurrentLocalId } from '@/lib/firebase/core';

/**
 * Nombre comercial real del local, tal cual lo carga cada comercio en
 * Configuración → "Nombre de Fantasía" (CONFIGURACION/nombreFantasia,
 * settingsApi.js/GeneralInfo.jsx). `fetchSettings()` cachea ese nodo en
 * `window.__appSettings` apenas arranca la app (App.jsx, antes de que se
 * pueda llegar a Caja o imprimir cualquier ticket), así que leerlo acá es
 * síncrono y no repite ninguna lectura a Firebase.
 *
 * Funciona automáticamente para cualquier local nuevo (JOAO, VITICOS, BURANO,
 * LE POLE PO, etc.) apenas carga su nombre de fantasía — sin mapear localId a
 * mano acá. Si un local todavía no lo cargó, cae al comportamiento histórico
 * (IL CAPO GELATO para 31915636, LANYULINA para el resto) para no dejar un
 * comprobante en blanco.
 * @returns {string}
 */
export const getBusinessName = () => {
  const nombreConfigurado = typeof window !== 'undefined'
    ? String(window.__appSettings?.nombreFantasia || '').trim()
    : '';
  if (nombreConfigurado) return nombreConfigurado;

  const localId = getCurrentLocalId() || getLocalId();
  if (localId === '31915636') return 'IL CAPO GELATO';
  return 'LANYULINA';
};

/**
 * Returns the business name in uppercase
 * @returns {string} Business name in uppercase
 */
export const getBusinessNameUppercase = () => {
  return getBusinessName().toUpperCase();
};

/**
 * Returns location-specific business information
 * @returns {object} Business information including name, formatted name, etc.
 */
export const getBusinessInfo = () => {
  const localId = getCurrentLocalId() || getLocalId();
  const name = getBusinessName();
  
  return {
    name,
    nameUppercase: name.toUpperCase(),
    localId,
    isIlCapo: localId === '31915636',
    isLanyulina: localId !== '31915636'
  };
};