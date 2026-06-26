import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { User, Check, Loader2 } from 'lucide-react';
import { fetchVendorsByCategory } from '@/lib/api/hrApi';
import { useToast } from '@/components/ui/use-toast';

const ResponsibleEmployeeModal = ({ isOpen, onClose, onSelect }) => {
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      const loadVendors = async () => {
        setIsLoading(true);
        try {
          const fetchedVendors = await fetchVendorsByCategory();
          setVendors(fetchedVendors);
        } catch (error) {
          console.error("Error loading vendors:", error);
          toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los vendedores.' });
        } finally {
          setIsLoading(false);
        }
      };
      
      loadVendors();
      setSelectedEmployee(null);
    }
  }, [isOpen, toast]);

  const handleSelect = () => {
    if (selectedEmployee) {
      if (selectedEmployee.categoriaNombre?.toUpperCase() === 'VENDEDOR') {
        onSelect(selectedEmployee);
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Seleccionar Responsable</DialogTitle>
          <DialogDescription>Elija el vendedor responsable de la acción.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Command>
            <CommandInput placeholder="Buscar vendedor..." />
            <CommandList>
              <CommandEmpty>No se encontraron vendedores.</CommandEmpty>
              <CommandGroup>
                {vendors.map(employee => {
                  const fullName = `${employee.nombre} ${employee.apellido}`.trim();
                  return (
                    <CommandItem
                      key={employee.legajo}
                      onSelect={() => setSelectedEmployee(employee)}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center">
                        <User className="mr-2 h-4 w-4" />
                        <span>{fullName}</span>
                        <span className="ml-2 text-xs text-muted-foreground bg-gray-100 px-2 py-0.5 rounded-full">
                          {employee.categoriaNombre?.toUpperCase() || 'VENDEDOR'}
                        </span>
                      </div>
                      {selectedEmployee?.legajo === employee.legajo && <Check className="h-4 w-4 text-primary" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSelect} disabled={!selectedEmployee}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ResponsibleEmployeeModal;