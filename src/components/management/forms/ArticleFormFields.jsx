
import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Trash2, UploadCloud, Image as ImageIcon, Loader2, X, Link2, BookText } from 'lucide-react';
import StockManagement from './StockManagement';
import OptionalConfig from './OptionalConfig';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { uploadArticleImage } from '@/lib/firebase/storage';
import { useToast } from '@/components/ui/use-toast';
import { useOptionalsSorting } from '@/hooks/useOptionalsSorting';

const ArticleFormFields = ({ formData, onFieldChange, onPromoItemsChange, onStockChange, onOpcionalesConfigChange, allData }) => {
  const [selectedPromoArticle, setSelectedPromoArticle] = useState('');
  const [selectedPromoGroup, setSelectedPromoGroup] = useState('');
  const [promoGroupName, setPromoGroupName] = useState('');
  const [promoGroupPermitidos, setPromoGroupPermitidos] = useState([]);
  const fileInputRef = useRef(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setImagePreview(formData.foto || null);
  }, [formData.foto]);

  const allArticles = allData?.articulos || [];
  const allDepartments = allData?.departamentos || [];
  const allOptionalGroups = allData?.['grupos-opcionales'] || [];
  const allOpcionales = allData?.opcionales || [];
  const allRawMaterials = allData?.['materia-prima'] || [];
  const allProductGroups = allData?.['grupos-productos'] || [];

  const sortedOpcionales = useOptionalsSorting(allOpcionales);

  const handlePromoItemAdd = () => {
    if (!selectedPromoArticle) return;
    const article = allArticles.find(a => a.id === selectedPromoArticle);
    if (!article) return;

    const newItem = {
      codigo: article.id,
      nombre: article.nombre,
      cantidad: 1,
      uniqueId: `${article.id}-${Date.now()}`
    };
    const currentItems = formData.promoItems || [];
    onPromoItemsChange([...currentItems, newItem]);
    setSelectedPromoArticle('');
  };

  const handlePromoItemRemove = (uniqueId) => {
    const updatedItems = (formData.promoItems || []).filter(item => item.uniqueId !== uniqueId);
    onPromoItemsChange(updatedItems);
  };

  const handlePromoItemQuantityChange = (uniqueId, newQuantity) => {
    const updatedItems = (formData.promoItems || []).map(item =>
      item.uniqueId === uniqueId ? { ...item, cantidad: Math.max(1, parseInt(newQuantity, 10) || 1) } : item
    );
    onPromoItemsChange(updatedItems);
  };

  const handlePromoGroupSelect = (groupId) => {
    setSelectedPromoGroup(groupId);
    const group = allProductGroups.find(g => g.id === groupId);
    setPromoGroupName(group ? `${group.nombre} a elección` : '');
    setPromoGroupPermitidos([]);
  };

  const togglePermitido = (groupArticleIds, currentPermitidos, articleId) => {
    const currentAllowed = (currentPermitidos && currentPermitidos.length > 0) ? currentPermitidos : groupArticleIds;
    let newAllowed;
    if (currentAllowed.includes(articleId)) {
      newAllowed = currentAllowed.filter(id => id !== articleId);
      if (newAllowed.length === 0) return currentPermitidos; // mantener al menos uno permitido
    } else {
      newAllowed = [...currentAllowed, articleId];
    }
    return newAllowed.length === groupArticleIds.length ? [] : newAllowed;
  };

  const handlePromoGroupPermitidoToggle = (articleId) => {
    const group = allProductGroups.find(g => g.id === selectedPromoGroup);
    const groupArticleIds = group?.articulos || [];
    setPromoGroupPermitidos(prev => togglePermitido(groupArticleIds, prev, articleId));
  };

  const handlePromoGroupAdd = () => {
    if (!selectedPromoGroup) return;
    const group = allProductGroups.find(g => g.id === selectedPromoGroup);
    if (!group) return;

    const newItem = {
      tipo: 'grupo',
      grupoId: group.id,
      nombre: promoGroupName || `${group.nombre} a elección`,
      cantidad: 1,
      permitidos: promoGroupPermitidos,
      uniqueId: `grupo-${group.id}-${Date.now()}`
    };
    const currentItems = formData.promoItems || [];
    onPromoItemsChange([...currentItems, newItem]);
    setSelectedPromoGroup('');
    setPromoGroupName('');
    setPromoGroupPermitidos([]);
  };

  const handlePromoGroupItemNameChange = (uniqueId, newName) => {
    const updatedItems = (formData.promoItems || []).map(item =>
      item.uniqueId === uniqueId ? { ...item, nombre: newName } : item
    );
    onPromoItemsChange(updatedItems);
  };

  const handlePromoGroupItemPermitidoToggle = (uniqueId, articleId) => {
    const updatedItems = (formData.promoItems || []).map(item => {
      if (item.uniqueId !== uniqueId) return item;
      const group = allProductGroups.find(g => g.id === item.grupoId);
      const groupArticleIds = group?.articulos || [];
      return { ...item, permitidos: togglePermitido(groupArticleIds, item.permitidos, articleId) };
    });
    onPromoItemsChange(updatedItems);
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!formData.codigo) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes asignar un código al artículo antes de subir una imagen.",
      });
      event.target.value = '';
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({
        variant: "destructive",
        title: "Archivo muy grande",
        description: "La imagen no debe superar los 5MB.",
      });
      event.target.value = '';
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Formato no válido",
        description: "Solo se permiten imágenes JPG, PNG, GIF o WEBP.",
      });
      event.target.value = '';
      return;
    }

    setIsUploadingImage(true);

    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);

      const downloadURL = await uploadArticleImage(file, formData.codigo);
      
      onFieldChange('foto', downloadURL);
      
      toast({
        title: "¡Imagen subida!",
        description: "La imagen se guardó correctamente en Firebase Storage.",
      });
    } catch (error) {
      console.error('Error al subir imagen:', error);
      toast({
        variant: "destructive",
        title: "Error al subir imagen",
        description: error.message || "No se pudo subir la imagen. Verifica tu conexión y los permisos de Firebase Storage.",
      });
      setImagePreview(formData.foto || null);
    } finally {
      setIsUploadingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveImage = () => {
    onFieldChange('foto', '');
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const availablePromoArticles = allArticles.filter(article => !article.isPromo);
  
  const currentStockType = formData.stock?.stockType || 'propio';
  const isPropioStock = currentStockType === 'propio';
  const isHeredadoStock = currentStockType === 'heredado';
  const isRecetaStock = currentStockType === 'receta';

  // Calculate recipe cost live for UI
  let calculatedRecetaCost = 0;
  if (isRecetaStock && formData.stock?.receta) {
    calculatedRecetaCost = Object.entries(formData.stock.receta).reduce((sum, [codigo, qty]) => {
      const mp = allRawMaterials?.find(m => m.id === codigo || m.codigo === codigo);
      const unitCost = Math.round(Number(mp?.costoUnitario || 0) * 1000) / 1000;
      const lineTotal = Math.round((unitCost * (parseFloat(qty) || 0)) * 1000) / 1000;
      return sum + lineTotal;
    }, 0);
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="nombre">Nombre del Artículo</Label>
          <Input id="nombre" value={formData.nombre || ''} onChange={e => onFieldChange('nombre', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="departamento">Departamento</Label>
          <Select onValueChange={(value) => onFieldChange('departamento', value)} value={formData.departamento || ''}>
            <SelectTrigger id="departamento">
              <SelectValue placeholder="Seleccione un departamento" />
            </SelectTrigger>
            <SelectContent>
              {allDepartments.map(dep => (
                <SelectItem key={dep.id} value={dep.id}>{dep.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="descripcion">Descripción</Label>
        <Textarea id="descripcion" value={formData.descripcion || ''} onChange={e => onFieldChange('descripcion', e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-2">
          <Label htmlFor="valor">Valor de Venta</Label>
          <Input id="valor" type="number" step="0.001" value={formData.valor || ''} onChange={e => onFieldChange('valor', e.target.value)} />
        </div>
        
        {(isPropioStock || isHeredadoStock || isRecetaStock) && (
          <div className="space-y-2">
            <Label htmlFor="costoTotalReceta" className="flex items-center gap-2">
              Precio Costo
              {isHeredadoStock && (
                <span className="text-[10px] text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium">
                  <Link2 size={10}/> Heredado
                </span>
              )}
              {isRecetaStock && (
                <span className="text-[10px] text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium" title="Calculado automáticamente">
                  <BookText size={10}/> Receta
                </span>
              )}
            </Label>
            <Input 
              id="costoTotalReceta" 
              type="number" 
              step="0.001" 
              value={isRecetaStock ? calculatedRecetaCost.toFixed(3) : (formData.costoTotalReceta || '')} 
              onChange={e => onFieldChange('costoTotalReceta', e.target.value)} 
              placeholder="0.000"
              required={isPropioStock}
              disabled={isHeredadoStock || isRecetaStock}
              className={(isHeredadoStock || isRecetaStock) ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}
              readOnly={isRecetaStock}
            />
          </div>
        )}
        
        <div className="space-y-2">
          <Label htmlFor="stockMinimo" className="flex items-center gap-1">
            Stock Mínimo
            <span title="Umbral mínimo para alertas de stock bajo" className="text-gray-400 cursor-help ml-1">ℹ️</span>
          </Label>
          <Input id="stockMinimo" type="number" min="0" value={formData.stockMinimo || '0'} onChange={e => onFieldChange('stockMinimo', Number(e.target.value))} />
        </div>
        
        <div className="space-y-2">
          <Label>Foto del Artículo</Label>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden relative group shrink-0">
              {isUploadingImage ? (
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              ) : imagePreview ? (
                <>
                  <img src={imagePreview} alt="Vista previa" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <ImageIcon className="w-6 h-6 text-gray-400" />
              )}
            </div>
            <Input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              className="hidden" 
              accept="image/jpeg,image/png,image/gif,image/webp" 
              disabled={isUploadingImage}
            />
            <Button 
              type="button" 
              variant="outline"
              className="w-full text-xs h-8"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingImage || !formData.codigo}
            >
              <UploadCloud className="mr-1 h-3 w-3" /> 
              {isUploadingImage ? 'Subiendo...' : 'Examinar'}
            </Button>
          </div>
          {!formData.codigo && <p className="text-[10px] text-amber-600 mt-1">⚠️ Asigna un código primero</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-4 border rounded-lg">
          <h4 className="font-semibold mb-3">Métodos de Pago</h4>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox id="permiteVentaEfectivo" checked={formData.permiteVentaEfectivo} onCheckedChange={checked => onFieldChange('permiteVentaEfectivo', checked)} />
              <Label htmlFor="permiteVentaEfectivo">Acepta Efectivo</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="permiteVentaElectronica" checked={formData.permiteVentaElectronica} onCheckedChange={checked => onFieldChange('permiteVentaElectronica', checked)} />
              <Label htmlFor="permiteVentaElectronica">Acepta Electrónico</Label>
            </div>
          </div>
        </div>
        <div className="p-4 border rounded-lg">
          <h4 className="font-semibold mb-3">Canales de Venta</h4>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="activoMostrador" 
                checked={formData.activoMostrador} 
                onCheckedChange={checked => {
                  console.log('[ArticleFormFields] User changed activoMostrador to:', checked);
                  onFieldChange('activoMostrador', checked);
                }} 
                disabled={!formData.activo} 
              />
              <Label htmlFor="activoMostrador" className={!formData.activo ? 'text-gray-400' : ''}>Activo para Mostrador</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="activoDelivery" 
                checked={formData.activoDelivery} 
                onCheckedChange={checked => {
                  console.log('[ArticleFormFields] User changed activoDelivery to:', checked);
                  onFieldChange('activoDelivery', checked);
                }} 
                disabled={!formData.activo}
              />
              <Label htmlFor="activoDelivery" className={!formData.activo ? 'text-gray-400' : ''}>Activo para Delivery</Label>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="ordenLocal">Orden Local</Label>
          <Input id="ordenLocal" type="number" value={formData.ordenLocal || '0'} onChange={e => onFieldChange('ordenLocal', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ordenWeb">Orden Web</Label>
          <Input id="ordenWeb" type="number" value={formData.ordenWeb || '0'} onChange={e => onFieldChange('ordenWeb', e.target.value)} />
        </div>
      </div>
      
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center space-x-2">
          <Switch id="isPromo" checked={formData.isPromo || false} onCheckedChange={checked => onFieldChange('isPromo', checked)} />
          <Label htmlFor="isPromo">Es una promo</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch id="destacado" checked={formData.destacado || false} onCheckedChange={checked => onFieldChange('destacado', checked)} />
          <Label htmlFor="destacado">Destacado</Label>
        </div>
        <div className="flex items-center space-x-2 border-l pl-4 border-gray-200">
          <Switch id="controlStock" checked={formData.controlStock !== false} onCheckedChange={checked => onFieldChange('controlStock', checked)} />
          <Label htmlFor="controlStock">Controlar Stock</Label>
        </div>
      </div>

      {formData.isPromo && (
        <div className="p-4 border rounded-lg bg-gray-50 space-y-4">
          <h3 className="font-semibold text-lg">Contenido de la Promo</h3>
          <div className="space-y-2">
            {formData.promoItems && formData.promoItems.map((item) => {
              if (item.tipo === 'grupo') {
                const group = allProductGroups.find(g => g.id === item.grupoId);
                const groupArticleIds = group?.articulos || [];
                const groupArticles = groupArticleIds.map(id => allArticles.find(a => a.id === id)).filter(Boolean);
                const allowedIds = (item.permitidos && item.permitidos.length > 0) ? item.permitidos : groupArticleIds;
                return (
                  <div key={item.uniqueId} className="p-2 bg-white rounded-md shadow-sm space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-grow">
                        <span className="text-[10px] uppercase font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                          Grupo: {group ? group.nombre : '???'}
                        </span>
                        <Input
                          value={item.nombre}
                          onChange={(e) => handlePromoGroupItemNameChange(item.uniqueId, e.target.value)}
                          className="h-8"
                        />
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <Label htmlFor={`qty-${item.uniqueId}`} className="text-sm">Cant:</Label>
                        <Input
                          id={`qty-${item.uniqueId}`}
                          type="number"
                          min="1"
                          value={item.cantidad}
                          onChange={(e) => handlePromoItemQuantityChange(item.uniqueId, e.target.value)}
                          className="w-16 h-8"
                        />
                        <Button variant="ghost" size="icon" onClick={() => handlePromoItemRemove(item.uniqueId)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                    <div className="pl-2">
                      <p className="text-xs text-gray-500 mb-1">Productos que se podrán elegir:</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                        {groupArticles.map(article => (
                          <label key={article.id} className="flex items-center space-x-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={allowedIds.includes(article.id)}
                              onCheckedChange={() => handlePromoGroupItemPermitidoToggle(item.uniqueId, article.id)}
                            />
                            <span>{article.nombre}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={item.uniqueId} className="flex items-center justify-between p-2 bg-white rounded-md shadow-sm">
                  <span className="font-medium">{item.nombre}</span>
                  <div className="flex items-center space-x-2">
                    <Label htmlFor={`qty-${item.uniqueId}`} className="text-sm">Cant:</Label>
                    <Input
                      id={`qty-${item.uniqueId}`}
                      type="number"
                      min="1"
                      value={item.cantidad}
                      onChange={(e) => handlePromoItemQuantityChange(item.uniqueId, e.target.value)}
                      className="w-16 h-8"
                    />
                    <Button variant="ghost" size="icon" onClick={() => handlePromoItemRemove(item.uniqueId)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center space-x-2">
            <Select onValueChange={setSelectedPromoArticle} value={selectedPromoArticle}>
              <SelectTrigger className="flex-grow">
                <SelectValue placeholder="Buscar artículos para agregar..." />
              </SelectTrigger>
              <SelectContent>
                <ScrollArea className="h-[200px] w-full">
                  {availablePromoArticles.map(article => {
                    const department = allDepartments.find(d => d.id === article.departamento);
                    const departmentName = department ? department.nombre : 'Sin Depto.';
                    return (
                      <SelectItem key={article.id} value={article.id}>
                        <span>{article.nombre} - <span className="text-gray-500">{departmentName}</span></span>
                      </SelectItem>
                    );
                  })}
                </ScrollArea>
              </SelectContent>
            </Select>
            <Button type="button" onClick={handlePromoItemAdd} disabled={!selectedPromoArticle}>
              <PlusCircle className="h-5 w-5" />
            </Button>
          </div>

          {allProductGroups.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <Label className="text-sm font-semibold">Agregar grupo de productos a elección</Label>
              <div className="flex items-center space-x-2">
                <Select onValueChange={handlePromoGroupSelect} value={selectedPromoGroup}>
                  <SelectTrigger className="flex-grow">
                    <SelectValue placeholder="Seleccionar grupo de productos..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allProductGroups.map(group => (
                      <SelectItem key={group.id} value={group.id}>{group.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" onClick={handlePromoGroupAdd} disabled={!selectedPromoGroup}>
                  <PlusCircle className="h-5 w-5" />
                </Button>
              </div>
              {selectedPromoGroup && (() => {
                const group = allProductGroups.find(g => g.id === selectedPromoGroup);
                const groupArticleIds = group?.articulos || [];
                const allowedIds = promoGroupPermitidos.length > 0 ? promoGroupPermitidos : groupArticleIds;
                return (
                  <div className="p-2 bg-white rounded-md space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="promoGroupName" className="text-xs">Nombre a mostrar</Label>
                      <Input
                        id="promoGroupName"
                        value={promoGroupName}
                        onChange={(e) => setPromoGroupName(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Productos que se podrán elegir (vacío = todos):</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                        {groupArticleIds.map(artId => {
                          const article = allArticles.find(a => a.id === artId);
                          if (!article) return null;
                          return (
                            <label key={artId} className="flex items-center space-x-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={allowedIds.includes(artId)}
                                onCheckedChange={() => handlePromoGroupPermitidoToggle(artId)}
                              />
                              <span>{article.nombre}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {formData.isPromo ? (
        <StockManagement
          stock={formData.stock || {}}
          onStockChange={onStockChange}
          allArticles={allArticles}
          allRawMaterials={allRawMaterials}
          allDepartments={allDepartments}
          formData={formData}
          isPromo
        />
      ) : (
        <>
          <StockManagement 
            stock={formData.stock || {}} 
            onStockChange={onStockChange} 
            allArticles={allArticles}
            allRawMaterials={allRawMaterials}
            allDepartments={allDepartments}
            formData={formData}
          />
          <OptionalConfig
            opcionalesConfig={formData.opcionalesConfig || {}}
            onOpcionalesConfigChange={onOpcionalesConfigChange}
            allOptionalGroups={allOptionalGroups}
            allOpcionales={sortedOpcionales}
          />
        </>
      )}
    </div>
  );
};

export default ArticleFormFields;
