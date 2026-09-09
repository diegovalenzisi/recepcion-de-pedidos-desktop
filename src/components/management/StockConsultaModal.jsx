import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, X } from 'lucide-react';
import { normalizarStock } from '@/lib/api/ventaUtils';

// ---------------------------------------------------------------------------
// Consulta de Stock — pantalla 100% de solo lectura para que un empleado
// consulte existencias sin poder modificarlas. NO importa ni ejecuta ninguna
// función de escritura (set/update/push/remove/transaction/saveData/
// deleteData/updateTachoStock): solo recibe datos ya cargados por
// StockPage.jsx (misma fuente de verdad, sin listeners nuevos) y los
// presenta, con un único input interactivo (el buscador).
//
// La clasificación "propio + controlStock habilitado" de los artículos NO se
// hace acá: StockPage.jsx ya tiene getTipoStockArticulo() y decide qué
// artículos corresponden a esta pantalla, y los pasa ya filtrados en
// `articulosStockPropio` — evita que este componente importe algo de
// StockPage.jsx (import circular StockPage -> Modal -> StockPage).
// ---------------------------------------------------------------------------

const badgeClasses = {
  red: 'bg-red-100 text-red-800 border-red-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  green: 'bg-green-100 text-green-800 border-green-200',
};

const badgeLabel = { red: 'Sin stock', amber: 'Stock bajo', green: 'Normal' };

// Mismo criterio que ya usa DataTable.jsx para materia prima y artículos
// propios: stock <= 0 → rojo; stock <= mínimo (si hay mínimo real, > 0) →
// ámbar; si no, verde. Un mínimo ausente/0 nunca inventa un umbral: sólo el
// stock <= 0 sigue aplicando.
const getEstado = (stockValor, minimoValor) => {
  const stock = normalizarStock(stockValor);
  if (stock <= 0) return 'red';
  const minimo = Number(minimoValor) || 0;
  if (minimo > 0 && stock <= minimo) return 'amber';
  return 'green';
};

const EstadoBadge = ({ estado }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${badgeClasses[estado]}`}>
    {badgeLabel[estado]}
  </span>
);

const coincideBusqueda = (nombre, termino) => (nombre || '').toLowerCase().includes(termino);

/**
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {Array} materiasPrimas - data['materia-prima'] tal cual la mantiene StockPage.jsx.
 * @param {Array} articulosStockPropio - subconjunto de data.articulos ya filtrado por StockPage.jsx
 *   (getTipoStockArticulo(a) === 'propio' && a.controlStock !== false).
 */
const StockConsultaModal = ({ isOpen, onClose, materiasPrimas = [], articulosStockPropio = [] }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const materiasFiltradas = useMemo(() => {
    const termino = searchTerm.trim().toLowerCase();
    const lista = termino ? materiasPrimas.filter((m) => coincideBusqueda(m?.nombre, termino)) : materiasPrimas;
    return [...lista].sort((a, b) => (a?.nombre || '').localeCompare(b?.nombre || ''));
  }, [materiasPrimas, searchTerm]);

  const articulosFiltrados = useMemo(() => {
    const termino = searchTerm.trim().toLowerCase();
    const lista = termino ? articulosStockPropio.filter((a) => coincideBusqueda(a?.nombre, termino)) : articulosStockPropio;
    return [...lista].sort((a, b) => (a?.nombre || '').localeCompare(b?.nombre || ''));
  }, [articulosStockPropio, searchTerm]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] p-0 flex flex-col overflow-hidden [&>button.absolute]:hidden">
        <div className="flex justify-between items-center p-4 md:p-6 border-b shrink-0 bg-white z-20">
          <DialogTitle className="text-xl">Consulta de Stock</DialogTitle>
          <button
            onClick={() => onClose()}
            className="rounded-full p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shrink-0 ml-4"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 md:px-6 pt-4 border-b bg-white shrink-0">
          <div className="relative pb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Buscar por nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 w-full"
              autoFocus
            />
          </div>
        </div>

        <ScrollArea className="flex-1 w-full overflow-y-auto bg-gray-50/30 p-4 md:p-6">
          <div className="space-y-8">
            <div>
              <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b pb-2">
                Materias Primas ({materiasFiltradas.length})
              </h3>
              <div className="rounded-md border bg-white overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <Table className="min-w-[500px]">
                    <TableHeader>
                      <TableRow className="bg-gray-50/50">
                        <TableHead>Materia Prima</TableHead>
                        <TableHead className="text-center">Stock Actual</TableHead>
                        <TableHead>Unidad</TableHead>
                        <TableHead className="text-center">Stock Mínimo</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {materiasFiltradas.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            {searchTerm ? 'Sin resultados para la búsqueda.' : 'No hay materias primas cargadas.'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        materiasFiltradas.map((m) => {
                          const unidad = m.unidadMedida || m.unidad || 'u.';
                          const estado = getEstado(m.stock, m.minimo);
                          return (
                            <TableRow key={`mp-${m.codigo}`} className="hover:bg-gray-50 transition-colors">
                              <TableCell className="font-medium text-gray-900">{m.nombre}</TableCell>
                              <TableCell className="text-center font-bold">{normalizarStock(m.stock)}</TableCell>
                              <TableCell className="text-gray-600 capitalize">{unidad}</TableCell>
                              <TableCell className="text-center text-gray-500">{Number(m.minimo) || 0}</TableCell>
                              <TableCell><EstadoBadge estado={estado} /></TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b pb-2">
                Artículos con Stock Propio ({articulosFiltrados.length})
              </h3>
              <div className="rounded-md border bg-white overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <Table className="min-w-[500px]">
                    <TableHeader>
                      <TableRow className="bg-gray-50/50">
                        <TableHead>Artículo</TableHead>
                        <TableHead className="text-center">Stock Actual</TableHead>
                        <TableHead>Unidad</TableHead>
                        <TableHead className="text-center">Stock Mínimo</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {articulosFiltrados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            {searchTerm ? 'Sin resultados para la búsqueda.' : 'No hay artículos con stock propio.'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        articulosFiltrados.map((a) => {
                          const estado = getEstado(a.stock, a.stockMinimo);
                          return (
                            <TableRow key={`art-${a.codigo}`} className="hover:bg-gray-50 transition-colors">
                              <TableCell className="font-medium text-gray-900">{a.nombre}</TableCell>
                              <TableCell className="text-center font-bold">{normalizarStock(a.stock)}</TableCell>
                              <TableCell className="text-gray-600">unidades</TableCell>
                              <TableCell className="text-center text-gray-500">{Number(a.stockMinimo) || 0}</TableCell>
                              <TableCell><EstadoBadge estado={estado} /></TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default StockConsultaModal;
