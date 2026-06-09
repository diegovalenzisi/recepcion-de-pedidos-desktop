import { format } from "date-fns";

export const calculatePayment = (formData, employee) => {
  if (!employee) return { totalHours: 0, totalPayment: 0, totalShiftPayment: 0 };

  // Calculation for hours
  const parseTime = (timeStr) => {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  };

  const t1Start = parseTime(formData.turno1Desde);
  const t1End = parseTime(formData.turno1Hasta);
  const t2Start = parseTime(formData.turno2Desde);
  const t2End = parseTime(formData.turno2Hasta);

  let hours1 = 0;
  if (t1Start && t1End && t1End > t1Start) {
    hours1 = (t1End - t1Start) / (1000 * 60 * 60);
  }

  let hours2 = 0;
  if (t2Start && t2End && t2End > t2Start) {
    hours2 = (t2End - t2Start) / (1000 * 60 * 60);
  }

  const totalHours = hours1 + hours2;
  const totalPayment = totalHours * (employee.valorHora || 0);

  // Calculation for shifts
  let totalShiftPayment = 0;
  if (formData.turnos.manana) {
    totalShiftPayment += parseFloat(employee.valorTurnoManana || 0);
  }
  if (formData.turnos.tarde) {
    totalShiftPayment += parseFloat(employee.valorTurnoTarde || 0);
  }
  if (formData.turnos.noche) {
    totalShiftPayment += parseFloat(employee.valorTurnoNoche || 0);
  }

  return { totalHours, totalPayment, totalShiftPayment };
};

const formatHoursAndMinutes = (totalHours) => {
  if (typeof totalHours !== 'number' || totalHours < 0) {
    return '0hs';
  }
  const hours = Math.floor(totalHours);
  const minutes = Math.round((totalHours - hours) * 60);

  let parts = [];
  if (hours > 0) {
    parts.push(`${hours}hs`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}ms`);
  }
  
  if (parts.length === 0) return '0hs';

  return parts.join(' ');
};

export const prepareSaveData = ({
  paymentType,
  formData,
  totalHours,
  totalPayment,
  totalShiftPayment,
  accumulatedData,
  selectedEmployee,
  paymentMethod,
  paymentId,
  isAccumulating = false,
}) => {
  const baseData = {
    id: paymentId,
    employeeId: formData.employeeId,
    employeeName: `${selectedEmployee.nombre} ${selectedEmployee.apellido}`,
    fecha: new Date().toISOString(),
    type: paymentType,
  };

  if (isAccumulating) {
    const accumulationData = {
      monto: 0,
      concepto: '',
      turnos: [],
      descripcion: '',
    };

    if (paymentType === 'horas') {
      const turnos = [];
      if (formData.turno1Desde && formData.turno1Hasta) {
        turnos.push(`de ${formData.turno1Desde} a ${formData.turno1Hasta}`);
      }
      if (formData.turno2Desde && formData.turno2Hasta) {
        turnos.push(`de ${formData.turno2Desde} a ${formData.turno2Hasta}`);
      }
      accumulationData.monto = totalPayment;
      accumulationData.totalHoras = totalHours;
      accumulationData.concepto = `Pago por ${formatHoursAndMinutes(totalHours)} trabajadas`;
      accumulationData.descripcion = `${accumulationData.concepto}${turnos.length > 0 ? ` (${turnos.join(' y ')})` : ''}`;
      accumulationData.turnos = turnos;
    } else if (paymentType === 'turno') {
        const selectedShifts = Object.entries(formData.turnos)
            .filter(([,isSelected]) => isSelected)
            .map(([shiftName]) => shiftName.charAt(0).toUpperCase() + shiftName.slice(1));
        
        accumulationData.monto = totalShiftPayment;
        accumulationData.concepto = `Pago por turno(s)`;
        accumulationData.descripcion = `${accumulationData.concepto}: ${selectedShifts.join(', ')}`;
    } else if (paymentType === 'otro') {
      accumulationData.monto = parseFloat(formData.montoManual);
      accumulationData.concepto = formData.conceptoManual;
      accumulationData.descripcion = formData.conceptoManual;
    }
    return accumulationData;
  }

  const paymentData = { ...baseData, paymentMethod };

  if (paymentType === 'horas') {
    const turnos = [];
    if (formData.turno1Desde && formData.turno1Hasta) {
      turnos.push(`de ${formData.turno1Desde} a ${formData.turno1Hasta}`);
    }
    if (formData.turno2Desde && formData.turno2Hasta) {
      turnos.push(`de ${formData.turno2Desde} a ${formData.turno2Hasta}`);
    }
    
    let concepto = `Pago por ${formatHoursAndMinutes(totalHours)}`;
    if (turnos.length > 0) {
      concepto += ` (${turnos.join(' y ')})`;
    }

    return {
      ...paymentData,
      concepto: concepto,
      monto: totalPayment,
      totalHoras: totalHours,
      turno1Desde: formData.turno1Desde,
      turno1Hasta: formData.turno1Hasta,
      turno2Desde: formData.turno2Desde,
      turno2Hasta: formData.turno2Hasta,
    };
  } else if (paymentType === 'turno') {
    const selectedShifts = Object.entries(formData.turnos)
        .filter(([,isSelected]) => isSelected)
        .map(([shiftName]) => shiftName.charAt(0).toUpperCase() + shiftName.slice(1));
    return {
        ...paymentData,
        concepto: `Pago por turno(s): ${selectedShifts.join(', ')}`,
        monto: totalShiftPayment,
        turnos: formData.turnos,
    }
  } else if (paymentType === 'otro') {
    return {
      ...paymentData,
      concepto: formData.conceptoManual,
      monto: parseFloat(formData.montoManual),
    };
  } else if (paymentType === 'pago_acumulado') {
    return {
      ...paymentData,
      concepto: `Pago de acumulado para ${selectedEmployee.nombre} ${selectedEmployee.apellido}`,
      monto: accumulatedData.totalAcumulado,
    };
  }

  return {};
};

export const generateWhatsAppMessage = (employee, accumulatedData, paymentMethod, accounts = []) => {
    let message = `Hola ${employee.nombre},\n\n`;
    message += `Se ha procesado tu pago de acumulados. Aquí está el detalle:\n\n`;
    
    const details = [];
    Object.keys(accumulatedData)
      .filter(key => key !== 'totalAcumulado' && key !== 'contadorPagos')
      .sort((dateA, dateB) => new Date(dateA.split('-').reverse().join('-')) - new Date(dateB.split('-').reverse().join('-')))
      .forEach(date => {
        const entries = accumulatedData[date];
        details.push(`*Fecha:* ${date}`);
        Object.values(entries).forEach(entry => {
            details.push(`  - _Concepto:_ ${entry.descripcion}`);
            details.push(`  - _Monto:_ $${entry.monto.toFixed(2)}`); // Added $ sign
        });
        details.push(''); 
    });

    message += details.join('\n');
    message += `\n*------------------------------------*\n`;
    message += `*TOTAL PAGADO: $${accumulatedData.totalAcumulado.toFixed(2)}*\n`; // Added $ sign
    
    // Add payment method details
    if (paymentMethod === 'Efectivo') {
        message += `*Método de Pago:* Efectivo\n`;
    } else {
        const account = accounts.find(acc => acc.nombre === paymentMethod);
        if (account) {
            message += `*Método de Pago:* ${account.nombre} (Alias: ${account.alias}`;
            if (account.aNombreDe && account.aNombreDe.trim()) {
                message += ` a nombre de ${account.aNombreDe}`;
            }
            message += `)\n`;
        } else {
            message += `*Método de Pago:* ${paymentMethod}\n`;
        }
    }

    message += `*------------------------------------*\n\n`;
    message += `¡Gracias por tu trabajo!`;

    return message;
};