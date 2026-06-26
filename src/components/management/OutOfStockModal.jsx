import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { X, MapPin } from 'lucide-react';

const OutOfStockModal = ({ 
  isOpen, 
  onClose, 
  outOfStockArticles = [], 
  outOfStockRawMaterials = [], 
  lowStockArticles = [],
  lowStockRawMaterials = [],
  departments = [], 
  lastUpdated, 
  localId 
}) => {
  const sortedOosArticles = useMemo(() => {
    return [...outOfStockArticles].sort((a, b) => {
      const codeA = String(a.codigo || '').replace(/\D/g, '');
      const codeB = String(b.codigo || '').replace(/\D/g, '');
      return Number(codeA) - Number(codeB);
    });
  }, [outOfStockArticles]);

  const sortedOosRawMaterials = useMemo(() => {
    return [...outOfStockRawMaterials].sort((a, b) => {
      const codeA = String(a.codigo || '').replace(/\D/g, '');
      const codeB = String(b.codigo || '').replace(/\D/g, '');
      return Number(codeA) - Number(codeB);
    });
  }, [outOfStockRawMaterials]);
  
  const sortedLowArticles = useMemo(() => {
    return [...lowStockArticles].sort((a, b) => {
      const codeA = String(a.codigo || '').replace(/\D/g, '');
      const codeB = String(b.codigo || '').replace(/\D/g, '');
      return Number(codeA) - Number(codeB);
    });
  }, [lowStockArticles]);

  const sortedLowRawMaterials = useMemo(() => {
    return [...lowStockRawMaterials].sort((a, b) => {
      const codeA = String(a.codigo || '').replace(/\D/g, '');
      const codeB = String(b.codigo || '').replace(/\D/g, '');
      return Number(codeA) - Number(codeB);
    });
  }, [lowStockRawMaterials]);

  const getDeptName = (deptId) => {
    const dept = departments.find(d => d.codigo === deptId);
    return dept ? dept.nombre : 'Sin departamento';
  };

  const getArticleStockInfo = (article, type = 'out') => {
    const parseStock = (val) => {
      if (val === undefined || val === null || val === '') return null;
      const num = Number(val);
      return isNaN(num) ? null : num;
    };

    let stockPropio = null;
    let stockHeredado = null;

    if (typeof article.stock === 'object' && article.stock !== null) {
      stockPropio = parseStock(article.stock.propio);
      stockHeredado = parseStock(article.stock.heredado);
    } else {
      stockPropio = parseStock(article.stock);
      stockHeredado = parseStock(article.stockHeredado);
    }

    const minStock = Number(article.stockMinimo) || 0;
    const issues = [];
    
    if (type === 'out') {
      if (stockPropio !== null && stockPropio <= 0) issues.push(`Propio (${stockPropio})`);
      if (stockHeredado !== null && stockHeredado <= 0) issues.push(`Heredado (${stockHeredado})`);
    } else {
      if (stockPropio !== null && stockPropio > 0 && stockPropio <= minStock) issues.push(`Propio (${stockPropio})`);
      if (stockHeredado !== null && stockHeredado > 0 && stockHeredado <= minStock) issues.push(`Heredado (${stockHeredado})`);
    }

    return {
      propio: stockPropio !== null ? stockPropio : '-',
      heredado: stockHeredado !== null ? stockHeredado : '-',
      minimo: minStock,
      isIssuePropio: type === 'out' ? (stockPropio !== null && stockPropio <= 0) : (stockPropio !== null && stockPropio > 0 && stockPropio <= minStock),
      isIssueHeredado: type === 'out' ? (stockHeredado !== null && stockHeredado <= 0) : (stockHeredado !== null && stockHeredado > 0 && stockHeredado <= minStock),
      label: issues.join(' y ') || (type === 'out' ? 'Agotado' : 'Bajo')
    };
  };

  const totalOos = sortedOosArticles.length + sortedOosRawMaterials.length;
  const totalLow = sortedLowArticles.length + sortedLowRawMaterials.length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] p-0 flex flex-col overflow-hidden [&>button.absolute]:hidden">
        <div className="flex justify-between items-center p-4 md:p-6 border-b shrink-0 bg-white z-20">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <DialogTitle className="text-xl flex items-center gap-2">
              Alertas de Stock
            </DialogTitle>
            
            {localId && (
              <span className="flex items-center gap-1 text-sm px-2 py-1 bg-blue-50 text-blue-700 rounded-md font-mono sm:ml-2 border border-blue-100">
                <MapPin className="h-3 w-3" />
                Local ID: {localId}
              </span>
            )}

            {lastUpdated && (
              <span className="text-sm text-gray-500 font-normal sm:ml-2">
                Actualizado: {format(lastUpdated, "HH:mm:ss", { locale: es })}
              </span>
            )}
          </div>
          <button
            onClick={() => onClose()}
            className="rounded-full p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shrink-0 ml-4"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <Tabs defaultValue={totalOos > 0 ? "faltantes" : "bajos"} className="flex-1 flex flex-col min-h-0 w-full">
          <div className="px-4 md:px-6 pt-2 border-b bg-white shrink-0">
            <TabsList className="bg-gray-100/80">
               <TabsTrigger value="faltantes" className="data-[state=active]:bg-white data-[state=active]:text-red-600 data-[state=active]:shadow-sm">
                 Faltantes ({totalOos})
               </TabsTrigger>
               <TabsTrigger value="bajos" className="data-[state=active]:bg-white data-[state=active]:text-amber-600 data-[state=active]:shadow-sm">
                 Stock Bajo ({totalLow})
               </TabsTrigger>
            </TabsList>
          </div>
          
          <ScrollArea className="flex-1 w-full overflow-y-auto bg-gray-50/30 p-4 md:p-6">
            <TabsContent value="faltantes" className="space-y-8 mt-0 focus:outline-none">
              <div>
                <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b pb-2 flex items-center justify-between">
                  Artículos Faltantes ({sortedOosArticles.length})
                </h3>
                <div className="rounded-md border bg-white overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow className="bg-gray-50/50">
                          <TableHead className="w-[100px]">Tipo</TableHead>
                          <TableHead className="w-[100px]">Código</TableHead>
                          <TableHead>Artículo</TableHead>
                          <TableHead className="hidden md:table-cell">Departamento</TableHead>
                          <TableHead className="text-center">Stock Propio</TableHead>
                          <TableHead className="text-center hidden sm:table-cell">Stock Heredado</TableHead>
                          <TableHead>Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedOosArticles.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                              ✅ No hay artículos sin stock.
                            </TableCell>
                          </TableRow>
                        ) : (
                          sortedOosArticles.map((item) => {
                            const stockInfo = getArticleStockInfo(item, 'out');
                            return (
                              <TableRow key={`art-${item.codigo}`} className="hover:bg-gray-50 transition-colors">
                                <TableCell>
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 whitespace-nowrap border border-blue-200">
                                    Artículo
                                  </span>
                                </TableCell>
                                <TableCell className="font-mono text-sm font-semibold">{item.codigo}</TableCell>
                                <TableCell className="font-medium text-gray-900">{item.nombre}</TableCell>
                                <TableCell className="text-sm text-gray-600 hidden md:table-cell">{getDeptName(item.departamento)}</TableCell>
                                <TableCell className={`text-center font-bold ${stockInfo.isIssuePropio ? 'text-red-600 bg-red-50 rounded-md' : 'text-gray-600'}`}>
                                  {stockInfo.propio}
                                </TableCell>
                                <TableCell className={`text-center font-bold hidden sm:table-cell ${stockInfo.isIssueHeredado ? 'text-red-600 bg-red-50 rounded-md' : 'text-gray-600'}`}>
                                  {stockInfo.heredado}
                                </TableCell>
                                <TableCell>
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200 whitespace-nowrap shadow-sm">
                                    {stockInfo.label}
                                  </span>
                                </TableCell>
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
                  Materia Prima Faltante ({sortedOosRawMaterials.length})
                </h3>
                <div className="rounded-md border bg-white overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <Table className="min-w-[600px]">
                      <TableHeader>
                        <TableRow className="bg-gray-50/50">
                          <TableHead className="w-[120px]">Tipo</TableHead>
                          <TableHead className="w-[100px]">Código</TableHead>
                          <TableHead>Materia Prima</TableHead>
                          <TableHead className="hidden sm:table-cell">Unidad</TableHead>
                          <TableHead className="text-center">Stock Actual</TableHead>
                          <TableHead>Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedOosRawMaterials.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              ✅ No hay materia prima sin stock.
                            </TableCell>
                          </TableRow>
                        ) : (
                          sortedOosRawMaterials.map((item) => {
                            const stockVal = Number(item.stock);
                            return (
                              <TableRow key={`mp-${item.codigo}`} className="hover:bg-gray-50 transition-colors">
                                <TableCell>
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 whitespace-nowrap border border-purple-200">
                                    Materia Prima
                                  </span>
                                </TableCell>
                                <TableCell className="font-mono text-sm font-semibold">{item.codigo}</TableCell>
                                <TableCell className="font-medium text-gray-900">{item.nombre}</TableCell>
                                <TableCell className="text-sm text-gray-600 hidden sm:table-cell">{item.unidad || '-'}</TableCell>
                                <TableCell className="text-center font-bold text-red-600 bg-red-50 rounded-md">
                                  {isNaN(stockVal) ? '-' : stockVal}
                                </TableCell>
                                <TableCell>
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200 whitespace-nowrap shadow-sm">
                                    Agotado
                                  </span>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="bajos" className="space-y-8 mt-0 focus:outline-none">
              <div>
                <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b pb-2 flex items-center justify-between">
                  Artículos con Stock Bajo ({sortedLowArticles.length})
                </h3>
                <div className="rounded-md border bg-white overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow className="bg-gray-50/50">
                          <TableHead className="w-[100px]">Tipo</TableHead>
                          <TableHead className="w-[100px]">Código</TableHead>
                          <TableHead>Artículo</TableHead>
                          <TableHead className="hidden md:table-cell">Departamento</TableHead>
                          <TableHead className="text-center">Mínimo</TableHead>
                          <TableHead className="text-center">Stock Propio</TableHead>
                          <TableHead className="text-center hidden sm:table-cell">Stock Heredado</TableHead>
                          <TableHead>Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedLowArticles.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                              ✅ No hay artículos con stock bajo.
                            </TableCell>
                          </TableRow>
                        ) : (
                          sortedLowArticles.map((item) => {
                            const stockInfo = getArticleStockInfo(item, 'low');
                            return (
                              <TableRow key={`art-${item.codigo}`} className="hover:bg-gray-50 transition-colors">
                                <TableCell>
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 whitespace-nowrap border border-blue-200">
                                    Artículo
                                  </span>
                                </TableCell>
                                <TableCell className="font-mono text-sm font-semibold">{item.codigo}</TableCell>
                                <TableCell className="font-medium text-gray-900">{item.nombre}</TableCell>
                                <TableCell className="text-sm text-gray-600 hidden md:table-cell">{getDeptName(item.departamento)}</TableCell>
                                <TableCell className="text-center text-gray-500 font-medium">{stockInfo.minimo}</TableCell>
                                <TableCell className={`text-center font-bold ${stockInfo.isIssuePropio ? 'text-amber-600 bg-amber-50 rounded-md' : 'text-gray-600'}`}>
                                  {stockInfo.propio}
                                </TableCell>
                                <TableCell className={`text-center font-bold hidden sm:table-cell ${stockInfo.isIssueHeredado ? 'text-amber-600 bg-amber-50 rounded-md' : 'text-gray-600'}`}>
                                  {stockInfo.heredado}
                                </TableCell>
                                <TableCell>
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200 whitespace-nowrap shadow-sm">
                                    {stockInfo.label}
                                  </span>
                                </TableCell>
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
                  Materia Prima con Stock Bajo ({sortedLowRawMaterials.length})
                </h3>
                <div className="rounded-md border bg-white overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <Table className="min-w-[600px]">
                      <TableHeader>
                        <TableRow className="bg-gray-50/50">
                          <TableHead className="w-[120px]">Tipo</TableHead>
                          <TableHead className="w-[100px]">Código</TableHead>
                          <TableHead>Materia Prima</TableHead>
                          <TableHead className="hidden sm:table-cell">Unidad</TableHead>
                          <TableHead className="text-center">Mínimo</TableHead>
                          <TableHead className="text-center">Stock Actual</TableHead>
                          <TableHead>Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedLowRawMaterials.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                              ✅ No hay materia prima con stock bajo.
                            </TableCell>
                          </TableRow>
                        ) : (
                          sortedLowRawMaterials.map((item) => {
                            const stockVal = Number(item.stock);
                            const minVal = Number(item.minimo) || 0;
                            return (
                              <TableRow key={`mp-${item.codigo}`} className="hover:bg-gray-50 transition-colors">
                                <TableCell>
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 whitespace-nowrap border border-purple-200">
                                    Materia Prima
                                  </span>
                                </TableCell>
                                <TableCell className="font-mono text-sm font-semibold">{item.codigo}</TableCell>
                                <TableCell className="font-medium text-gray-900">{item.nombre}</TableCell>
                                <TableCell className="text-sm text-gray-600 hidden sm:table-cell">{item.unidad || '-'}</TableCell>
                                <TableCell className="text-center text-gray-500 font-medium">{minVal}</TableCell>
                                <TableCell className="text-center font-bold text-amber-600 bg-amber-50 rounded-md">
                                  {isNaN(stockVal) ? '-' : stockVal}
                                </TableCell>
                                <TableCell>
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200 whitespace-nowrap shadow-sm">
                                    Bajo
                                  </span>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default OutOfStockModal;