import React from 'react';
import { motion } from 'framer-motion';
import { Users, Briefcase } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EmployeesTab from '@/pages/hr/EmployeesTab';
import CategoriesTab from '@/pages/hr/CategoriesTab';

function HumanResourcesPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-1 h-full flex flex-col"
    >
      <Tabs defaultValue="employees" className="flex-grow flex flex-col">
        <div className="flex justify-between items-center mb-4">
            <h1 className="text-3xl font-bold text-gray-800">Recursos Humanos</h1>
            <TabsList>
                <TabsTrigger value="employees">
                    <Users className="mr-2 h-4 w-4" /> Empleados
                </TabsTrigger>
                <TabsTrigger value="categories">
                    <Briefcase className="mr-2 h-4 w-4" /> Categorías
                </TabsTrigger>
            </TabsList>
        </div>
        
        <TabsContent value="employees" className="flex-grow">
          <EmployeesTab />
        </TabsContent>
        <TabsContent value="categories" className="flex-grow">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}

export default HumanResourcesPage;