import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, Search, Loader2, Edit, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { fetchUsers, saveUser, deleteUser } from '@/lib/api/usersApi';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { permissionsList } from '@/config/permissions';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmationDialog from '@/components/management/ConfirmationDialog';
import { useAuth } from '@/hooks/useAuth';


const UserForm = ({ onSave, onFinished, existingUser }) => {
    const [nombre, setNombre] = useState(existingUser?.nombre || '');
    const [usuario, setUsuario] = useState(existingUser?.usuario || '');
    const [contrasena, setContrasena] = useState('');
    const [rol, setRol] = useState(existingUser?.rol || 'empleado');
    const [permissions, setPermissions] = useState(existingUser?.permissions || {});
    const { toast } = useToast();
    const isEditingAdmin = existingUser?.usuario === 'DiegoL';

    const handlePermissionChange = (permId) => {
        setPermissions(prev => ({ ...prev, [permId]: !prev[permId] }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!nombre || !usuario) {
            toast({ variant: 'destructive', title: 'Error', description: 'Nombre y usuario son obligatorios.' });
            return;
        }
        if (!existingUser && !contrasena) {
            toast({ variant: 'destructive', title: 'Error', description: 'La contraseña es obligatoria para nuevos usuarios.' });
            return;
        }
        
        const userData = {
            nombre,
            usuario,
            rol,
            permissions,
        };

        if (contrasena) {
            userData.contrasena = contrasena;
        }

        await onSave(userData, !!existingUser);
        onFinished();
    };

    return (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-4">
                <Input placeholder="Nombre Completo" value={nombre} onChange={e => setNombre(e.target.value)} />
                <Input placeholder="Nombre de Usuario" value={usuario} onChange={e => setUsuario(e.target.value)} disabled={!!existingUser} />
                <Input type="password" placeholder={existingUser ? "Nueva Contraseña (opcional)" : "Contraseña"} value={contrasena} onChange={e => setContrasena(e.target.value)} />
                
                <div className="space-y-2">
                    <Label htmlFor="rol">Rol</Label>
                    <Select value={rol} onValueChange={setRol} disabled={isEditingAdmin}>
                        <SelectTrigger id="rol">
                            <SelectValue placeholder="Seleccionar Rol" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="empleado">Empleado</SelectItem>
                            <SelectItem value="encargado">Encargado</SelectItem>
                            <SelectItem value="dueño">Dueño</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="md:col-span-2 space-y-2">
                <h3 className="font-medium">Permisos</h3>
                {isEditingAdmin ? (
                     <div className="text-center p-4 bg-gray-100 rounded-md">
                        <p className="font-semibold text-gray-700">El usuario administrador tiene todos los permisos.</p>
                        <p className="text-sm text-gray-500">Los permisos no se pueden modificar.</p>
                     </div>
                ) : (
                    <ScrollArea className="h-60 w-full rounded-md border p-4">
                        <div className="grid grid-cols-2 gap-4">
                            {permissionsList.map(group => (
                                <div key={group.id} className="space-y-2">
                                    <h4 className="font-semibold text-sm capitalize">{group.group}</h4>
                                    {group.items.map(item => (
                                        <div key={item.id} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={item.id}
                                                checked={!!permissions[item.id]}
                                                onCheckedChange={() => handlePermissionChange(item.id)}
                                            />
                                            <Label htmlFor={item.id} className="text-sm font-normal">{item.label}</Label>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                )}
            </div>

            <div className="md:col-span-3">
                <Button type="submit" className="w-full">Guardar Usuario</Button>
            </div>
        </form>
    );
};


const UsersPage = () => {
    const [users, setUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [userToDelete, setUserToDelete] = useState(null);
    const { toast } = useToast();
    const { user: currentUser } = useAuth();

    const loadUsers = useCallback(async () => {
        setIsLoading(true);
        try {
            const fetchedUsers = await fetchUsers();
            setUsers(fetchedUsers);
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los usuarios.' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    const handleSaveUser = async (userData, isUpdate) => {
        setIsLoading(true);
        try {
            await saveUser(userData, isUpdate);
            toast({ title: 'Éxito', description: 'Usuario guardado correctamente.' });
            loadUsers();
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: `No se pudo guardar el usuario: ${error.message}` });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteRequest = (user) => {
        setUserToDelete(user);
    };

    const confirmDelete = async () => {
        if (!userToDelete) return;
        setIsLoading(true);
        try {
            await deleteUser(userToDelete.id);
            toast({ title: 'Éxito', description: `Usuario "${userToDelete.nombre}" eliminado correctamente.` });
            await loadUsers();
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: `No se pudo eliminar el usuario: ${error.message}` });
        } finally {
            setIsLoading(false);
            setUserToDelete(null);
        }
    };

    const openForm = (user = null) => {
        setEditingUser(user);
        setIsFormOpen(true);
    };

    const closeForm = () => {
        setEditingUser(null);
        setIsFormOpen(false);
    };
    
    const getRolDisplayName = (rol) => {
        switch(rol) {
            case 'dueño': return 'Dueño';
            case 'encargado': return 'Encargado';
            case 'empleado': return 'Empleado';
            default: return 'No asignado';
        }
    }

    const filteredUsers = users.filter(user =>
        user.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.usuario.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 bg-white rounded-xl shadow-xl h-full flex flex-col"
        >
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800">Gestión de Usuarios</h1>
                <Button className="flex items-center space-x-2" onClick={() => openForm()}>
                    <UserPlus size={20} />
                    <span>Agregar Usuario</span>
                </Button>
            </div>

            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogContent onInteractOutside={(e) => e.preventDefault()} className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>{editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}</DialogTitle>
                    </DialogHeader>
                    <UserForm onSave={handleSaveUser} onFinished={closeForm} existingUser={editingUser} />
                </DialogContent>
            </Dialog>

            <ConfirmationDialog
                isOpen={!!userToDelete}
                onClose={() => setUserToDelete(null)}
                onConfirm={confirmDelete}
                title={`¿Eliminar usuario "${userToDelete?.nombre}"?`}
                description="Esta acción eliminará permanentemente al usuario y sus permisos. No se puede deshacer."
            />

            <div className="relative mb-6">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <Input
                    type="text"
                    placeholder="Buscar por nombre o usuario..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                />
            </div>
            
            <div className="flex-grow overflow-auto relative">
                <AnimatePresence>
                    {isLoading && !isFormOpen && (
                        <motion.div
                            className="absolute inset-0 bg-white/70 flex items-center justify-center z-10"
                        >
                            <Loader2 className="w-12 h-12 text-orange-500 animate-spin" />
                        </motion.div>
                    )}
                </AnimatePresence>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredUsers.map((user, index) => (
                        <motion.div
                            key={user.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                        >
                            <Card className="flex flex-col h-full">
                                <CardHeader>
                                    <CardTitle className="text-lg">{user.nombre}</CardTitle>
                                    <p className="text-sm text-gray-500">{getRolDisplayName(user.rol)}</p>
                                </CardHeader>
                                <CardContent className="flex-grow">
                                    <p className="text-sm text-gray-600">Usuario: {user.usuario}</p>
                                </CardContent>
                                <CardFooter className="flex justify-between gap-2">
                                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openForm(user)}>
                                        <Edit className="mr-2 h-4 w-4" /> 
                                        {user.usuario === 'DiegoL' ? 'Ver Usuario' : 'Editar'}
                                    </Button>
                                    {user.usuario !== 'DiegoL' && (
                                        <Button 
                                            variant="destructive" 
                                            size="sm" 
                                            className="px-3"
                                            onClick={() => handleDeleteRequest(user)}
                                            disabled={currentUser?.usuario === user.usuario}
                                            title={currentUser?.usuario === user.usuario ? "No puedes eliminar tu propio usuario" : "Eliminar usuario"}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </CardFooter>
                            </Card>
                        </motion.div>
                    ))}
                </div>
                {filteredUsers.length === 0 && !isLoading && (
                    <div className="text-center py-12 text-gray-500">
                        <p>No se encontraron usuarios.</p>
                    </div>
                )}
            </div>
        </motion.div>
    );
};

export default UsersPage;