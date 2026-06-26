export const ERROR_HISTORY_KEY = 'dlv_error_history';
const MAX_ERRORS = 50;

class ErrorLogger {
  constructor() {
    this.errorHistory = this.loadHistory();
    this.lastError = null;
    this.lastErrorTime = 0;
  }

  loadHistory() {
    try {
      const stored = localStorage.getItem(ERROR_HISTORY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem(ERROR_HISTORY_KEY, JSON.stringify(this.errorHistory));
    } catch (e) {
      console.warn('Failed to save error history to localStorage', e);
    }
  }

  log(error, context = {}) {
    const now = Date.now();
    const errorMessage = error?.message || String(error);
    
    // Prevent duplicate spam within 2 seconds
    if (this.lastError === errorMessage && (now - this.lastErrorTime) < 2000) {
      return;
    }

    this.lastError = errorMessage;
    this.lastErrorTime = now;

    const errorEntry = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      message: errorMessage,
      stack: error?.stack,
      context,
      timestamp: new Date().toISOString(),
      url: window.location.href,
    };

    console.error('🚨 [App Error]', errorEntry.message, '\nContext:', context, '\nStack:', errorEntry.stack);

    this.errorHistory.unshift(errorEntry);
    if (this.errorHistory.length > MAX_ERRORS) {
      this.errorHistory.pop();
    }

    this.saveHistory();
    return errorEntry;
  }

  getHistory() {
    return this.errorHistory;
  }

  clearHistory() {
    this.errorHistory = [];
    this.saveHistory();
  }
}

export const logger = new ErrorLogger();