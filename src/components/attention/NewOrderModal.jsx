import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { fetchData } from '@/lib/api/firebaseApi';
import { saveOrder, updateOrder } from '@/lib/api/ordersApi';
import { calcularTotalPedido } from '@/lib/api/optionalsPricing';
import { evaluarBloqueoPrecioInvalido } from '@/lib/api/bloqueoPrecioInvalido';
import {
  esLineaConfigurable,
  quitarUnidad,
  contarUnidadesConfiguradas,
  baseParaUnidadNueva,
  agregarUnidadConfigurada,
} from '@/lib/api/unidadesPedido';
import { useToast } from '@/components/ui/use-toast';
import OptionalSelectionModal from '@/components/attention/OptionalSelectionModal';
import GroupProductSelectionModal from '@/components/attention/GroupProductSelectionModal';
import ConfirmOrderModal from '@/components/attention/ConfirmOrderModal';
import DepartmentList from '@/components/attention/order/DepartmentList';
import ArticleGrid from '@/components/attention/order/ArticleGrid';
import OrderSummary from '@/components/attention/order/OrderSummary';
import { usePromo } from '@/hooks/usePromo';
import { fetchAccounts } from '@/lib/api/accountsApi';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getOperationalDate, formatDateToDDMMAAAA } from '@/lib/utils';
import { savePrepaymentForApp } from '@/lib/api/prepaymentApi';
import { preloadImage } from '@/lib/cache/imageCache';
import { warmArticleImages, sweepArticleImageOrphans } from '@/lib/cache/articleImageCache';
import { getLocalId } from '@/lib/firebase/core';
import { useStockVerification } from '@/hooks/useStockVerification';
import { validarStockDeCarrito, MENSAJE_STOCK_NO_VERIFICABLE } from '@/lib/api/validacionStockVentaApi';
import { usePromotionStockAutomation } from '@/hooks/usePromotionStockAutomation';
import { filtrarDepartamentosVisiblesEnMostrador } from '@/lib/api/departamentosCanonicos';
import { resolverMediosDePago } from '@/lib/api/mediosDePagoMostrador';

function NewOrderModal({ isOpen, onOpenChange, onOrderCreated, isEditing = false, orderToEdit = null, context = 'delivery', isCounterMode = false, currentShift, settings }) {
  const [departments, setDepartments] = useState([]);
  const [allArticles, setAllArticles] = useState([]);
  const [allOptionals, setAllOptionals] = useState([]);
  const [allOptionalGroups, setAllOptionalGroups] = useState([]);
  const [allProductGroups, setAllProductGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDepartment, setSelectedDepartment] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const { toast } = useToast();

  const [isOptionalModalOpen, setIsOptionalModalOpen] = useState(false);
  // Unidad que se está configurando ("Unidad 2 de 2"). null = alta normal.
  const [pendingUnitInfo, setPendingUnitInfo] = useState(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isValidatingStock, setIsValidatingStock] = useState(false);
  const [articleForSelection, setArticleForSelection] = useState(null);
  const [editOrderType, setEditOrderType] = useState('ENVIO');

  // Hook to handle real-time stock verification
  const { verifiedArticles, isVerifying } = useStockVerification(
    allArticles,
    context,
    isOpen && !isConfirmModalOpen && !isOptionalModalOpen,
    allProductGroups
  );

  // Hook to handle promotion automation based on stock
  const { isChecking: isCheckingPromos, summary: promoSummary } = usePromotionStockAutomation(isOpen);
  const summaryNotifiedRef = useRef(false);

  useEffect(() => {
    if (promoSummary?.disabledCount > 0 && !summaryNotifiedRef.current) {
        toast({
            title: "Atención: Promociones actualizadas",
            description: `Se han desactivado ${promoSummary.disabledCount} promoción(es) por falta de stock.`,
            variant: "destructive"
        });
        summaryNotifiedRef.current = true;
    }
  }, [promoSummary, toast]);

  useEffect(() => {
    if (!isOpen) {
        summaryNotifiedRef.current = false;
    }
  }, [isOpen]);

  const addArticleToOrder = useCallback((article) => {
    const uniqueId = (article.selectedOptionals || article.promoDetails)
      ? `${article.id}-${Date.now()}` 
      : article.id;
    
    const priceToUse = article.valor !== undefined ? article.valor : (article.precio || 0);

    setOrderItems(prevItems => {
      if (!article.selectedOptionals && !article.promoDetails) {
        const existingItem = prevItems.find(item => item.id === article.id && !item.selectedOptionals && !item.promoDetails);
        if (existingItem) {
          return prevItems.map(item =>
            item.id === article.id && !item.selectedOptionals && !item.promoDetails ? { ...item, quantity: item.quantity + 1 } : item
          );
        }
      }
      // Las líneas configurables (con opcionales) SIEMPRE entran con quantity: 1
      // y se renumeran para mostrar "Unidad N de M".
      return agregarUnidadConfigurada(prevItems, { ...article, valor: priceToUse }, uniqueId);
    });
  }, []);

  const handlePromoUnavailable = useCallback(() => {
    toast({
      variant: "destructive",
      title: "Promoción no disponible",
      description: "No hay stock suficiente de los artículos que componen esta promoción.",
    });
  }, [toast]);

  const {
    promoConfig,
    startPromo,
    handlePromoItemConfigured,
    handleGroupItemResolved,
    resetPromoConfig,
  } = usePromo({ allArticles, addArticleToOrder, allProductGroups, verifiedArticles, onPromoUnavailable: handlePromoUnavailable });

  const loadData = async () => {
    setLoading(true);
    setError(null);
    // Local activo al INICIAR la carga: si cambia antes del sweep, se cancela
    // la limpieza (requisito 11).
    const catalogLocalId = getLocalId();
    try {
      const [fetchedDepartments, fetchedArticles, fetchedOptionals, fetchedOptionalGroups, fetchedProductGroups, fetchedAccounts] = await Promise.all([
        fetchData('departamentos'),
        fetchData('articulos'),
        fetchData('opcionales'),
        fetchData('grupos-opcionales'),
        fetchData('grupos-productos'),
        fetchAccounts()
      ]);

      // En Mostrador, los tres departamentos canónicos (PEDIDOSYA/RAPPI/M.LIBRE)
      // sólo se listan si tienen algún artículo asignado — existen siempre en
      // Firebase, esto es puro filtro de visualización (ver departamentosCanonicos.js).
      // Al resto de los departamentos no los afecta.
      const activeDepartments = (
        context === 'delivery' ? fetchedDepartments.filter(d => d.activoDelivery)
          : context === 'counter' ? filtrarDepartamentosVisiblesEnMostrador(
              fetchedDepartments.filter(d => d.activoMostrador), fetchedArticles,
            )
            : fetchedDepartments
      ).sort((a,b) => (a.ordenWeb || 999) - (b.ordenWeb || 999));

      setDepartments(activeDepartments);
      setAllArticles(fetchedArticles);
      setAllOptionals(fetchedOptionals);
      setAllOptionalGroups(fetchedOptionalGroups);
      setAllProductGroups(fetchedProductGroups);

      const electronicMethods = (fetchedAccounts || []).map(acc => acc.nombre).filter(Boolean);
      setPaymentMethods(['Efectivo', ...new Set(electronicMethods)]);

      if (activeDepartments.length > 0) {
        setSelectedDepartment(activeDepartments[0].id);
      }
      
      const priorityArticle = fetchedArticles.find(a => a.nombre && a.nombre.toUpperCase().includes('1 KILO DE HELADO'));
      if (priorityArticle && priorityArticle.foto) {
        preloadImage(priorityArticle.foto).catch(e => console.warn("Failed to preload priority image", e));
      }

      // Precalentado del caché LOCAL de imágenes con concurrencia limitada
      // (requisito 20): NO dispara metadata+descargas de todo el catálogo a la
      // vez. Las tarjetas visibles resuelven por su cuenta al montarse y se
      // deduplican con esto. Fire-and-forget: no bloquea la pantalla.
      warmArticleImages(fetchedArticles, { concurrency: 4 }).catch(() => {});

      // Limpieza de huérfanos: SOLO acá, con el catálogo completo y confirmado
      // recién cargado (requisito 16/17), y solo si el local no cambió durante
      // la carga (requisito 11). Nunca por render ni por artículo.
      sweepArticleImageOrphans(fetchedArticles, catalogLocalId).catch(() => {});

    } catch (err) {
      setError('No se pudieron cargar los datos. Inténtelo de nuevo.');
      toast({
        variant: "destructive",
        title: "Error de Carga",
        description: "No se pudieron cargar los datos desde la base de datos.",
      });
    } finally {
      setLoading(false);
    }
  };
  
  const articlesByDept = useMemo(() => {
    const sortedArticles = [...verifiedArticles].sort((a, b) => {
      const orderA = context === 'delivery' ? a.ordenWeb : a.ordenLocal;
      const orderB = context === 'delivery' ? b.ordenWeb : b.ordenLocal;
      return (orderA || 999) - (orderB || 999);
    });

    return sortedArticles.reduce((acc, article) => {
      const depId = article.departamento;
      if (!acc[depId]) acc[depId] = [];
      acc[depId].push(article);
      return acc;
    }, {});
  }, [verifiedArticles, context]);


  useEffect(() => {
    if (isOpen && !isConfirmModalOpen) {
      if (allArticles.length === 0) loadData();
      else {
        const priorityArticle = allArticles.find(a => a.nombre && a.nombre.toUpperCase().includes('1 KILO DE HELADO'));
        if (priorityArticle && priorityArticle.foto) {
          preloadImage(priorityArticle.foto).catch(() => {});
        }
      }
      
      if (isEditing && orderToEdit) {
        const hydratedItems = orderToEdit.items.map((item, index) => ({
          ...item,
          uniqueId: item.uniqueId || `${item.id}-${index}-${Date.now()}`
        }));
        setOrderItems(hydratedItems);
        setEditOrderType(orderToEdit.type || 'ENVIO');
      } else {
        setOrderItems([]);
      }
    } else if (!isOpen) {
        setOrderItems([]);
        setIsConfirmModalOpen(false);
        setEditOrderType('ENVIO');
        resetPromoConfig();
    }
  }, [isOpen, isConfirmModalOpen, isEditing, orderToEdit, allArticles.length, resetPromoConfig]);


  useEffect(() => {
    if (promoConfig.isConfiguring && promoConfig.currentIndex < promoConfig.itemsToConfigure.length) {
      const itemToConfigure = promoConfig.itemsToConfigure[promoConfig.currentIndex];
      setArticleForSelection(itemToConfigure);
      setIsOptionalModalOpen(true);
    } else if (promoConfig.isFinalizing) {
        setIsOptionalModalOpen(false);
    }
  }, [promoConfig]);

  const handleArticleClick = useCallback((article) => {
    if (article.isPromo) {
      startPromo(article, settings, context);
    } else {
      const hasOptionals = article.opcionalesConfig && Object.keys(article.opcionalesConfig).length > 0;
      let showOptionals = false;

      if (context === 'counter' && hasOptionals) {
          showOptionals = settings?.showOptionalsInCounter !== false;
      } else if (context === 'delivery' && hasOptionals) {
          showOptionals = settings?.web?.showOptionalsInDelivery !== false; 
      }

      if (hasOptionals && showOptionals) {
        setArticleForSelection(article);
        setIsOptionalModalOpen(true);
      } else {
        addArticleToOrder(article);
      }
    }
  }, [startPromo, settings, context, addArticleToOrder]);

  const handleUpdateQuantity = useCallback((uniqueId, change) => {
    const target = orderItems.find((i) => i.uniqueId === uniqueId);
    if (!target) return;

    // Producto CON opcionales: no se comparte una selección entre unidades.
    if (esLineaConfigurable(target)) {
      if (change > 0) {
        // Aumentar = configurar una unidad NUEVA. No se copia la unidad 1 ni se
        // agrega nada hasta confirmar (confirmación incremental segura: si el
        // usuario cancela, el carrito queda como estaba).
        const base = allArticles.find((a) => a.id === target.id) || target;
        const yaConfiguradas = contarUnidadesConfiguradas(orderItems, target.id);
        setPendingUnitInfo({ unidadIndice: yaConfiguradas + 1, unidadTotal: yaConfiguradas + 1 });
        setArticleForSelection(baseParaUnidadNueva(base));
        setIsOptionalModalOpen(true);
        return;
      }
      // Disminuir = quitar ESTA línea concreta (no "la última"), conservando
      // intactas las selecciones de las demás unidades.
      setOrderItems((prev) => quitarUnidad(prev, uniqueId));
      return;
    }

    // Producto SIN opcionales: comportamiento actual intacto (agrupa por quantity).
    setOrderItems((prevItems) =>
      prevItems
        .map((item) => {
          if (item.uniqueId === uniqueId) {
            const newQuantity = item.quantity + change;
            return newQuantity > 0 ? { ...item, quantity: newQuantity } : null;
          }
          return item;
        })
        .filter(Boolean)
    );
  }, [orderItems, allArticles]);

  const handleUpdatePrice = useCallback((uniqueId, newPrice) => {
    setOrderItems(prevItems => 
      prevItems.map(item => 
        item.uniqueId === uniqueId ? { ...item, valor: newPrice } : item
      )
    );
  }, []);

  const handleRemoveItem = useCallback((uniqueId) => {
    setOrderItems(prevItems => prevItems.filter(item => item.uniqueId !== uniqueId));
  }, []);
  
  const handleConfirmOptionals = (articleWithOptionals) => {
    if (promoConfig.isConfiguring) {
      handlePromoItemConfigured(articleWithOptionals);
      return;
    }

    const processedOptionals = {};
    for (const groupId in articleWithOptionals.selectedOptionals) {
      const group = allOptionalGroups.find(g => g.id === groupId);
      const groupName = group ? group.nombre.toUpperCase() : 'OPCIONALES';
      processedOptionals[groupId] = articleWithOptionals.selectedOptionals[groupId].map(op => ({
        ...op,
        groupName: groupName
      }));
    }
    articleWithOptionals.selectedOptionals = processedOptionals;
    
    addArticleToOrder(articleWithOptionals);
    setIsOptionalModalOpen(false);
    setPendingUnitInfo(null); // la unidad quedó confirmada y agregada
  };

  const handleOptionalModalClose = (open) => {
    if (!open) {
      if (promoConfig.isConfiguring && !promoConfig.isFinalizing) {
        toast({
          variant: "destructive",
          title: "Configuración de promo cancelada",
        });
      }
      resetPromoConfig();
      setIsOptionalModalOpen(false);
      // Cancelar la configuración de una unidad nueva NO agrega nada al carrito
      // ni deja estado temporal: el pedido queda exactamente como estaba.
      setPendingUnitInfo(null);
    }
  };
  
  // Total con opcionales pagos incluidos. Antes era Σ valor × quantity, que
  // ignoraba por completo el precio de los opcionales. Ahora usa el cálculo
  // centralizado (mismo módulo en Desktop, Tablet y DLV Pedidos), que suma el
  // adicional exactamente una vez: `valor` sigue siendo SIEMPRE el precio base.
  const total = useMemo(
    () => calcularTotalPedido(orderItems, { onWarn: (w) => console.warn('[opcionales] importe inválido', w) }).total,
    [orderItems]
  );

  // Departamento real de cada línea del carrito (resuelto una sola vez; lo
  // usan tanto la plataforma del carrito como el resto de las reglas de
  // medios de pago de abajo).
  const itemDepartments = useMemo(() => {
    if (!orderItems.length || !departments.length) return [];
    return orderItems.map(item => {
        const article = allArticles.find(a => a.id === item.id);
        return departments.find(d => d.id === article?.departamento);
    }).filter(Boolean);
  }, [orderItems, departments, allArticles]);

  // ÚNICA fuente de verdad de "qué medios de pago corresponden a este
  // carrito" — la misma función que usa CounterPaymentModal.jsx (Mostrador).
  // Decide, en un solo lugar: plataforma (PEDIDOSYA/RAPPI/M.LIBRE) → Efectivo
  // + su propio prepago; común → medios normales del local restringidos a lo
  // que sus departamentos reales permiten (permiteVentaEfectivo/
  // permiteVentaElectronica), siempre sin ningún PREPAGO de plataforma;
  // plataformas mezcladas en el carrito → bloquear (sin medios).
  const carritoPlataforma = useMemo(
    () => resolverMediosDePago(itemDepartments, paymentMethods),
    [itemDepartments, paymentMethods]
  );

  const allowedPaymentMethods = paymentMethods.length ? carritoPlataforma.medios : paymentMethods;

  /**
   * Revalida el stock del carrito contra un snapshot FRESCO, con la cantidad
   * real de cada línea. El catálogo se filtra en vivo, pero entre agregar un
   * artículo y confirmar puede agotarse una materia prima (otra terminal, la
   * cocina, un carrito abierto un buen rato).
   *
   * Si la LECTURA falla, la venta TAMPOCO sigue: vender sin poder verificar el
   * stock es justamente lo que hay que evitar. El operador ve qué pasó y puede
   * reintentar; nada quedó a medias.
   *
   * @returns {Promise<boolean>} true si se puede seguir.
   */
  const revalidarStock = useCallback(async (items) => {
    setIsValidatingStock(true);
    try {
      const stock = await validarStockDeCarrito(items);
      if (!stock.suficiente) {
        toast({
          variant: "destructive",
          title: "Sin stock suficiente",
          description: stock.mensaje,
        });
        return false;
      }
      return true;
    } catch (e) {
      toast({
        variant: "destructive",
        title: "No se pudo verificar el stock",
        description: e?.message || MENSAJE_STOCK_NO_VERIFICABLE,
      });
      return false;
    } finally {
      setIsValidatingStock(false);
    }
  }, [toast]);

  const handleConfirmOrder = async () => {
    if (orderItems.length === 0) {
      toast({
        variant: "destructive",
        title: "Pedido vacío",
        description: "Debes añadir al menos un artículo al pedido.",
      });
      return;
    }

    // Carrito con artículos de DOS plataformas distintas (PEDIDOSYA/RAPPI/
    // M.LIBRE) a la vez: no puede pasar por diseño comercial (una venta nunca
    // mezcla plataformas), pero si un error de datos lo produce, se bloquea
    // la confirmación en vez de inventar una combinación de prepagos que no
    // existe.
    if (carritoPlataforma.bloquear) {
      toast({ variant: "destructive", title: carritoPlataforma.titulo, description: carritoPlataforma.mensaje });
      return;
    }

    // Precio de opcional inválido → NO se puede confirmar un pedido nuevo con un
    // total incorrecto. Se indica exactamente qué producto y qué opcional fallan.
    // Un precio 0 (gratuito) NO bloquea; los pedidos históricos ya guardados
    // tampoco se ven afectados (esto corre solo al confirmar uno nuevo).
    // Bloqueo compartido con Tablet y DLV: identifica producto, unidad, grupo,
    // opcional y el valor inválido recibido. Corre tanto al confirmar un pedido
    // nuevo como al guardar la edición de uno pendiente (este mismo handler
    // atiende los dos casos, según `isEditing`).
    const bloqueo = evaluarBloqueoPrecioInvalido(orderItems);
    if (bloqueo.bloquear) {
      toast({ variant: "destructive", title: bloqueo.titulo, description: bloqueo.mensaje });
      return;
    }

    // Stock real ANTES de avanzar al pago (mostrador) o a los datos del cliente
    // (delivery): indica qué materia prima falta y cuánta hace falta.
    if (!await revalidarStock(orderItems)) return;

    if (isCounterMode) {
      onOrderCreated({ items: orderItems, total });
    } else if (isEditing) {
      // `yaValidado`: el stock se acaba de revalidar dos líneas más arriba, no
      // hace falta volver a leer el snapshot.
      handleFinalizeOrder({
        items: orderItems,
        type: editOrderType,
        payment: {
            ...orderToEdit.payment,
            amount: total,
            total: total
        }
      }, { yaValidado: true });
    } else {
      setIsConfirmModalOpen(true);
    }
  };

  const handleBackToOrder = () => {
    setIsConfirmModalOpen(false);
  };

  const handleFinalizeOrder = async (orderData, { yaValidado = false } = {}) => {
    // Segunda revalidación: entre confirmar el pedido y llegar acá el operador
    // cargó los datos del cliente en ConfirmOrderModal, y eso puede llevar
    // minutos. ConfirmOrderModal llama con un solo argumento, así que este
    // camino siempre revalida.
    if (!yaValidado && !await revalidarStock(orderData.items)) return;

    try {
      let newOrderId;

      if (orderData?.payment?.payments) {
        const operationalDate = formatDateToDDMMAAAA(getOperationalDate(new Date()));
        for (const payment of orderData.payment.payments) {
          const methodUpper = payment.method.toUpperCase();
          if (methodUpper.includes('PREPAGO PEDIDOSYA')) {
            await savePrepaymentForApp('PEDIDOSYA', payment.amount, operationalDate);
          } else if (methodUpper.includes('PREPAGO RAPPI')) {
            await savePrepaymentForApp('RAPPI', payment.amount, operationalDate);
            // Nombre actual y el histórico con punto: mismo ledger PREPAGO_MPAGO.
          } else if (methodUpper.includes('PREPAGO MPAGO') || methodUpper.includes('PREPAGO M.PAGO')) {
            await savePrepaymentForApp('MPAGO', payment.amount, operationalDate);
          }
        }
      }

      if (isEditing) {
        await updateOrder(orderToEdit.id, orderData);
        newOrderId = orderToEdit.id;
        toast({
          title: "¡Pedido Modificado!",
          description: "El pedido ha sido actualizado correctamente.",
          className: "bg-green-500 text-white",
        });
      } else {
        const newOrder = await saveOrder(orderData, currentShift);
        newOrderId = newOrder?.id;
        toast({
          title: "¡Pedido Aceptado!",
          description: "El pedido ha sido guardado y está listo para ser comandado.",
          className: "bg-green-500 text-white",
        });
      }
      
      onOpenChange(false);
      if (onOrderCreated) {
        onOrderCreated(newOrderId);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al guardar",
        description: "No se pudo guardar el pedido. Inténtelo de nuevo.",
      });
    }
  };

  const title = isEditing ? 'Modificar Pedido' : (isCounterMode ? 'Nuevo Pedido de Mostrador' : 'Nuevo Pedido');
  const isLoadingData = loading || isCheckingPromos;

  return (
    <>
      <Dialog open={isOpen && !isConfirmModalOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] h-[95vh] flex flex-col p-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="text-2xl font-bold text-gray-800">{title}</DialogTitle>
          </DialogHeader>
          
          <div className="flex-grow grid grid-cols-12 gap-4 p-4 overflow-hidden">
            {isLoadingData ? (
              <div className="col-span-12 flex flex-col items-center justify-center space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-sm text-slate-500 font-medium">Verificando stock y disponibilidad de promociones...</p>
              </div>
            ) : error ? (
              <div className="col-span-12 flex items-center justify-center text-red-500 font-semibold">
                {error}
              </div>
            ) : (
              <>
                <DepartmentList 
                  departments={departments}
                  selectedDepartment={selectedDepartment}
                  onSelectDepartment={setSelectedDepartment}
                />
                <ArticleGrid 
                  articles={articlesByDept[selectedDepartment] || []}
                  onArticleClick={handleArticleClick}
                  size={context === 'delivery' || context === 'counter' ? 'compact' : 'normal'}
                  isVerifying={isVerifying}
                />
                <ScrollArea className="col-span-4 h-full">
                  <OrderSummary 
                    orderItems={orderItems}
                    total={total}
                    onUpdateQuantity={handleUpdateQuantity}
                    onRemoveItem={handleRemoveItem}
                    onUpdatePrice={handleUpdatePrice}
                  />
                </ScrollArea>
              </>
            )}
          </div>

          <DialogFooter className="p-4 border-t bg-white">
            {isEditing && (
              <div className="flex items-center gap-4 mr-auto">
                <span className="text-sm font-semibold text-gray-700">Modo de entrega:</span>
                <label className="flex items-center gap-1.5 cursor-pointer text-sm font-medium">
                  <input
                    type="radio"
                    name="editOrderType"
                    value="ENVIO"
                    checked={editOrderType === 'ENVIO'}
                    onChange={e => setEditOrderType(e.target.value)}
                    className="form-radio h-4 w-4 text-primary"
                  />
                  Envío
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-sm font-medium">
                  <input
                    type="radio"
                    name="editOrderType"
                    value="RETIRO"
                    checked={editOrderType === 'RETIRO'}
                    onChange={e => setEditOrderType(e.target.value)}
                    className="form-radio h-4 w-4 text-primary"
                  />
                  Retiro en local
                </label>
              </div>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleConfirmOrder} disabled={isLoadingData || isValidatingStock}>
              {isValidatingStock
                ? 'Verificando stock...'
                : (isEditing ? 'Guardar Cambios' : (isCounterMode ? 'Proceder al Pago' : 'Confirmar Pedido'))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OptionalSelectionModal
        isOpen={isOptionalModalOpen}
        onOpenChange={handleOptionalModalClose}
        article={articleForSelection}
        allOptionals={allOptionals}
        allOptionalGroups={allOptionalGroups}
        onConfirm={handleConfirmOptionals}
        isPromoItem={promoConfig.isConfiguring}
        promoItemIndex={promoConfig.currentIndex}
        promoTotalItems={promoConfig.itemsToConfigure.length}
        unidadIndice={pendingUnitInfo?.unidadIndice}
        unidadTotal={pendingUnitInfo?.unidadTotal}
      />

      <GroupProductSelectionModal
        isOpen={promoConfig.isResolvingGroups}
        choice={promoConfig.groupChoicesToResolve[promoConfig.currentGroupIndex]}
        currentIndex={promoConfig.currentGroupIndex}
        totalChoices={promoConfig.groupChoicesToResolve.length}
        onSelect={handleGroupItemResolved}
        onCancel={resetPromoConfig}
      />

      <ConfirmOrderModal
        isOpen={isConfirmModalOpen}
        onOpenChange={setIsConfirmModalOpen}
        total={total}
        orderItems={orderItems}
        onBack={handleBackToOrder}
        onConfirm={handleFinalizeOrder}
        allowedPaymentMethods={allowedPaymentMethods}
        currentShift={currentShift}
        settings={settings}
      />
    </>
  );
}

export default NewOrderModal;