import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { fetchData } from '@/lib/api/firebaseApi';
import { saveOrder, updateOrder } from '@/lib/api/ordersApi';
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
import { useStockVerification } from '@/hooks/useStockVerification';
import { usePromotionStockAutomation } from '@/hooks/usePromotionStockAutomation';

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
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [articleForSelection, setArticleForSelection] = useState(null);

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
      return [...prevItems, { ...article, valor: priceToUse, quantity: 1, uniqueId }];
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
    try {
      const [fetchedDepartments, fetchedArticles, fetchedOptionals, fetchedOptionalGroups, fetchedProductGroups, fetchedAccounts] = await Promise.all([
        fetchData('departamentos'),
        fetchData('articulos'),
        fetchData('opcionales'),
        fetchData('grupos-opcionales'),
        fetchData('grupos-productos'),
        fetchAccounts()
      ]);

      const activeDepartments = fetchedDepartments.filter(d => {
        if (context === 'delivery') return d.activoDelivery;
        if (context === 'counter') return d.activoMostrador;
        return true;
      }).sort((a,b) => (a.ordenWeb || 999) - (b.ordenWeb || 999));

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
      } else {
        setOrderItems([]);
      }
    } else if (!isOpen) {
        setOrderItems([]);
        setIsConfirmModalOpen(false);
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
    setOrderItems(prevItems => {
      return prevItems.map(item => {
        if (item.uniqueId === uniqueId) {
          const newQuantity = item.quantity + change;
          return newQuantity > 0 ? { ...item, quantity: newQuantity } : null;
        }
        return item;
      }).filter(Boolean);
    });
  }, []);

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
    }
  };
  
  const total = orderItems.reduce((sum, item) => sum + parseFloat(item.valor || 0) * item.quantity, 0);

  const allowedPaymentMethods = useMemo(() => {
    if (!orderItems.length || !departments.length || !paymentMethods.length) {
        return paymentMethods;
    }

    const itemDepartments = orderItems.map(item => {
        const article = allArticles.find(a => a.id === item.id);
        return departments.find(d => d.id === article?.departamento);
    }).filter(Boolean);

    if (!itemDepartments.length) return paymentMethods;

    const allAcceptCash = itemDepartments.every(d => d.aceptaEfectivo);
    const allAcceptElectronic = itemDepartments.every(d => d.aceptaPagoElectronico);

    if (allAcceptCash && !allAcceptElectronic) {
        return ['Efectivo'];
    }
    
    if (!allAcceptCash && allAcceptElectronic) {
        return paymentMethods.filter(pm => pm !== 'Efectivo');
    }

    return paymentMethods;
  }, [orderItems, departments, allArticles, paymentMethods]);

  const handleConfirmOrder = () => {
    if (orderItems.length === 0) {
      toast({
        variant: "destructive",
        title: "Pedido vacío",
        description: "Debes añadir al menos un artículo al pedido.",
      });
      return;
    }

    if (isCounterMode) {
      onOrderCreated({ items: orderItems, total });
    } else if (isEditing) {
      handleFinalizeOrder({
        items: orderItems,
        payment: {
            ...orderToEdit.payment,
            amount: total,
            total: total
        }
      });
    } else {
      setIsConfirmModalOpen(true);
    }
  };

  const handleBackToOrder = () => {
    setIsConfirmModalOpen(false);
  };

  const handleFinalizeOrder = async (orderData) => {
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
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleConfirmOrder} disabled={isLoadingData}>
              {isEditing ? 'Guardar Cambios' : (isCounterMode ? 'Proceder al Pago' : 'Confirmar Pedido')}
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
      />

      <GroupProductSelectionModal
        isOpen={promoConfig.isResolvingGroups}
        choice={promoConfig.groupChoicesToResolve[promoConfig.currentGroupIndex]}
        currentIndex={promoConfig.currentGroupIndex}
        totalChoices={promoConfig.groupChoicesToResolve.length}
        onSelect={handleGroupItemResolved}
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
      />
    </>
  );
}

export default NewOrderModal;