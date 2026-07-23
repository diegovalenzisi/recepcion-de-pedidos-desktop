import React, { useMemo, useState } from 'react';
import { AlertTriangle, Info, Plus, Trash2 } from 'lucide-react';
import {
  ORIGEN_MANUAL,
  ORIGEN_DEPARTAMENTO,
  cambiarOrigen,
  validarGrupoOpcional,
} from '@/lib/api/grupoOpcionalForm';

// Fase 2 — punto 8 (Desktop). Sólo presenta: toda la lógica de origen,
// validación y guardado vive en @/lib/api/grupoOpcionalForm, idéntica en Tablet.
const OptionalGroupFormFields = ({ formData, onFieldChange, allData }) => {
  const [confirmacion, setConfirmacion] = useState(null);
  const [nuevoOverride, setNuevoOverride] = useState('');

  const departamentos = useMemo(() => {
    const lista = allData?.departamentos || [];
    const mapa = {};
    lista.forEach((d) => { const k = d?.codigo || d?.id; if (k) mapa[String(k)] = d; });
    return mapa;
  }, [allData]);

  const esDepartamento = formData.origen === ORIGEN_DEPARTAMENTO;

  const articulosDelDepartamento = useMemo(() => {
    if (!esDepartamento || !formData.departamentoId) return [];
    return (allData?.articulos || []).filter(
      (a) => String(a?.departamento || '') === String(formData.departamentoId)
    );
  }, [allData, esDepartamento, formData.departamentoId]);

  const opcionalesManuales = useMemo(
    () => (allData?.opcionales || []).filter((o) => o?.grupo === formData.codigo),
    [allData, formData.codigo]
  );

  const { errores, avisos } = useMemo(
    () => validarGrupoOpcional(formData, { departamentos, articulos: {} }),
    [formData, departamentos]
  );
  const errorDe = (campo) => errores.find((e) => e.campo === campo);

  const aplicarOrigen = (destino) => {
    const r = cambiarOrigen(formData, destino, { opcionalesManuales });
    if (r.requiereConfirmacion) {
      setConfirmacion({ mensaje: r.mensaje, aplicar: () => { onFieldChange('origen', destino); onFieldChange('origenTocado', true); setConfirmacion(null); } });
      return;
    }
    onFieldChange('origen', destino);
    onFieldChange('origenTocado', true);
  };

  const setOverride = (articleId, valor) => {
    const actuales = { ...(formData.consumosPorArticulo || {}) };
    if (valor === null) delete actuales[articleId];
    else actuales[articleId] = valor;
    onFieldChange('consumosPorArticulo', actuales);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
        <input
          name="nombre"
          type="text"
          className="input-field"
          value={formData.nombre || ''}
          onChange={(e) => onFieldChange('nombre', e.target.value)}
        />
        {errorDe('nombre') && <p className="text-xs text-red-600 mt-1">{errorDe('nombre').mensaje}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Origen de las opciones</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="origen" checked={!esDepartamento} onChange={() => aplicarOrigen(ORIGEN_MANUAL)} className="h-4 w-4 text-orange-600 focus:ring-orange-500" />
            <span className="text-sm text-gray-800">Manual</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="origen" checked={esDepartamento} onChange={() => aplicarOrigen(ORIGEN_DEPARTAMENTO)} className="h-4 w-4 text-orange-600 focus:ring-orange-500" />
            <span className="text-sm text-gray-800">Departamento</span>
          </label>
        </div>
        {!esDepartamento && (
          <p className="text-xs text-gray-500 mt-1">
            Las opciones se cargan a mano en la solapa Opcionales, como hasta ahora.
          </p>
        )}
      </div>

      {confirmacion && (
        <div className="border border-amber-300 bg-amber-50 rounded-md p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p>{confirmacion.mensaje}</p>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={confirmacion.aplicar} className="px-3 py-1 rounded bg-amber-600 text-white text-xs">Continuar</button>
                <button type="button" onClick={() => setConfirmacion(null)} className="px-3 py-1 rounded border border-amber-400 text-xs">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {esDepartamento && (
        <div className="border rounded-lg p-3 bg-gray-50 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Departamento</label>
            <select
              className="input-field"
              value={formData.departamentoId || ''}
              onChange={(e) => onFieldChange('departamentoId', e.target.value)}
            >
              <option value="">Seleccione un departamento...</option>
              {Object.keys(departamentos).map((id) => (
                <option key={id} value={id}>{departamentos[id].nombre} ({id})</option>
              ))}
            </select>
            {errorDe('departamentoId') && <p className="text-xs text-red-600 mt-1">{errorDe('departamentoId').mensaje}</p>}
            {formData.departamentoId && (
              <p className="text-xs text-gray-600 mt-1">
                Las opciones salen del catálogo vigente de este departamento. No se copian dentro del grupo.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formData.usarPrecioArticulo !== false} onChange={(e) => onFieldChange('usarPrecioArticulo', e.target.checked)} className="h-4 w-4 rounded text-orange-600 focus:ring-orange-500" />
              <span className="text-sm text-gray-800">Usar el precio del artículo</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formData.controlarStock !== false} onChange={(e) => onFieldChange('controlarStock', e.target.checked)} className="h-4 w-4 rounded text-orange-600 focus:ring-orange-500" />
              <span className="text-sm text-gray-800">Controlar stock</span>
            </label>
          </div>

          {formData.controlarStock !== false && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Consumo de stock predeterminado</label>
              <input
                type="number"
                step="0.001"
                min="0"
                className="input-field"
                value={formData.consumoStockUnitarioDefault ?? 1}
                onChange={(e) => onFieldChange('consumoStockUnitarioDefault', e.target.value)}
              />
              {errorDe('consumoStockUnitarioDefault') && <p className="text-xs text-red-600 mt-1">{errorDe('consumoStockUnitarioDefault').mensaje}</p>}
              <p className="text-xs text-gray-500 mt-1">
                Cuántas unidades del artículo descuenta cada vez que se elige la opción. Un artículo sin control de stock sigue siendo ilimitado.
              </p>
            </div>
          )}

          {formData.controlarStock !== false && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Consumo distinto para artículos puntuales</label>
              {Object.keys(formData.consumosPorArticulo || {}).length === 0 && (
                <p className="text-xs text-gray-500 mb-2">Sin excepciones: todos usan el consumo predeterminado.</p>
              )}
              <div className="space-y-2">
                {Object.keys(formData.consumosPorArticulo || {}).map((articleId) => {
                  const err = errorDe(`consumosPorArticulo.${articleId}`);
                  const art = (allData?.articulos || []).find((a) => (a.codigo || a.id) === articleId);
                  return (
                    <div key={articleId} className="flex items-center gap-2">
                      <span className="text-sm text-gray-800 flex-1">{art ? `${art.nombre} (${articleId})` : articleId}</span>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        className="input-field-sm w-28"
                        value={formData.consumosPorArticulo[articleId]}
                        onChange={(e) => setOverride(articleId, e.target.value)}
                      />
                      <button type="button" onClick={() => setOverride(articleId, null)} className="text-gray-500 hover:text-red-600" aria-label="Quitar excepción">
                        <Trash2 size={16} />
                      </button>
                      {err && <span className="text-xs text-red-600">{err.mensaje}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <select className="input-field-sm flex-1" value={nuevoOverride} onChange={(e) => setNuevoOverride(e.target.value)}>
                  <option value="">Agregar excepción...</option>
                  {articulosDelDepartamento
                    .map((a) => a.codigo || a.id)
                    .filter((id) => id && !(formData.consumosPorArticulo || {})[id])
                    .map((id) => {
                      const a = articulosDelDepartamento.find((x) => (x.codigo || x.id) === id);
                      return <option key={id} value={id}>{a?.nombre} ({id})</option>;
                    })}
                </select>
                <button
                  type="button"
                  disabled={!nuevoOverride}
                  onClick={() => { setOverride(nuevoOverride, formData.consumoStockUnitarioDefault ?? 1); setNuevoOverride(''); }}
                  className="px-2 py-1 rounded bg-orange-600 text-white disabled:opacity-40"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {avisos.length > 0 && (
        <div className="border border-blue-200 bg-blue-50 rounded-md p-3 text-xs text-blue-800 space-y-1">
          {avisos.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{a.mensaje}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OptionalGroupFormFields;
