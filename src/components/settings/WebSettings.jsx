import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Save, Clock, MessageSquare, Truck, ListPlus, Facebook, Instagram, Signpost, Star, Image as ImageIcon, UploadCloud, Trash2, Store, Globe } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import HoursSettingsModal from '@/components/settings/HoursSettingsModal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { uploadWebImage, deleteWebImage } from '@/lib/firebase/storage';
import { DEFAULT_WHATSAPP_MESSAGE, DEFAULT_WHATSAPP_MESSAGE_EFECTIVO } from '@/lib/whatsapp/paymentMessage';

// Helper for image compression
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_WIDTH = 1280;
        const MAX_HEIGHT = 720;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Canvas is empty'));
            return;
          }
          const newFile = new File([blob], "compressed.jpg", {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(newFile);
        }, 'image/jpeg', 0.8);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

function WebSettings({ settings, onSettingsChange, onSave, saving }) {
  const [isHoursModalOpen, setIsHoursModalOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef(null);
  const { toast } = useToast();

  const handleChange = (e) => {
    const { id, value } = e.target;
    onSettingsChange(prev => ({ 
        ...prev, 
        web: {
            ...prev.web,
            [id]: value
        }
    }));
  };
  
  const handleSwitchChange = (id, checked) => {
    onSettingsChange(prev => ({
        ...prev,
        web: {
            ...prev.web,
            [id]: checked
        }
    }));
  };

  const handleRootSwitchChange = (id, checked) => {
    onSettingsChange(prev => ({
        ...prev,
        [id]: checked
    }));
  };

  const handleHoursChange = (newHours) => {
    onSettingsChange(prev => ({
        ...prev,
        web: {
            ...prev.web,
            horarios: newHours
        }
    }));
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        toast({ variant: "destructive", title: "Archivo inválido", description: "Por favor seleccione una imagen." });
        return;
    }

    try {
        setUploadingImage(true);
        
        const compressedFile = await compressImage(file);
        
        // Attempt to delete old image if it exists
        if (settings.web?.featuredImage) {
            try {
                await deleteWebImage(settings.web.featuredImage);
            } catch (err) {
                console.warn("Failed to delete old image:", err);
            }
        }

        const url = await uploadWebImage(compressedFile);

        onSettingsChange(prev => ({
            ...prev,
            web: {
                ...prev.web,
                featuredImage: url
            }
        }));

        toast({ title: "Imagen actualizada", description: "La imagen destacada se ha subido correctamente." });
    } catch (error) {
        console.error("Upload error:", error);
        toast({ variant: "destructive", title: "Error", description: "No se pudo subir la imagen." });
    } finally {
        setUploadingImage(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = async () => {
    if (settings.web?.featuredImage) {
         try {
            await deleteWebImage(settings.web.featuredImage);
        } catch (err) {
            console.warn("Failed to delete image from storage:", err);
        }
    }

    onSettingsChange(prev => ({
        ...prev,
        web: {
            ...prev.web,
            featuredImage: null
        }
    }));
    
    toast({ title: "Imagen eliminada", description: "La imagen destacada ha sido eliminada." });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="h-full"
      >
        <Card className="shadow-2xl overflow-hidden mt-6 flex flex-col h-full">
          <CardHeader className="bg-gradient-to-r from-cyan-800 to-cyan-700 text-white p-6 flex-shrink-0">
            <CardTitle className="text-3xl font-bold">Configuración Web</CardTitle>
            <CardDescription className="text-cyan-200">Gestiona los horarios, enlaces y mensajes para la web y delivery.</CardDescription>
          </CardHeader>
          <ScrollArea className="flex-grow">
            <CardContent className="p-8 space-y-8">
              
              <div className="space-y-4">
                  <h3 className="text-xl font-bold text-gray-800 mb-4">Enlaces Principales</h3>
                  <div className="space-y-2">
                      <Label htmlFor="webOrderUrl" className="flex items-center text-gray-700 font-semibold">
                          <Globe className="mr-2 h-5 w-5 text-cyan-500" />
                          Dirección Web de Pedidos (URL)
                      </Label>
                      <Input
                          id="webOrderUrl"
                          value={settings.web?.webOrderUrl || ''}
                          onChange={handleChange}
                          placeholder="https://tulocal.pedidos.web"
                          className="bg-gray-50"
                      />
                      <p className="text-xs text-gray-500 ml-7 mt-1">
                          El enlace principal donde tus clientes pueden realizar pedidos o ver el menú online.
                      </p>
                  </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                  <Label className="flex items-center text-gray-700 font-semibold">
                      <Clock className="mr-2 h-5 w-5 text-cyan-500" />
                      Horarios de Atención
                  </Label>
                  <Button variant="outline" onClick={() => setIsHoursModalOpen(true)}>
                      Configurar horarios de atención
                  </Button>
              </div>

              <div className="space-y-4 pt-4 border-t">
                  <Label className="flex items-center text-gray-700 font-semibold">
                      <ImageIcon className="mr-2 h-5 w-5 text-cyan-500" />
                      Imagen Destacada
                  </Label>
                  
                  <div className="flex flex-col gap-4">
                      {settings.web?.featuredImage ? (
                          <div className="relative w-full max-w-md aspect-video rounded-lg overflow-hidden border border-gray-200 shadow-sm group">
                              <img 
                                src={settings.web.featuredImage} 
                                alt="Imagen destacada" 
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Button variant="destructive" size="sm" onClick={handleRemoveImage}>
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Eliminar
                                  </Button>
                              </div>
                          </div>
                      ) : (
                          <div className="w-full max-w-md aspect-video rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 bg-gray-50">
                              <ImageIcon className="h-10 w-10 mb-2 opacity-50" />
                              <span className="text-sm">Sin imagen destacada</span>
                          </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                          <input 
                              type="file" 
                              ref={fileInputRef} 
                              className="hidden" 
                              accept="image/*" 
                              onChange={handleImageUpload}
                          />
                          <Button 
                              variant="outline" 
                              onClick={() => fileInputRef.current?.click()}
                              disabled={uploadingImage}
                          >
                              {uploadingImage ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : (
                                  <UploadCloud className="h-4 w-4 mr-2" />
                              )}
                              {uploadingImage ? 'Procesando...' : (settings.web?.featuredImage ? 'Cambiar Imagen' : 'Subir Imagen')}
                          </Button>

                          {settings.web?.featuredImage && (
                            <Button 
                                variant="destructive" 
                                onClick={handleRemoveImage}
                                disabled={uploadingImage}
                            >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Eliminar Imagen
                            </Button>
                          )}
                          
                          {!settings.web?.featuredImage && (
                            <p className="text-xs text-gray-500">
                                La imagen se comprimirá automáticamente antes de subir.
                            </p>
                          )}
                      </div>
                  </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                  <Label htmlFor="destacar" className="flex items-center text-gray-700 font-semibold">
                      <Star className="mr-2 h-5 w-5 text-yellow-500" />
                      Destacar
                  </Label>
                  <Textarea
                      id="destacar"
                      value={settings.web?.destacar || ''}
                      onChange={handleChange}
                      placeholder="Escribe un mensaje para destacar en la web..."
                      className="bg-gray-50 text-center"
                      rows={2}
                  />
                  <p className="text-xs text-gray-500 ml-7 mt-1">Este texto aparecerá resaltado en la parte superior de la web.</p>
              </div>

              <div className="pt-4 border-t">
                  <div className="flex items-center space-x-2">
                    <ListPlus className="h-5 w-5 text-cyan-500" />
                    <Label htmlFor="showOptionalsInDelivery" className="text-gray-700 font-semibold">Mostrar Opcionales en Delivery</Label>
                    <Switch
                        id="showOptionalsInDelivery"
                        checked={!!settings.web?.showOptionalsInDelivery}
                        onCheckedChange={(checked) => handleSwitchChange('showOptionalsInDelivery', checked)}
                    />
                  </div>
                  <p className="text-xs text-gray-500 ml-7 mt-1">Si está activado, al seleccionar un artículo con opcionales se abrirá la ventana de selección. Si no, se añadirá directamente.</p>
              </div>

              <div className="pt-4 border-t">
                  <div className="flex items-center space-x-2">
                    <Store className="h-5 w-5 text-cyan-500" />
                    <Label htmlFor="showOptionalsInCounter" className="text-gray-700 font-semibold">Mostrar Opcionales en Mostrador</Label>
                    <Switch
                        id="showOptionalsInCounter"
                        checked={settings.showOptionalsInCounter !== false}
                        onCheckedChange={(checked) => handleRootSwitchChange('showOptionalsInCounter', checked)}
                    />
                  </div>
                  <p className="text-xs text-gray-500 ml-7 mt-1">Si está activado, al seleccionar un artículo con opcionales en mostrador se abrirá la ventana de selección. Si no, se añadirá directamente.</p>
              </div>

              <div className="pt-4 border-t">
                  <div className="flex items-center space-x-2">
                    <Signpost className="h-5 w-5 text-cyan-500" />
                    <Label htmlFor="requireCrossStreets" className="text-gray-700 font-semibold">Entrecalles Obligatorio</Label>
                    <Switch
                        id="requireCrossStreets"
                        checked={!!settings.web?.requireCrossStreets}
                        onCheckedChange={(checked) => handleSwitchChange('requireCrossStreets', checked)}
                    />
                  </div>
                  <p className="text-xs text-gray-500 ml-7 mt-1">Si está activado, será obligatorio ingresar las entrecalles para los pedidos de delivery.</p>
              </div>
              
              <div className="pt-4 border-t">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Redes Sociales</h3>
                 <div className="grid md:grid-cols-2 gap-8">
                    <div className="space-y-2">
                        <Label htmlFor="facebookUrl" className="flex items-center text-gray-700 font-semibold">
                            <Facebook className="mr-2 h-5 w-5 text-blue-600" />
                            URL de Facebook
                        </Label>
                        <Input
                            id="facebookUrl"
                            value={settings.web?.facebookUrl || ''}
                            onChange={handleChange}
                            placeholder="https://facebook.com/tu-pagina"
                            className="bg-gray-50"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="instagramUrl" className="flex items-center text-gray-700 font-semibold">
                            <Instagram className="mr-2 h-5 w-5 text-pink-500" />
                            URL de Instagram
                        </Label>
                        <Input
                            id="instagramUrl"
                            value={settings.web?.instagramUrl || ''}
                            onChange={handleChange}
                            placeholder="https://instagram.com/tu-usuario"
                            className="bg-gray-50"
                        />
                    </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Mensajes Predeterminados</h3>
                <div className="grid md:grid-cols-1 gap-8">
                    <div className="space-y-2">
                        <Label htmlFor="whatsappMessage" className="flex items-center text-gray-700 font-semibold">
                            <MessageSquare className="mr-2 h-5 w-5 text-cyan-500" />
                            Mensaje WhatsApp para pagos electrónicos
                        </Label>
                        <Textarea
                            id="whatsappMessage"
                            value={settings.web?.whatsappMessage || ''}
                            onChange={handleChange}
                            placeholder={DEFAULT_WHATSAPP_MESSAGE}
                            className="bg-gray-50"
                            rows={5}
                        />
                        <p className="text-xs text-gray-500">
                            Se usa cuando el pedido se paga con Transferencia, Mercado Pago, tarjeta, QR u otro medio electrónico.
                            Variables disponibles: {'{cliente}'}, {'{numero}'}, {'{total}'}, {'{aliasFavorita}'}, {'{titularCuenta}'}.
                            Si se deja vacío, se usa el mensaje predeterminado actual.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="whatsappMessageEfectivo" className="flex items-center text-gray-700 font-semibold">
                            <MessageSquare className="mr-2 h-5 w-5 text-cyan-500" />
                            Mensaje WhatsApp para pagos en efectivo
                        </Label>
                        <Textarea
                            id="whatsappMessageEfectivo"
                            value={settings.web?.whatsappMessageEfectivo || ''}
                            onChange={handleChange}
                            placeholder={DEFAULT_WHATSAPP_MESSAGE_EFECTIVO}
                            className="bg-gray-50"
                            rows={3}
                        />
                        <p className="text-xs text-gray-500">
                            Se usa cuando el pedido se paga en efectivo. Variables disponibles: {'{cliente}'}, {'{numero}'}.
                            Si se deja vacío, se usa el mensaje predeterminado actual.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="assignDelivererMessage" className="flex items-center text-gray-700 font-semibold">
                            <Truck className="mr-2 h-5 w-5 text-cyan-500" />
                            Mensaje al Asignar Repartidor
                        </Label>
                        <Textarea
                            id="assignDelivererMessage"
                            value={settings.web?.assignDelivererMessage || ''}
                            onChange={handleChange}
                            placeholder="Ej: Hola *{cliente}*, tu pedido #{numero} salió con *{repartidor}*."
                            className="bg-gray-50"
                            rows={4}
                        />
                         <p className="text-xs text-gray-500">Mensaje que se envía al cliente cuando se asigna repartidor o el pedido pasa a EN DELIVERY. Variables disponibles: {'{cliente}'}, {'{numero}'}, {'{total}'}, {'{repartidor}'}, {'{direccion}'}.</p>
                    </div>
                </div>
              </div>

            </CardContent>
          </ScrollArea>
          <CardFooter className="bg-gray-100 p-6 flex justify-end flex-shrink-0">
            <Button onClick={onSave} disabled={saving} className="w-40 h-12 text-lg font-bold bg-cyan-500 hover:bg-cyan-600">
              {saving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </CardFooter>
        </Card>
      </motion.div>
      <HoursSettingsModal 
        isOpen={isHoursModalOpen} 
        onOpenChange={setIsHoursModalOpen}
        initialHours={settings.web?.horarios}
        onSave={handleHoursChange}
      />
    </>
  );
}

export default WebSettings;