import React from 'react';
import { motion } from 'framer-motion';
import {
  Package,
  Layers,
  Settings,
  ShoppingCart,
  FolderTree,
  Boxes,
  Trash2 as Trash
} from 'lucide-react';

const iconMap = {
  articulos: Package,
  'materia-prima': Layers,
  'grupos-opcionales': FolderTree,
  'grupos-productos': Boxes,
  opcionales: ShoppingCart,
  departamentos: Settings,
  tachos: Trash,
};

const StockHeader = ({ visibleTabs, activeTab, setActiveTab }) => {
  return (
    <nav className="mb-6 w-full">
      <div className="flex w-full p-1 bg-gray-200 rounded-lg">
        {visibleTabs.map((tab) => {
          const Icon = iconMap[tab.id];
          return (
            <motion.button
              key={tab.id}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center space-x-2 px-2 py-2.5 rounded-md font-medium text-xs md:text-sm transition-all duration-300 min-w-0 ${
                activeTab === tab.id
                  ? 'bg-white text-orange-600 shadow'
                  : 'text-gray-600 hover:bg-white/60'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="truncate">{tab.label}</span>
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
};

export default StockHeader;