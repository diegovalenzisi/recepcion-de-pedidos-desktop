import { getLocalId, getCurrentLocalId } from '@/lib/firebase/core';

/**
 * Returns the business name based on the current local ID
 * @returns {string} "IL CAPO GELATO" for local 31915636, "LANYULINA" for all others
 */
export const getBusinessName = () => {
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