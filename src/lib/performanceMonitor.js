class PerformanceMonitor {
  constructor() {
    this.metrics = {};
    this.isDev = import.meta.env.MODE === 'development';
  }

  startTimer(label) {
    this.metrics[label] = performance.now();
  }

  endTimer(label, thresholdMs = 1000) {
    if (!this.metrics[label]) return;
    
    const duration = performance.now() - this.metrics[label];
    delete this.metrics[label];

    if (duration > thresholdMs) {
      console.warn(`🐢 [Performance] ${label} took ${duration.toFixed(2)}ms (Threshold: ${thresholdMs}ms)`);
    } else if (this.isDev) {
      console.debug(`⏱️ [Performance] ${label} took ${duration.toFixed(2)}ms`);
    }
    
    return duration;
  }

  trackQuery(queryName, queryFn) {
    const start = performance.now();
    return queryFn().then(result => {
      const duration = performance.now() - start;
      if (duration > 1000) {
         console.warn(`🐢 [Slow Query] ${queryName} took ${duration.toFixed(2)}ms`);
      }
      return result;
    }).catch(err => {
      console.error(`❌ [Query Error] ${queryName} failed after ${(performance.now() - start).toFixed(2)}ms`, err);
      throw err;
    });
  }
}

export const perfMonitor = new PerformanceMonitor();