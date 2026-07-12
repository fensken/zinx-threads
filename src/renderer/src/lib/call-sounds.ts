// Discord-style call sound effects, synthesized with the Web Audio API so there
// are no audio asset files to ship. Each is a short one/two-note blip.

function playBlip(frequencies: number[], noteMs: number, volume = 0.22): void {
  try {
    const AudioCtx = window.AudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const noteSeconds = noteMs / 1000
    frequencies.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const start = ctx.currentTime + index * noteSeconds
      const end = start + noteSeconds
      // Quick attack + exponential decay so it reads as a soft "blip", not a beep.
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, end)
      oscillator.connect(gain).connect(ctx.destination)
      oscillator.start(start)
      oscillator.stop(end)
    })
    window.setTimeout(() => void ctx.close(), noteMs * frequencies.length + 120)
  } catch {
    // Audio is a nicety — never let it break the call.
  }
}

/** Rising two-note chime — someone joined (or you did). */
export function playJoinSound(): void {
  playBlip([523.25, 784.0], 110) // C5 → G5
}

/** Falling two-note chime — someone left (or you did). */
export function playLeaveSound(): void {
  playBlip([784.0, 523.25], 110) // G5 → C5
}

/** Short low blip — you muted your mic. */
export function playMuteSound(): void {
  playBlip([440.0], 90) // A4
}

/** Short higher blip — you unmuted your mic. */
export function playUnmuteSound(): void {
  playBlip([660.0], 90) // ~E5
}

/** Two falling notes — you deafened (muted everyone). */
export function playDeafenSound(): void {
  playBlip([520.0, 360.0], 90)
}

/** Two rising notes — you undeafened. */
export function playUndeafenSound(): void {
  playBlip([360.0, 520.0], 90)
}

/** Bright rising blip — you started sharing your screen. */
export function playScreenShareStartSound(): void {
  playBlip([660.0, 990.0], 100)
}

/** Bright falling blip — you stopped sharing. */
export function playScreenShareStopSound(): void {
  playBlip([990.0, 660.0], 100)
}
