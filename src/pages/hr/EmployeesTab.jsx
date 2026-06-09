import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { fetchEmployees, saveEmployee, deleteEmployee, fetchCategories } from '@/lib/api/hrApi';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Users, UserPlus, Edit, Trash2, Search, Phone, Home, Fingerprint, DollarSign, User, Hash, Briefcase, Sun, Moon, Coffee } from 'lucide-react';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';

const EmployeeFormModal = ({ isOpen, onOpenChange, employee, onSave, categories }) => {
  const [formData, setFormData] = useState({
    nombre: '', apellido: '', direccion: '', telefono: '', dni: '',
    valorHora: '', legajo: null, categoriaId: '',
    valorTurnoManana: '', valorTurnoTarde: '', valorTurnoNoche: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (employee) {
      setFormData({
        legajo: employee.legajo || null,
        nombre: employee.nombre || '',
        apellido: employee.apellido || '',
        direccion: employee.direccion || '',
        telefono: employee.telefono || '',
        dni: employee.dni || '',
        valorHora: employee.valorHora || '',
        categoriaId: employee.categoriaId || '',
        valorTurnoManana: employee.valorTurnoManana || '',
        valorTurnoTarde: employee.valorTurnoTarde || '',
        valorTurnoNoche: employee.valorTurnoNoche || '',
      });
    } else {
      setFormData({ 
        legajo: null, nombre: '', apellido: '', direccion: '', telefono: '', dni: '', valorHora: '', categoriaId: '',
        valorTurnoManana: '', valorTurnoTarde: '', valorTurnoNoche: '',
      });
    }
    setErrors({});
  }, [employee, isOpen]);

  const validate = () => {
    const newErrors = {};
    if (!formData.nombre) newErrors.nombre = 'El nombre es obligatorio.';
    if (!formData.apellido) newErrors.apellido = 'El apellido es obligatorio.';
    if (!formData.valorHora || isNaN(formData.valorHora) || parseFloat(formData.valorHora) <= 0) {
      newErrors.valorHora = 'El valor por hora debe ser un número positivo.';
    }
    const checkTurno = (value, name) => {
        if (value && (isNaN(value) || parseFloat(value) < 0)) {
            newErrors[name] = 'Debe ser un número positivo o estar vacío.';
        }
    };
    checkTurno(formData.valorTurnoManana, 'valorTurnoManana');
    checkTurno(formData.valorTurnoTarde, 'valorTurnoTarde');
    checkTurno(formData.valorTurnoNoche, 'valorTurnoNoche');

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    const selectedCategory = categories.find(c => c.id === formData.categoriaId);
    
    // Create the data object to save
    const dataToSave = {
      ...formData,
      valorHora: parseFloat(formData.valorHora),
      valorTurnoManana: formData.valorTurnoManana ? parseFloat(formData.valorTurnoManana) : null,
      valorTurnoTarde: formData.valorTurnoTarde ? parseFloat(formData.valorTurnoTarde) : null,
      valorTurnoNoche: formData.valorTurnoNoche ? parseFloat(formData.valorTurnoNoche) : null,
      categoriaNombre: selectedCategory ? selectedCategory.nombre : '',
      // Explicitly set estado to 'activo' for new employees, or preserve existing status for edits
      estado: employee ? (employee.estado || 'activo') : 'activo'
    };

    await onSave(dataToSave, !!employee);
    setIsSaving(false);
    onOpenChange(false);
  };

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
    if (errors[id]) {
      const newErrors = { ...errors };
      delete newErrors[id];
      setErrors(newErrors);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{employee ? 'Editar Empleado' : 'Nuevo Empleado'}</DialogTitle>
          <DialogDescription>Completa los datos del personal. Los campos con * son obligatorios.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-4">
            <div className="border p-4 rounded-lg space-y-4">
                <h3 className="text-lg font-semibold mb-2">Datos Personales</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="legajo">Legajo</Label>
                        <Input id="legajo" value={formData.legajo || 'Automático'} disabled />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="dni">DNI</Label>
                        <Input id="dni" value={formData.dni} onChange={handleChange} />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="nombre">Nombre*</Label>
                        <Input id="nombre" value={formData.nombre} onChange={handleChange} />
                        {errors.nombre && <p className="text-red-500 text-xs">{errors.nombre}</p>}
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="apellido">Apellido*</Label>
                        <Input id="apellido" value={formData.apellido} onChange={handleChange} />
                        {errors.apellido && <p className="text-red-500 text-xs">{errors.apellido}</p>}
                    </div>
                    <div className="space-y-1 col-span-2">
                        <Label htmlFor="direccion">Dirección</Label>
                        <Input id="direccion" value={formData.direccion} onChange={handleChange} />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="telefono">Teléfono</Label>
                        <Input id="telefono" value={formData.telefono} onChange={handleChange} />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="categoriaId">Categoría</Label>
                        <Select onValueChange={(value) => setFormData(prev => ({...prev, categoriaId: value}))} value={formData.categoriaId}>
                            <SelectTrigger><SelectValue placeholder="Seleccionar categoría" /></SelectTrigger>
                            <SelectContent>{categories.map(cat => (<SelectItem key={cat.id} value={cat.id}>{cat.nombre}</SelectItem>))}</SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            <div className="border p-4 rounded-lg space-y-4">
                <h3 className="text-lg font-semibold mb-2">Definición de Pagos</h3>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="valorHora">Valor por Hora*</Label>
                        <Input id="valorHora" type="number" value={formData.valorHora} onChange={handleChange} placeholder="Ej: 1500.50" />
                        {errors.valorHora && <p className="text-red-500 text-xs">{errors.valorHora}</p>}
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="valorTurnoManana">Valor Turno Mañana</Label>
                        <Input id="valorTurnoManana" type="number" value={formData.valorTurnoManana} onChange={handleChange} placeholder="Ej: 8000" />
                        {errors.valorTurnoManana && <p className="text-red-500 text-xs">{errors.valorTurnoManana}</p>}
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="valorTurnoTarde">Valor Turno Tarde</Label>
                        <Input id="valorTurnoTarde" type="number" value={formData.valorTurnoTarde} onChange={handleChange} placeholder="Ej: 8500" />
                        {errors.valorTurnoTarde && <p className="text-red-500 text-xs">{errors.valorTurnoTarde}</p>}
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="valorTurnoNoche">Valor Turno Noche</Label>
                        <Input id="valorTurnoNoche" type="number" value={formData.valorTurnoNoche} onChange={handleChange} placeholder="Ej: 9000" />
                        {errors.valorTurnoNoche && <p className="text-red-500 text-xs">{errors.valorTurnoNoche}</p>}
                    </div>
                </div>
            </div>
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

function EmployeesTab() {
  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState(null);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [employeesData, categoriesData] = await Promise.all([
        fetchEmployees(),
        fetchCategories()
      ]);
      setEmployees(employeesData);
      setCategories(categoriesData);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos.' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAdd = () => {
    setEditingEmployee(null);
    setIsModalOpen(true);
  };

  const handleEdit = (employee) => {
    setEditingEmployee(employee);
    setIsModalOpen(true);
  };

  const handleDeleteRequest = (employee) => {
    setEmployeeToDelete(employee);
  };

  const confirmDelete = async () => {
    if (!employeeToDelete) return;
    try {
      await deleteEmployee(employeeToDelete.legajo);
      toast({ title: 'Empleado eliminado', description: `${employeeToDelete.nombre} ${employeeToDelete.apellido} ha sido eliminado.` });
      setEmployeeToDelete(null);
      loadData();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar el empleado.' });
      setEmployeeToDelete(null);
    }
  };

  const handleSave = async (employeeData, isEditing) => {
    try {
      await saveEmployee(employeeData, isEditing);
      toast({ title: `Empleado ${isEditing ? 'actualizado' : 'agregado'}`, description: 'Los datos se guardaron correctamente.' });
      loadData();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron guardar los datos.' });
    }
  };

  const filteredEmployees = employees.filter(
    (e) =>
      (e.nombre && e.nombre.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.apellido && e.apellido.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.dni && e.dni.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.legajo && e.legajo.toString().includes(searchTerm))
  );

  return (
    <>
      <Card className="shadow-xl rounded-xl flex-grow flex flex-col h-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-2xl font-bold">Lista de Empleados</CardTitle>
          <div className="flex items-center space-x-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <Input
                placeholder="Buscar empleado..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button onClick={handleAdd}>
              <UserPlus className="mr-2 h-4 w-4" /> Nuevo Empleado
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-grow overflow-auto p-4">
          {loading ? (
            <div className="flex justify-center items-center h-full"><Loader2 className="h-12 w-12 animate-spin text-orange-500" /></div>
          ) : filteredEmployees.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <Users size={48} className="mx-auto mb-4" />
              <p>No hay empleados registrados.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <AnimatePresence>
                {filteredEmployees.map((e, index) => (
                  <motion.div
                    key={e.legajo}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                  >
                    <div className="bg-white rounded-lg shadow-md p-4 flex flex-col h-full border hover:shadow-lg transition-shadow">
                      <div className="flex items-center mb-3">
                        <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center mr-4">
                          <User className="w-6 h-6 text-orange-500" />
                        </div>
                        <div>
                          <h3 className="font-bold text-lg text-gray-800">{e.nombre} {e.apellido}</h3>
                          <p className="text-sm text-gray-500 flex items-center"><Hash size={12} className="mr-1" /> Legajo: {e.legajo}</p>
                        </div>
                      </div>
                      <div className="space-y-2 text-sm text-gray-700 flex-grow">
                        <p className="flex items-center"><Briefcase size={14} className="mr-2 text-gray-400" /> {e.categoriaNombre || 'Sin categoría'}</p>
                        <p className="flex items-center"><Fingerprint size={14} className="mr-2 text-gray-400" /> DNI: {e.dni || 'N/A'}</p>
                        <p className="flex items-center"><Home size={14} className="mr-2 text-gray-400" /> {e.direccion || 'N/A'}</p>
                        <p className="flex items-center"><Phone size={14} className="mr-2 text-gray-400" /> {e.telefono || 'N/A'}</p>
                        <p className="flex items-center font-semibold"><DollarSign size={14} className="mr-2 text-gray-400" /> ${parseFloat(e.valorHora || 0).toFixed(2)} / hora</p>
                         <div className="border-t mt-2 pt-2 space-y-1">
                          { (e.valorTurnoManana || e.valorTurnoTarde || e.valorTurnoNoche) ? (
                            <>
                              {e.valorTurnoManana > 0 && <p className="flex items-center text-xs"><Sun size={12} className="mr-2 text-yellow-500" /> T. Mañana: ${parseFloat(e.valorTurnoManana).toFixed(2)}</p>}
                              {e.valorTurnoTarde > 0 && <p className="flex items-center text-xs"><Coffee size={12} className="mr-2 text-orange-500" /> T. Tarde: ${parseFloat(e.valorTurnoTarde).toFixed(2)}</p>}
                              {e.valorTurnoNoche > 0 && <p className="flex items-center text-xs"><Moon size={12} className="mr-2 text-blue-500" /> T. Noche: ${parseFloat(e.valorTurnoNoche).toFixed(2)}</p>}
                            </>
                          ) : (
                             <p className="text-xs text-gray-400 italic">Sin valores de turno definidos.</p>
                          )
                        }
                        </div>
                      </div>
                      <div className="mt-4 pt-3 border-t flex justify-end space-x-2">
                        <Button variant="outline" size="sm" onClick={() => handleEdit(e)}>
                          <Edit className="h-4 w-4 mr-1" /> Editar
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDeleteRequest(e)}>
                          <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>
      <EmployeeFormModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        employee={editingEmployee}
        onSave={handleSave}
        categories={categories}
      />
      <ConfirmationDialog
        isOpen={!!employeeToDelete}
        onClose={() => setEmployeeToDelete(null)}
        onConfirm={confirmDelete}
        title={`¿Eliminar a ${employeeToDelete?.nombre} ${employeeToDelete?.apellido}?`}
        description="Esta acción eliminará permanentemente al empleado del sistema."
      />
    </>
  );
}

export default EmployeesTab;