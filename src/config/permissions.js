export const permissionsList = [
    {
        id: 'atencion',
        group: 'Atención',
        navPath: '/atencion',
        items: [
            { id: 'atencion', label: 'Acceso General' },
            { id: 'delivery', label: 'Delivery' },
            { id: 'mostrador', label: 'Mostrador' },
            { id: 'clientes', label: 'Clientes' },
            { id: 'repartidor', label: 'Repartidor' },
            { id: 'reportes', label: 'Reportes' },
        ]
    },
    {
        id: 'stock',
        group: 'Stock',
        navPath: '/stock',
        items: [
            { id: 'stock', label: 'Acceso General' },
            { id: 'articulos', label: 'Artículos' },
            { id: 'materiaPrima', label: 'Materia Prima' },
            { id: 'gruposOpcionales', label: 'Grupos Opcionales' },
            { id: 'gruposProductos', label: 'Grupos de Productos' },
            { id: 'opcionales', label: 'Opcionales' },
            { id: 'departamentos', label: 'Departamentos' },
            { id: 'tachos', label: 'Tachos (Acceso)' },
            { id: 'tachos_modificar_stock', label: 'Tachos (Modificar Stock)' },
        ]
    },
    {
        id: 'cuentas',
        group: 'Cuentas',
        navPath: '/cuentas',
        items: [{ id: 'cuentas', label: 'Acceso General' }]
    },
    {
        id: 'cajas',
        group: 'Cajas',
        navPath: '/cajas',
        items: [
            { id: 'cajas', label: 'Acceso General (Ver todo)' },
            { id: 'cajas_gestionar_fondo', label: 'Gestionar Fondo' },
            { id: 'cajas_cerrar_turno', label: 'Cerrar Turno' }
        ]
    },
    {
        id: 'gastos',
        group: 'Gastos',
        navPath: '/gastos',
        items: [
            { id: 'gastos', label: 'Acceso General' },
            { id: 'gastos_pagos_empleados', label: 'Pagos a Empleados' },
            { id: 'gastos_registrar_gasto', label: 'Registrar Gasto General' }
        ]
    },
    {
        id: 'ventas',
        group: 'Ventas',
        navPath: '/ventas',
        items: [
            { id: 'ventas_facturacion', label: 'Ver Facturación' },
            { id: 'ventas_remitos', label: 'Ver Remitos' }
        ]
    },
    {
        id: 'rrhh',
        group: 'RRHH',
        navPath: '/rrhh',
        items: [
            { id: 'rrhh', label: 'Acceso General (Empleados)' }
        ]
    },
    {
        id: 'usuarios',
        group: 'Usuarios',
        navPath: '/usuarios',
        items: [{ id: 'usuarios', label: 'Acceso General' }]
    },
    {
        id: 'configuracion',
        group: 'Configuración',
        navPath: '/configuracion',
        items: [{ id: 'configuracion', label: 'Acceso General' }]
    },
    {
        id: 'mi_cuenta',
        group: 'Mi Cuenta',
        navPath: '/mi-cuenta',
        items: [{ id: 'mi_cuenta', label: 'Acceso General' }]
    }
];