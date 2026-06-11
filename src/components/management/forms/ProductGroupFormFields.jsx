import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

const ProductGroupFormFields = ({ formData, onFieldChange, allData }) => {
  const allArticles = (allData?.articulos || []).filter(article => !article.isPromo);
  const allDepartments = allData?.departamentos || [];
  const selectedArticles = formData.articulos || [];

  const getDepartmentName = (article) => {
    const departmentId = article.departamento || article.departamentoId || article.category || article.categoryId || article.categoria || article.categoriaId || article.rubro || article.rubroId;
    if (!departmentId) return 'Sin departamento';
    const department = allDepartments.find(d => d.id === departmentId);
    return department ? department.nombre : 'Sin departamento';
  };

  const toggleArticle = (articleId) => {
    const newSelection = selectedArticles.includes(articleId)
      ? selectedArticles.filter(id => id !== articleId)
      : [...selectedArticles, articleId];
    onFieldChange('articulos', newSelection);
  };

  const groupedArticles = (() => {
    const groups = {};
    allArticles.forEach(article => {
      const departmentName = getDepartmentName(article);
      if (!groups[departmentName]) groups[departmentName] = [];
      groups[departmentName].push(article);
    });

    return Object.keys(groups)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(departmentName => ({
        departmentName,
        articles: [...groups[departmentName]].sort((a, b) => (a.nombre || '').toLowerCase().localeCompare((b.nombre || '').toLowerCase())),
      }));
  })();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="nombre">Nombre del Grupo</Label>
        <Input
          id="nombre"
          value={formData.nombre || ''}
          onChange={(e) => onFieldChange('nombre', e.target.value)}
          placeholder="Ej: GIO"
        />
      </div>

      <div className="space-y-2">
        <Label>Productos del Grupo</Label>
        <p className="text-xs text-gray-500">
          Seleccioná los productos que van a poder elegirse como parte de este grupo dentro de las promociones.
        </p>
        <div className="border rounded-lg p-3">
          <ScrollArea className="h-[280px]">
            <div className="space-y-4 pr-2">
              {groupedArticles.map(({ departmentName, articles }) => (
                <div key={departmentName}>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">{departmentName}</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {articles.map(article => (
                      <label key={article.id} className="flex items-center space-x-2 p-2 rounded-md hover:bg-gray-50 cursor-pointer">
                        <Checkbox
                          checked={selectedArticles.includes(article.id)}
                          onCheckedChange={() => toggleArticle(article.id)}
                        />
                        <span className="text-sm">{article.nombre}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};

export default ProductGroupFormFields;
