import React from 'react';
import DeliveryTab from '@/components/attention/DeliveryTab';

const DeliveryPage = ({ currentShift, settings, alarmingOrderIds, acknowledgeOrder }) => {
  return (
    <div className="h-full">
      <DeliveryTab 
        currentShift={currentShift} 
        settings={settings} 
        context="delivery"
        alarmingOrderIds={alarmingOrderIds}
        acknowledgeOrder={acknowledgeOrder}
      />
    </div>
  );
};

export default DeliveryPage;