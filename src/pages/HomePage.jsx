import React from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { LogOut, Calculator, Info, Printer, FileBadge, UserCircle, Bell, KeyRound } from 'lucide-react';
const actionButtons = [{
  id: 'salir',
  label: 'Salir',
  icon: LogOut
}, {
  id: 'calculadora',
  label: 'Calculadora',
  icon: Calculator
}, {
  id: 'acerca',
  label: 'Acerca',
  icon: Info
}, {
  id: 'impresoras',
  label: 'Impresoras',
  icon: Printer
}, {
  id: 'certificados',
  label: 'Certificados',
  icon: FileBadge
}, {
  id: 'mi_cuenta',
  label: 'Mi cuenta',
  icon: UserCircle
}, {
  id: 'novedades',
  label: 'Novedades',
  icon: Bell
}, {
  id: 'accesos',
  label: 'Accesos',
  icon: KeyRound
}];
const ActionButton = ({
  item,
  index
}) => {
  const {
    toast
  } = useToast();
  const Icon = item.icon;
  const handleClick = () => {
    toast({
      title: "🚧 Esta función no está implementada aún",
      description: `La función "${item.label}" estará disponible pronto. ¡Puedes solicitarla en tu próximo prompt! 🚀`
    });
  };
  return <motion.button onClick={handleClick} className="flex flex-col items-center justify-center text-white space-y-1 group" initial={{
    opacity: 0,
    y: 20
  }} animate={{
    opacity: 1,
    y: 0
  }} transition={{
    delay: 0.2 + index * 0.05
  }} whileHover={{
    scale: 1.1
  }} whileTap={{
    scale: 0.95
  }}>
      <div className="w-14 h-14 rounded-full border-2 border-orange-400 bg-gray-800 group-hover:bg-orange-500 transition-colors flex items-center justify-center">
        <Icon className="w-7 h-7 text-orange-400 group-hover:text-white" />
      </div>
      <span className="text-xs font-semibold">{item.label}</span>
    </motion.button>;
};
function HomePage() {
  return <div className="h-full flex flex-col">
      <div className="bg-gray-800 text-white shadow-lg">
        <div className="container mx-auto px-4 py-3">
          <div className="flex justify-start items-center space-x-12">
            {actionButtons.map((item, index) => <ActionButton key={item.id} item={item} index={index} />)}
          </div>
        </div>
      </div>
      <div className="flex-grow flex items-center justify-center bg-white shadow-inner">
        <motion.div initial={{
        opacity: 0,
        scale: 0.9
      }} animate={{
        opacity: 1,
        scale: 1
      }} transition={{
        delay: 0.5,
        duration: 0.5
      }} className="text-center">
          <div className="inline-flex items-center space-x-6 p-8">
            <div className="flex items-center space-x-3">
                <div className="p-4 bg-orange-500 rounded-full">
                    <span className="text-white font-bold text-4xl">DLV</span>
                </div>
                <div className="text-left">
                    <p className="text-4xl font-bold text-gray-800">bcn resto</p>
                    <p className="text-lg text-gray-600">Atención al Cliente</p>
                </div>
            </div>
            <div className="border-l-2 border-orange-400 h-16"></div>
            <div className="text-left">
              <p className="text-2xl font-bold text-green-600 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                11.2865.4468
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>;
}
export default HomePage;