import React, { createContext, useState, useContext, useEffect, useCallback, useMemo } from 'react';
import { fetchUsers } from '@/lib/api/usersApi';
import { useToast } from '@/components/ui/use-toast';
import { permissionsList } from '@/config/permissions';
import { clearLocalId } from '@/lib/firebase/core';
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext(null);

const getAllPermissions = () => {
    return permissionsList.reduce((acc, group) => {
        (group.items || []).forEach(item => {
            acc[item.id] = true;
        });
        if(group.id) {
           acc[group.id] = true;
        }
        return acc;
    }, {});
};

const adminUser = {
    id: import.meta.env.VITE_ADMIN_USER || 'DiegoL',
    nombre: 'Diego L.',
    usuario: import.meta.env.VITE_ADMIN_USER || 'DiegoL',
    rol: 'dueño',
    contrasena: import.meta.env.VITE_ADMIN_PASS || '2908',
    permissions: getAllPermissions(),
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  const verifyUserSession = useCallback(() => {
    const storedUser = sessionStorage.getItem('currentUser');
    if (storedUser) {
        try {
            let parsedUser = JSON.parse(storedUser);
            if (parsedUser.usuario === adminUser.usuario) {
                parsedUser = { ...adminUser, ...parsedUser };
            }
            setUser(parsedUser);
        } catch {
            sessionStorage.removeItem('currentUser');
        }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    verifyUserSession();
  }, [verifyUserSession]);

  const login = useCallback(async (username, password) => {
    if (username === adminUser.usuario && password === adminUser.contrasena) {
        const userToStore = { ...adminUser };
        setUser(userToStore);
        sessionStorage.setItem('currentUser', JSON.stringify(userToStore));
        toast({ title: '¡Bienvenido!', description: `Inicio de sesión exitoso para ${adminUser.nombre}.` });
        navigate('/', { replace: true });
        return true;
    }

    try {
      const usersFromDb = await fetchUsers();
      const foundUser = usersFromDb.find(u => u.usuario === username && u.contrasena === password);
      
      if (foundUser) {
        setUser(foundUser);
        sessionStorage.setItem('currentUser', JSON.stringify(foundUser));
        toast({ title: '¡Bienvenido!', description: `Inicio de sesión exitoso para ${foundUser.nombre}.` });
        navigate('/', { replace: true });
        return true;
      } else {
        toast({ variant: 'destructive', title: 'Error de acceso', description: 'Usuario o contraseña incorrectos.' });
        return false;
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error del sistema', description: 'No se pudo conectar con la base de datos.' });
      return false;
    }
  }, [navigate, toast]);

  const logout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('currentUser');
    toast({ title: 'Sesión cerrada', description: 'Has salido del sistema de forma segura.' });
    navigate('/login', { replace: true });
  }, [navigate, toast]);

  const changeLocalId = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('currentUser');
    clearLocalId();
  }, []);

  const value = useMemo(() => ({ 
    user, 
    loading, 
    login, 
    logout, 
    changeLocalId 
  }), [user, loading, login, logout, changeLocalId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  return useContext(AuthContext);
};