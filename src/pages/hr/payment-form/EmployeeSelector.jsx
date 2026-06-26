import React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const EmployeeSelector = ({ employeeId, employees, selectedEmployee, error, onChange }) => {
  return (
    <div className="space-y-1">
      <Label htmlFor="employeeId">Empleado*</Label>
      <Select
        value={employeeId}
        onValueChange={onChange}
      >
        <SelectTrigger>
          <SelectValue placeholder="Seleccione un empleado">
            {selectedEmployee ? `${selectedEmployee.nombre} ${selectedEmployee.apellido}` : "Seleccione un empleado"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {employees.map(emp => (
            <SelectItem key={emp.legajo} value={emp.legajo}>{emp.nombre} {emp.apellido}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-red-500 text-xs">{error}</p>}
    </div>
  );
};

export default EmployeeSelector;