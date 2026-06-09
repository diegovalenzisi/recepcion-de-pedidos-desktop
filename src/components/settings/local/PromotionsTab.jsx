import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchPromotions, deletePromotion, savePromotion } from '@/lib/api/promotionsApi';
import { Plus, Trash2, Tag, Loader2, Settings2 } from 'lucide-react';
import ManagePromotionArticlesModal from './ManagePromotionArticlesModal';
import { useToast } from '@/components/ui/use-toast';

const DAYS_OF_WEEK = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export default function PromotionsTab() {
  const [promotions, setPromotions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [newPromoName, setNewPromoName] = useState('');
  const [newPromoDays, setNewPromoDays] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  
  const [isArticlesModalOpen, setIsArticlesModalOpen] = useState(false);
  const [selectedPromo, setSelectedPromo] = useState(null);
  
  const { toast } = useToast();

  const loadPromotions = async () => {
    setIsLoading(true);
    try {
      const data = await fetchPromotions();
      setPromotions(data);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las promociones' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPromotions();
  }, []);

  const handleDayToggle = (day) => {
    setNewPromoDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleCreateEmptyPromotion = async () => {
    if (!newPromoName.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'El nombre es requerido' });
      return;
    }
    if (newPromoDays.length === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Selecciona al menos un día' });
      return;
    }

    setIsCreating(true);
    try {
      await savePromotion({
        name: newPromoName.trim(),
        days: newPromoDays,
        status: 'active',
        articlesActivate: [],
        articlesDeactivate: []
      });
      toast({ title: 'Éxito', description: 'Promoción creada correctamente' });
      setNewPromoName('');
      setNewPromoDays([]);
      loadPromotions();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setIsCreating(false);
    }
  };

  const handleManageArticles = (promo) => {
    setSelectedPromo(promo);
    setIsArticlesModalOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm('¿Estás seguro de que deseas eliminar esta promoción?')) {
      try {
        await deletePromotion(id);
        toast({ title: 'Eliminada', description: 'La promoción ha sido eliminada.' });
        loadPromotions();
      } catch (error) {
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar la promoción.' });
      }
    }
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-sm border-t-4 border-t-blue-500">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <Tag className="w-5 h-5 text-blue-600" />
            Crear Promoción
          </CardTitle>
          <CardDescription>Configura los días para tu nueva promoción.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Nombre de la Promoción</Label>
              <Input
                placeholder="Ej: Lunes de Descuentos"
                value={newPromoName}
                onChange={(e) => setNewPromoName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Días de Aplicación</Label>
              <div className="flex flex-wrap gap-3 mt-2">
                {DAYS_OF_WEEK.map((day) => (
                  <div key={day} className="flex items-center space-x-2">
                    <Checkbox 
                      id={`day-${day}`} 
                      checked={newPromoDays.includes(day)}
                      onCheckedChange={() => handleDayToggle(day)}
                    />
                    <Label htmlFor={`day-${day}`} className="cursor-pointer text-sm">{day}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button 
              onClick={handleCreateEmptyPromotion} 
              disabled={isCreating}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isCreating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Crear Promoción Vacía
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm border-t-4 border-t-purple-500">
        <CardHeader>
          <CardTitle className="text-xl">Promociones Activas</CardTitle>
          <CardDescription>Gestiona tus promociones y sus artículos.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
          ) : promotions.length === 0 ? (
            <div className="text-center p-8 text-gray-500 bg-gray-50 rounded-lg border border-dashed">
              <p>No hay promociones configuradas.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {promotions.map(promo => (
                <Card key={promo.id} className="overflow-hidden border border-gray-200 shadow-sm">
                  <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold text-lg">{promo.name}</h3>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Activa</Badge>
                      </div>
                      
                      <div className="flex flex-wrap gap-1 mb-3">
                        {promo.days?.map(day => (
                          <span key={day} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-md font-medium">
                            {day}
                          </span>
                        ))}
                      </div>

                      <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-md border border-gray-100">
                        <span className="font-semibold block mb-1">Intercambios configurados ({promo.articlesActivate?.length || 0}):</span>
                        {promo.articlesActivate?.length > 0 ? (
                          <p className="text-gray-500 text-xs italic">Se han configurado {promo.articlesActivate.length} artículos para activar/desactivar.</p>
                        ) : (
                          <p className="text-gray-400 text-xs italic">No hay artículos configurados. Haz clic en gestionar.</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 md:w-auto w-full">
                      <Button 
                        variant="outline" 
                        onClick={() => handleManageArticles(promo)} 
                        className="flex-1 md:flex-none gap-2 text-blue-600 border-blue-200 hover:bg-blue-50"
                      >
                        <Settings2 className="w-4 h-4" />
                        Gestionar Artículos
                      </Button>
                      <Button 
                        variant="ghost" 
                        onClick={() => handleDelete(promo.id)} 
                        className="text-red-600 hover:bg-red-50 md:flex-none flex-1"
                      >
                        <Trash2 className="w-4 h-4 mr-2 md:mr-0" />
                        <span className="md:hidden">Eliminar</span>
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <ManagePromotionArticlesModal 
            isOpen={isArticlesModalOpen} 
            onClose={() => setIsArticlesModalOpen(false)} 
            promotion={selectedPromo}
            onSuccess={loadPromotions}
          />
        </CardContent>
      </Card>
    </div>
  );
}