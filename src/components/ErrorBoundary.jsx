import React from 'react';
import { logger } from '@/lib/errorLogger';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    logger.log(error, { 
      component: this.props.componentName || 'Unknown Component',
      errorInfo: errorInfo.componentStack 
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset);
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 bg-red-50 rounded-lg border border-red-200 m-4 min-h-[300px] text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-red-800 mb-2">Algo salió mal</h2>
          <p className="text-red-600 mb-6 max-w-md">
            {this.state.error?.message || 'Se produjo un error inesperado al cargar este componente.'}
          </p>
          <Button onClick={this.handleReset} variant="outline" className="flex items-center gap-2 bg-white hover:bg-gray-50 text-red-700 border-red-200">
            <RefreshCw className="w-4 h-4" />
            Reintentar
          </Button>
          {import.meta.env.MODE === 'development' && this.state.errorInfo && (
            <details className="mt-6 text-left w-full max-w-2xl p-4 bg-white rounded shadow-sm overflow-auto text-xs text-gray-700">
              <summary className="cursor-pointer font-bold mb-2">Detalles técnicos</summary>
              <pre className="whitespace-pre-wrap">{this.state.errorInfo.componentStack}</pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;