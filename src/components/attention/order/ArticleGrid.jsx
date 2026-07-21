import React, { useState, useEffect, useRef, memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
import { useArticleImage } from '@/hooks/useArticleImage';

// Memoized ArticleCard to prevent unnecessary re-renders when parent state changes
const ArticleCard = memo(({ article, onArticleClick, isCompact }) => {
  // Imagen con caché local (stale-while-revalidate): muestra la copia local al
  // instante (dlvimg://) o la remota/placeholder mientras se resuelve, y se
  // actualiza sola si Firebase tiene una versión nueva. Ver useArticleImage.
  const { src: imageSrc, onError: onImageError } = useArticleImage(article);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef(null);

  const cardPadding = isCompact ? "p-2" : "p-3";
  const imageHeight = isCompact ? "h-12" : "h-20";
  const titleSize = isCompact ? "text-xs" : "text-sm";
  const priceSize = isCompact ? "text-xs" : "text-sm";
  const nameSpacing = isCompact ? "mt-2 mb-1" : "mt-3 mb-2";

  // Note: Stock > 0 is already guaranteed by the verifier for rendering, 
  // but we keep the visual fallback just in case
  const isOutOfStock = false; 

  const isPriorityItem = article.nombre && article.nombre.toUpperCase().includes("1 KILO DE HELADO");
  
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete) {
      setImgLoaded(true);
    }
  }, []);

  return (
    <button
      onClick={() => onArticleClick(article)}
      className={`bg-white rounded-lg shadow-md hover:shadow-xl hover:scale-105 transition-all text-center flex flex-col items-center ${cardPadding}`}
    >
      <div className={`w-full ${imageHeight} relative mb-1`}>
        {!imgLoaded && (
          <Skeleton className="absolute inset-0 w-full h-full rounded-lg" />
        )}
        <img
          ref={imgRef}
          alt={article.nombre}
          className={`w-full h-full object-cover rounded-lg transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          src={imageSrc}
          loading={isPriorityItem ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setImgLoaded(true)}
          onError={() => { onImageError(); setImgLoaded(true); }}
        />
      </div>
      
      <div className={`flex-grow flex flex-col justify-start items-center w-full ${nameSpacing} min-h-[3.5rem]`}>
        <div className="flex items-start justify-center gap-2 w-full px-2">
          <span 
            className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${isOutOfStock ? 'bg-red-500' : 'bg-green-500'}`} 
            title={isOutOfStock ? "Sin stock" : "En stock"}
          />
          <p className={`font-bold text-slate-800 leading-tight ${titleSize} text-left flex-1`}>
            {article.nombre}
          </p>
        </div>
      </div>
      
      <p className={`text-orange-600 font-semibold mt-auto ${priceSize}`}>
        ${parseFloat(article.valor || 0).toFixed(2)}
      </p>
    </button>
  );
});

ArticleCard.displayName = "ArticleCard";

const ArticleGrid = ({ articles, onArticleClick, size = 'normal', isVerifying = false }) => {
  const isCompact = size === 'compact';

  const gridClasses = isCompact 
    ? "grid-cols-5 gap-3"
    : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4";

  return (
    <div className="col-span-6 bg-slate-50 rounded-lg p-3 overflow-y-auto">
      <h2 className="text-lg font-semibold mb-3 text-slate-700 px-1">Artículos</h2>
      
      {isVerifying ? (
        <div className="flex flex-col items-center justify-center h-48 text-center mt-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
          <p className="text-sm font-medium text-slate-500">Verificando stock en tiempo real...</p>
        </div>
      ) : (!articles || articles.length === 0) ? (
        <div className="flex flex-col items-center justify-center h-48 text-center px-4 mt-10">
          <p className="text-slate-600 font-medium">No hay artículos disponibles</p>
          <p className="text-sm text-slate-400 mt-2">Los productos en este departamento pueden estar agotados o inactivos actualmente.</p>
        </div>
      ) : (
        <div className={`grid ${gridClasses}`}>
          {articles.map(article => (
            <ArticleCard 
              key={article.id} 
              article={article} 
              onArticleClick={onArticleClick} 
              isCompact={isCompact} 
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ArticleGrid;