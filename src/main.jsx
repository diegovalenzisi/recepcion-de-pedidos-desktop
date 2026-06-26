import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import './index.css';
import { AuthProvider } from '@/hooks/useAuth.jsx';
import { AccountsProvider } from '@/contexts/AccountsContext.jsx';
import { initializeImageCache } from '@/lib/cache/imageCache.js';

// En Electron la app se carga via file://, donde BrowserRouter no funciona
// porque no hay servidor que maneje las rutas. HashRouter usa /#/ruta en su lugar.
const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
const Router = isElectron ? HashRouter : BrowserRouter;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 30, // 30 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Initialize image memory and metadata cache on startup
initializeImageCache();

console.log(`[Recepción de pedidos] Versión ${__APP_VERSION__} - build ${__BUILD_TIME__}`);

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <AccountsProvider>
            <App />
          </AccountsProvider>
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  </>
);