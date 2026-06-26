import React from 'react';

const DepartmentList = ({ departments, selectedDepartment, onSelectDepartment }) => {
  return (
    <div className="col-span-2 bg-slate-50 rounded-lg p-2 overflow-y-auto">
      <h2 className="text-lg font-semibold mb-3 text-slate-700 px-2">Departamentos</h2>
      <nav className="flex flex-col space-y-1">
        {departments.map(dep => (
          <button
            key={dep.id}
            onClick={() => onSelectDepartment(dep.id)}
            className={`w-full text-left px-3 py-2 rounded-md font-medium text-sm transition-all ${
              selectedDepartment === dep.id
                ? 'bg-orange-500 text-white shadow'
                : 'text-slate-600 hover:bg-orange-100'
            }`}
          >
            {dep.nombre}
          </button>
        ))}
      </nav>
    </div>
  );
};

export default DepartmentList;