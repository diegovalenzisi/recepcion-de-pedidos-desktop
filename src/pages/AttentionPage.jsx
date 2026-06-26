import React, { useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import DeliveryTab from '@/components/attention/DeliveryTab';
import CounterTab from '@/components/attention/CounterTab';
import ClientsTab from '@/components/attention/ClientsTab';
import DeliverersTab from '@/components/attention/DeliverersTab';
import { useAuth } from '@/hooks/useAuth';
import { useStockStatus } from '@/hooks/useStockStatus';
import StockStatusBadge from '@/components/management/StockStatusBadge';
import OutOfStockModal from '@/components/management/OutOfStockModal';

const TabLink = ({
  to,
  children,
  permission,
  userPermissions,
  userRole
}) => {
  if (userRole !== 'dueño' && permission && !userPermissions[permission]) {
    return null;
  }
  return (
    <NavLink 
      to={to} 
      className={({ isActive }) => `px-3 py-1 text-sm font-semibold rounded-t-lg focus:outline-none flex items-center gap-2 ${isActive ? 'bg-white text-primary-dark shadow-[0_-1px_2px_rgba(0,0,0,0.1)] border-t border-l border-r border-gray-200 z-10 relative top-[1px]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'}`}
    >
      {children}
    </NavLink>
  );
};

const AttentionPage = ({
  currentShift,
  userPermissions,
  settings,
  alarmingOrderIds,
  acknowledgeOrder
}) => {
  const { user } = useAuth();
  const userRole = user?.rol;
  
  const {
    hasOutOfStock,
    hasLowStock,
    outOfStockCount,
    lowStockCount,
    outOfStockArticles,
    lowStockArticles,
    outOfStockRawMaterials,
    lowStockRawMaterials,
    localId
  } = useStockStatus();
  
  const [isOutOfStockModalOpen, setIsOutOfStockModalOpen] = useState(false);
  const hasAccessToAnyTab = userRole === 'dueño' || userPermissions.delivery || userPermissions.mostrador || userPermissions.clientes || userPermissions.repartidor;
  
  if (!hasAccessToAnyTab) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xl text-gray-600">No tienes acceso a ninguna sección de Atención.</p>
      </div>
    );
  }

  const getDefaultRoute = () => {
    if (userRole === 'dueño' || userPermissions.delivery) return 'delivery';
    if (userPermissions.mostrador) return 'mostrador';
    if (userPermissions.clientes) return 'clientes';
    if (userPermissions.repartidor) return 'repartidores';
    return 'delivery';
  };

  return (
    <div className="flex-grow flex flex-col min-h-0">
      <div className="flex justify-between items-end border-b border-gray-300 px-2 pt-2">
        <div className="flex space-x-1">
          <TabLink to="delivery" permission="delivery" userPermissions={userPermissions} userRole={userRole}>Delivery</TabLink>
          <TabLink to="mostrador" permission="mostrador" userPermissions={userPermissions} userRole={userRole}>Mostrador</TabLink>
          <TabLink to="clientes" permission="clientes" userPermissions={userPermissions} userRole={userRole}>Clientes</TabLink>
          <TabLink to="repartidores" permission="repartidor" userPermissions={userPermissions} userRole={userRole}>Repartidores</TabLink>
        </div>
        
        <div className="pb-2 px-2 flex items-center gap-2 text-sm font-medium text-gray-600">
          <div className="cursor-pointer" onClick={() => setIsOutOfStockModalOpen(true)}>
            <StockStatusBadge 
              outOfStockCount={outOfStockCount} 
              lowStockCount={lowStockCount} 
            />
          </div>
          <span>Atención</span>
        </div>
      </div>

      <div className="flex-grow bg-white p-2 rounded-b-xl shadow-sm min-h-0 border-l border-r border-b border-gray-200">
        <Routes>
          <Route path="/" element={<Navigate to={getDefaultRoute()} replace />} />
          {(userRole === 'dueño' || userPermissions.delivery) && (
            <Route 
              path="delivery" 
              element={
                <DeliveryTab 
                  currentShift={currentShift} 
                  settings={settings} 
                  context="delivery"
                  alarmingOrderIds={alarmingOrderIds}
                  acknowledgeOrder={acknowledgeOrder}
                />
              } 
            />
          )}
          {(userRole === 'dueño' || userPermissions.mostrador) && (
            <Route 
              path="mostrador" 
              element={
                <CounterTab 
                  currentShift={currentShift} 
                  settings={settings}
                />
              } 
            />
          )}
          {(userRole === 'dueño' || userPermissions.clientes) && (
            <Route path="clientes" element={<ClientsTab />} />
          )}
          {(userRole === 'dueño' || userPermissions.repartidor) && (
            <Route path="repartidores" element={<DeliverersTab />} />
          )}
        </Routes>
      </div>

      <OutOfStockModal 
        isOpen={isOutOfStockModalOpen} 
        onClose={() => setIsOutOfStockModalOpen(false)} 
        outOfStockArticles={outOfStockArticles} 
        outOfStockRawMaterials={outOfStockRawMaterials}
        lowStockArticles={lowStockArticles}
        lowStockRawMaterials={lowStockRawMaterials}
        localId={localId}
        departments={[]} 
      />
    </div>
  );
};

export default AttentionPage;