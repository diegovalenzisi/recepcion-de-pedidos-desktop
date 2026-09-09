'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// window.electronAPI — API de gestión de la app (autostart, versión, etc.)
contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  getBackendStatus: () => ipcRenderer.invoke('backend-status'),
  getBackendPort: () => ipcRenderer.invoke('backend-port'),
  getAutostart: () => ipcRenderer.invoke('autostart-get'),
  setAutostart: (enable) => ipcRenderer.invoke('autostart-set', enable),
  openUserDataFolder: () => ipcRenderer.invoke('open-userData-folder'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  downloadAndInstall: (url, fileName, sha256) => ipcRenderer.invoke('download-and-install', url, fileName, sha256),
  checkUpdatesNow: () => ipcRenderer.invoke('check-updates-now'),
  onDownloadProgress: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },
  onUpdateAvailable: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  mpAccounts: {
    read: () => ipcRenderer.invoke('mp-accounts:read'),
    write: (accounts) => ipcRenderer.invoke('mp-accounts:write', accounts),
  },
  backendRestart: () => ipcRenderer.invoke('backend:restart'),
  localResetForNew: () => ipcRenderer.invoke('local:reset-for-new'),
  setActiveLocal: (localId) => ipcRenderer.invoke('local:set-active', localId),
  getMachineId: () => ipcRenderer.invoke('machine-id:get'),
  getMachineInfo: () => ipcRenderer.invoke('machine-id:get-info'),
  systemCheck:  () => ipcRenderer.invoke('app:system-check'),
  mpMigrateGlobalToLocal: ()   => ipcRenderer.invoke('mp:migrate-global-to-local'),
  mpBackendHealth:    ()       => ipcRenderer.invoke('mp:backend-health'),
  mpRecentPayments:   (horas)  => ipcRenderer.invoke('mp:recent-payments', horas),
  mpBackendDiag:      ()       => ipcRenderer.invoke('mp:backend-diag'),
  mpRepair:           ()       => ipcRenderer.invoke('mp:repair'),
  backend: {
    genEnvFromSA: (mpToken)      => ipcRenderer.invoke('backend:gen-env-from-sa', mpToken),
    setMpToken:   (token, cfg)   => ipcRenderer.invoke('backend:set-mp-token', token, cfg),
    // Crea/completa el backend.env del local activo con las variables base (DB URL del local, LOCAL_ID, ruta pagos)
    ensureEnv:    (cfg)          => ipcRenderer.invoke('backend:ensure-env', cfg),
  },
  facturacion: {
    // Configuración de cuentas
    pickFile:      (filters) => ipcRenderer.invoke('facturacion:pick-file', filters),
    initAccount:   (tipo, cuentaId) => ipcRenderer.invoke('facturacion:init-account', tipo, cuentaId),
    writeEnv:      (accountDir, envData) => ipcRenderer.invoke('facturacion:write-env', accountDir, envData),
    copyFile:      (srcPath, accountDir, destRelative) => ipcRenderer.invoke('facturacion:copy-file', srcPath, accountDir, destRelative),
    getAccountDir: (tipo, cuentaId) => ipcRenderer.invoke('facturacion:account-dir', tipo, cuentaId),
    // Archivos binarios (para sync de certs via Firebase Storage)
    readFileBase64:  (filePath) => ipcRenderer.invoke('facturacion:read-file-base64', filePath),
    writeBinaryFile: (destPath, base64Data) => ipcRenderer.invoke('facturacion:write-binary-file', destPath, base64Data),
    downloadFile:    (url, destPath) => ipcRenderer.invoke('facturacion:download-file', url, destPath),
    diagnose:        (tipo, cuentaId) => ipcRenderer.invoke('facturacion:diagnose', tipo, cuentaId),
    openLog:         () => ipcRenderer.invoke('facturacion:open-log'),
    // Dependencias
    installDeps:  () => ipcRenderer.invoke('facturacion:install-deps'),
    depsOk:       () => ipcRenderer.invoke('facturacion:deps-ok'),
    filesOk:      (tipo, cuentaId) => ipcRenderer.invoke('facturacion:files-ok', tipo, cuentaId),
    // Eliminar cuenta fiscal: detiene el proceso y borra solo credenciales/config
    // activa (nunca facturas históricas). Ver electron/main.js para el detalle.
    deleteAccountFiles: (tipo, cuentaId) => ipcRenderer.invoke('facturacion:delete-account-files', tipo, cuentaId),
    nodeVersion:  () => ipcRenderer.invoke('facturacion:node-version'),
    // ¿Hay un motor de facturación corriendo en esta PC? (solo lectura)
    isRunning:    () => ipcRenderer.invoke('facturacion:is-running'),
    // Proceso
    start:     (key, accountDir) => ipcRenderer.invoke('facturacion:start', key, accountDir),
    stop:      (key) => ipcRenderer.invoke('facturacion:stop', key),
    restart:   (key, accountDir) => ipcRenderer.invoke('facturacion:restart', key, accountDir),
    getStatus: (key) => ipcRenderer.invoke('facturacion:status', key),
    getLogs:   (key) => ipcRenderer.invoke('facturacion:logs', key),
    // Config persistente (por local)
    readConfig:  () => ipcRenderer.invoke('facturacion:config:read'),
    writeConfig: (config) => ipcRenderer.invoke('facturacion:config:write', config),
    // Migración responsable del config global viejo → local activo
    globalConfigSummary: () => ipcRenderer.invoke('facturacion:global-config-summary'),
    migrateGlobalToLocal: (localId, meta) => ipcRenderer.invoke('facturacion:migrate-global-to-local', localId, meta),
    // Eventos en tiempo real
    onLog: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('facturacion:log', handler);
      return () => ipcRenderer.removeListener('facturacion:log', handler);
    },
    onStatus: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('facturacion:status', handler);
      return () => ipcRenderer.removeListener('facturacion:status', handler);
    },
    onInstallLog: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('facturacion:install-log', handler);
      return () => ipcRenderer.removeListener('facturacion:install-log', handler);
    },
  },
  components: {
    check:     ()     => ipcRenderer.invoke('components:check'),
    install:   (keys) => ipcRenderer.invoke('components:install', keys),
    bootstrap: ()     => ipcRenderer.invoke('components:bootstrap'),
    markNotReady: ()  => ipcRenderer.invoke('components:mark-not-ready'),
    onProgress: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('components:progress', handler);
      return () => ipcRenderer.removeListener('components:progress', handler);
    },
  },
  relaunchApp:  () => ipcRenderer.invoke('app:relaunch'),
  quitApp:      () => ipcRenderer.invoke('app:quit'),
  getBootFlags: () => ipcRenderer.invoke('app:boot-flags'),
  // Caché local de imágenes de artículos (proceso principal). El renderer solo
  // recibe URLs dlvimg://... o el placeholder — nunca rutas físicas de Windows.
  imageCache: {
    resolveLocal:      (params) => ipcRenderer.invoke('image-cache:resolve-local', params),
    shouldCheck:       (params) => ipcRenderer.invoke('image-cache:should-check', params),
    recordCheck:       (params) => ipcRenderer.invoke('image-cache:record-check', params),
    markRemoteDeleted: (params) => ipcRenderer.invoke('image-cache:mark-remote-deleted', params),
    // Autocorrección: la imagen volvió a existir → se levanta `remote-deleted`.
    clearRemoteDeleted: (params) => ipcRenderer.invoke('image-cache:clear-remote-deleted', params),
    download:          (params) => ipcRenderer.invoke('image-cache:download', params),
    sweep:             (params) => ipcRenderer.invoke('image-cache:sweep', params),
  },
  isElectron: true,
});

// window.electron — compatibilidad con el código existente de impresión
// electronPrint.js usa: window.electron.printDirect(htmlContent, printerName, options)
contextBridge.exposeInMainWorld('electron', {
  printDirect: (htmlContent, printerName, options = {}) =>
    ipcRenderer.invoke('print-direct', htmlContent, printerName, options),

  getPrinters: () => ipcRenderer.invoke('get-printers'),
});
