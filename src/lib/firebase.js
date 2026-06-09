import {
  getLocalId,
  setLocalId
} from './firebase/core';

import {
  fetchOrders,
  saveOrder,
  updateOrder,
} from './api/ordersApi';

import {
  fetchClients,
  fetchClientByPhone,
  saveClient,
  deleteClient
} from './api/clientsApi';

import {
  fetchDeliverers,
  saveDeliverer,
  deleteDeliverer
} from './api/deliverersApi';

import {
  fetchSettings,
  saveSettings
} from './api/settingsApi';

export {
  getLocalId,
  setLocalId,
  fetchOrders,
  saveOrder,
  updateOrder,
  fetchClients,
  fetchClientByPhone,
  saveClient,
  deleteClient,
  fetchDeliverers,
  saveDeliverer,
  deleteDeliverer,
  fetchSettings,
  saveSettings
};