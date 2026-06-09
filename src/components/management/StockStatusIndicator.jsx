import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const StockStatusIndicator = ({ articles = [], onClick }) => {
  const outOfStockCount = useMemo(() => {
    return articles.filter(a => Number(a.stock) === 0 || Number(a.stockHeredado) === 0).length;
  }, [articles]);

  const isOutOfStock = outOfStockCount > 0;

  return (
    <Button
      variant={isOutOfStock ? "destructive" : "outline"}
      size="sm"
      onClick={onClick}
      className={`flex items-center gap-2 ${
        isOutOfStock 
          ? 'bg-red-500 hover:bg-red-600 text-white' 
          : 'text-green-600 border-green-200 hover:bg-green-50'
      }`}
    >
      {isOutOfStock ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
      <span>{isOutOfStock ? `${outOfStockCount} Sin Stock` : 'Stock Completo'}</span>
    </Button>
  );
};

export default StockStatusIndicator;