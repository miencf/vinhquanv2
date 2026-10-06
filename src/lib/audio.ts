/**
 * Synthesizes minimalist, premium audio cues using the native Web Audio API.
 * This guarantees zero external dependencies and offline compatibility.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play a gentle, crystalline organic chime sound (e.g., when a timer finishes)
 */
export function playChime() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // We'll stack multiple sine waves for an organic, bell-like timbre
    const frequencies = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 chord
    const gains = [0.15, 0.1, 0.08, 0.05];

    frequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      
      // Gentle strike and long, smooth exponential decay
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(gains[idx], now + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 2.0);
    });
  } catch (error) {
    console.warn('Audio playback failed or is blocked by browser policy:', error);
  }
}

/**
 * Play a delicate mechanical tick sound (e.g., for timer countdown state change)
 */
export function playTick() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.015);

    gainNode.gain.setValueAtTime(0.02, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.02);
  } catch (error) {
    // Fail silently to avoid interrupting the user's experience
  }
}

/**
 * Play a soft start/pause toggle click sound
 */
export function playClick() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.setValueAtTime(200, now + 0.01);

    gainNode.gain.setValueAtTime(0.04, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.04);
  } catch (error) {
    // Fail silently
  }
}
