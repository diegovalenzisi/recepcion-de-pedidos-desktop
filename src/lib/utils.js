import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { format as formatDateFns, parse } from 'date-fns';

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatDateForFirebase(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) {
    return formatDateFns(new Date(), 'dd-MM-yyyy');
  }
  return formatDateFns(date, 'dd-MM-yyyy');
}

export function formatDateToDDMMAAAA(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) {
    date = new Date();
  }
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}${m}${y}`;
}

export function parseDateString(dateString) {
  if (!dateString) return new Date();
  
  // Try parsing dd-MM-yyyy first
  let date = parse(dateString, 'dd-MM-yyyy', new Date());
  if (!isNaN(date)) return date;

  // Try parsing d-M-yyyy
  date = parse(dateString, 'd-M-yyyy', new Date());
  if (!isNaN(date)) return date;

  // Try parsing yyyy-MM-dd (from new Date().toISOString().split('T')[0])
  date = parse(dateString, 'yyyy-MM-dd', new Date());
  if (!isNaN(date)) return date;

  // Fallback to default date-fns parsing if others fail
  date = new Date(dateString);
  if (!isNaN(date)) return date;
  
  return new Date(); // Return current date as a fallback
}


export function getOperationalDate(date = new Date()) {
  const hours = date.getHours();
  // If it's between midnight (0) and 2 AM (exclusive), it belongs to the previous day.
  if (hours >= 0 && hours < 2) {
    const yesterday = new Date(date);
    yesterday.setDate(date.getDate() - 1);
    return yesterday;
  }
  return date;
}