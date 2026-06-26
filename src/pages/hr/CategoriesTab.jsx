import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchCategories, saveCategory, deleteCategory } from '@/lib/api/hrApi';
import { Loader2, PlusCircle, Edit, Trash2, Briefcase } from 'lucide-react';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';

const CategoryFormModal = ({ isOpen, onOpenChange, category, onSave }) => {
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (category) {
      setName(category.nombre || '');
    } else {
      setName('');
    }
    setError('');
  }, [category, isOpen]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setIsSaving(true);
    await onSave({ ...category, nombre: name }, !!category);
    setIsSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? 'Editar Categoría' : 'Nueva Categoría'}</DialogTitle>
          <DialogDescription>Define una categoría para tus empleados.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="name">Nombre de la Categoría</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
            className={error ? 'border-red-500' : ''}
          />
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function CategoriesTab() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingCategory, setEditingCategory] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState(null);
  const { toast } = useToast();

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCategories();
      setCategories(data);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las categorías.' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const handleAdd = () => {
    setEditingCategory(null);
    setIsModalOpen(true);
  };

  const handleEdit = (category) => {
    setEditingCategory(category);
    setIsModalOpen(true);
  };

  const handleDeleteRequest = (category) => {
    setCategoryToDelete(category);
  };

  const confirmDelete = async () => {
    if (!categoryToDelete) return;
    try {
      await deleteCategory(categoryToDelete.id);
      toast({ title: 'Categoría eliminada', description: `La categoría "${categoryToDelete.nombre}" ha sido eliminada.` });
      setCategoryToDelete(null);
      loadCategories();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar la categoría.' });
      setCategoryToDelete(null);
    }
  };

  const handleSave = async (categoryData, isEditing) => {
    try {
      await saveCategory(categoryData, isEditing);
      toast({ title: `Categoría ${isEditing ? 'actualizada' : 'agregada'}`, description: 'Los datos se guardaron correctamente.' });
      loadCategories();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron guardar los datos.' });
    }
  };

  return (
    <>
      <Card className="shadow-xl rounded-xl flex-grow flex flex-col h-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-2xl font-bold">Categorías de Empleados</CardTitle>
          <Button onClick={handleAdd}>
            <PlusCircle className="mr-2 h-4 w-4" /> Nueva Categoría
          </Button>
        </CardHeader>
        <CardContent className="flex-grow overflow-auto p-4">
          {loading ? (
            <div className="flex justify-center items-center h-full"><Loader2 className="h-12 w-12 animate-spin text-orange-500" /></div>
          ) : categories.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <Briefcase size={48} className="mx-auto mb-4" />
              <p>No hay categorías registradas. ¡Crea la primera!</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => (
                  <TableRow key={cat.id}>
                    <TableCell>{cat.id}</TableCell>
                    <TableCell className="font-medium">{cat.nombre}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(cat)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteRequest(cat)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <CategoryFormModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        category={editingCategory}
        onSave={handleSave}
      />
      <ConfirmationDialog
        isOpen={!!categoryToDelete}
        onClose={() => setCategoryToDelete(null)}
        onConfirm={confirmDelete}
        title={`¿Eliminar categoría "${categoryToDelete?.nombre}"?`}
        description="Esta acción no se puede deshacer."
      />
    </>
  );
}

export default CategoriesTab;