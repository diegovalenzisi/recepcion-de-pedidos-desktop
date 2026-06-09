import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';

const getEntityPath = (entity) => {
  const paths = {
    'articulos': 'ARTICULOS',
    'materia-prima': 'MATERIA_PRIMA',
    'opcionales': 'OPCIONALES',
    'departamentos': 'DEPARTAMENTOS',
    'grupos-opcionales': 'GRUPOS_OPCIONALES',
    'clientes': 'CLIENTES',
    'repartidores': 'REPARTIDORES',
    'usuarios': 'USUARIOS',
    'cajas': 'CAJAS',
    'turnos': 'TURNOS',
    'configuracion': 'CONFIGURACION',
    'pedidos': 'PEDIDOS',
    'transacciones': 'TRANSACCIONES',
    'gastos': 'GASTOS',
    'rrhh_cuentas': 'RRHH/CUENTAS',
    'rrhh_empleados': 'RRHH/EMPLEADOS',
    'rrhh_pagos': 'RRHH/PAGOS',
  };
  return paths[entity] || null;
};

export const fetchData = async (entity) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  const path = getEntityPath(entity);

  if (!path) {
    throw new Error(`Invalid entity type: ${entity}`);
  }

  try {
    const response = await fetch(`${FIREBASE_URL}/${LOCAL_ID}/${path}.json`);
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    const data = await response.json();
    if (!data) return [];

    if (entity === 'opcionales') {
      const allOpcionales = [];
      Object.keys(data).forEach(groupKey => {
        const groupOpcionales = data[groupKey];
        if (groupOpcionales && typeof groupOpcionales === 'object') {
            Object.keys(groupOpcionales).forEach(opcionalKey => {
              const opcional = groupOpcionales[opcionalKey];
              // Removed opcional.activo check here so disabled optionals (like BANANA) 
              // pass through to the frontend and can be rendered as grayed out/disabled.
              if (opcional) {
                allOpcionales.push({
                  ...opcional,
                  id: opcionalKey,
                  codigo: opcionalKey,
                  grupo: groupKey,
                });
              }
            });
        }
      });
      return allOpcionales;
    }

    return Object.keys(data)
      .map(key => {
        const item = data[key];
        if (!item || typeof item !== 'object' || !item.activo) return null;
        return { ...item, id: key };
      })
      .filter(item => item !== null);
  } catch (error) {
    console.error(`Error fetching ${entity}:`, error);
    throw error;
  }
};