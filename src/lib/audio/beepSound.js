/**
 * Utility to generate a brief beep sound for successful scanning operations.
 * Uses the native Web Audio API, requiring no external assets.
 */
export const playBeep = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    
    // Connect nodes: Oscillator -> Gain -> Destination (speakers)
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    
    // Set sound properties: Sine wave at 880Hz (A5 note)
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    
    // Set volume and create a quick fade out to prevent clicking
    gainNode.gain.setValueAtTime(0.1, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.15);
    
    // Play sound for a short duration (150ms)
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + 0.15);
  } catch (error) {
    console.warn('Audio context not supported or failed to play beep', error);
  }
};