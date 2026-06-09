import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import './index.css';
import { AuthProvider } from '@/hooks/useAuth.jsx';
import { AccountsProvider } from '@/contexts/AccountsContext.jsx';
import { initializeImageCache } from '@/lib/cache/imageCache.js';

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AccountsProvider>
            <App />
          </AccountsProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </>
);