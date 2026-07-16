/**
 * The app's sound design — synthesized with the Web Audio API, so there are no audio
 * assets to ship, and every sound is a few lines rather than a licensed .wav.
 *
 * **Low and bassy, like Discord's** — a soft wooden "thock", not a chime. The previous
 * palette sat in the 5th–6th octave (D6, E6, B5…), which is exactly where the ear is most
 * sensitive and where "shrill" lives: it read as an alarm clock. Everything now sits in
 * the **3rd–4th octave** (165–520 Hz), which is the register Discord's UI sounds live in.
 *
 * Four things make a sound warm rather than sharp:
 *
 *  1. **A low fundamental**, plus a **sub-octave** underneath it. The sub is what you feel
 *     as body — it's the difference between a "boop" and a "thock", and it's the single
 *     biggest change from the old version.
 *  2. **A soft attack.** A tone that jumps to full volume *clicks*; the ear hears the
 *     discontinuity, not the note. Everything ramps over 15–25ms.
 *  3. **A long, exponential release.** Real resonant things decay slowly and never quite
 *     stop. A note cut off at a fixed length sounds electronic.
 *  4. **A LOW lowpass.** Cutoffs here are 600–1800 Hz, not 2400–3200. That's what removes
 *     the glare: the harmonics are still there for body, but the top end that makes a
 *     sound "itch" is gone.
 *
 * Low frequencies are perceived as quieter at the same amplitude (equal-loudness), so the
 * gains are a little higher than the old bright ones — it's the *spectrum* that got calmer,
 * not just the volume.
 */

import { useSettingsStore } from '@renderer/store/settings-store'

/** One `AudioContext` for the whole app. Creating one per sound (as this used to)
 *  leaks: browsers cap the number of contexts, and the cap is low enough that a busy
 *  call would eventually get silence. */
let context: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    if (!context) {
      const Ctor = window.AudioContext
      if (!Ctor) return null
      context = new Ctor()
    }
    // A context created before the first user gesture starts suspended. Every sound
    // we play follows a click, so this always succeeds by the time it matters.
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

/** One struck note: a fundamental, a **sub-octave below** for weight, a quiet octave above
 *  for definition, and a low lowpass to take the glare off. `gain` is the peak; the release
 *  is what you actually hear. */
function strike(
  ctx: AudioContext,
  master: GainNode,
  at: number,
  frequency: number,
  {
    gain = 0.34,
    attack = 0.018,
    release = 0.4,
    /** The octave BELOW, mixed in under the fundamental. This is the bass — it's what
     *  makes the sound land in your chest rather than your ears. 0 = no weight. */
    sub = 0.5,
    /** The octave ABOVE. Keep it small: it's for definition (so the note has a pitch you
     *  can name), not for brightness. */
    shimmer = 0.12,
    /** Above this the tone is rolled off. LOW by design — 600–1800, not 3000+. */
    cutoff = 1400
  } = {}
): void {
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = cutoff
  filter.Q.value = 0.5

  const envelope = ctx.createGain()
  envelope.gain.setValueAtTime(0.0001, at)
  // Ramp up gently (no click), then decay exponentially and never quite to zero —
  // `exponentialRampToValueAtTime` can't reach 0, which is exactly the shape a
  // physical resonance has anyway.
  envelope.gain.exponentialRampToValueAtTime(gain, at + attack)
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + attack + release)

  const fundamental = ctx.createOscillator()
  fundamental.type = 'sine'
  fundamental.frequency.value = frequency
  fundamental.connect(envelope)

  const bass = ctx.createOscillator()
  bass.type = 'sine'
  bass.frequency.value = frequency / 2
  const bassGain = ctx.createGain()
  bassGain.gain.value = sub
  bass.connect(bassGain).connect(envelope)

  const octave = ctx.createOscillator()
  octave.type = 'sine'
  octave.frequency.value = frequency * 2
  const octaveGain = ctx.createGain()
  octaveGain.gain.value = shimmer
  octave.connect(octaveGain).connect(envelope)

  envelope.connect(filter).connect(master)

  const end = at + attack + release + 0.05
  for (const osc of [fundamental, bass, octave]) {
    osc.start(at)
    osc.stop(end)
  }
}

interface Note {
  /** Hz. */
  frequency: number
  /** Seconds after the sound starts. Overlapping notes ring together — which is what
   *  makes two notes read as one gesture rather than as two beeps. */
  at: number
  gain?: number
  attack?: number
  release?: number
  sub?: number
  shimmer?: number
  cutoff?: number
}

/** Play a sound. Silent when the user has turned sounds off; scaled by their volume. */
function play(notes: Note[], baseGain = 1): void {
  const { soundEnabled, soundVolume } = useSettingsStore.getState()
  if (!soundEnabled || soundVolume <= 0) return

  const ctx = audio()
  if (!ctx) return

  try {
    const master = ctx.createGain()
    master.gain.value = soundVolume * baseGain
    master.connect(ctx.destination)

    const now = ctx.currentTime + 0.01
    for (const note of notes) {
      strike(ctx, master, now + note.at, note.frequency, note)
    }
    // Disconnect once everything has rung out, so the graph doesn't grow.
    const last = notes.reduce(
      (max, note) => Math.max(max, note.at + (note.attack ?? 0.018) + (note.release ?? 0.4)),
      0
    )
    window.setTimeout(() => master.disconnect(), (last + 0.3) * 1000)
  } catch {
    // Audio is a nicety — never let it break a call or a message.
  }
}

// ── The palette ────────────────────────────────────────────────────────────────
// The 3rd and 4th octaves. Low enough to be warm, high enough to carry over a laptop
// speaker — the register Discord's UI sounds sit in.
const G3 = 196.0
const A3 = 220.0
const B3 = 246.94
const C4 = 261.63
const D4 = 293.66
const E4 = 329.63
const G4 = 392.0
const A4 = 440.0

/**
 * A new message, mention or DM.
 *
 * Two notes a fourth apart, the second landing while the first still rings — a soft,
 * rounded "dun-dun" with a long tail. **Descending**, because a rising pair reads as a
 * question and this is an announcement. The most-heard sound in the app, so it's the
 * gentlest one here: the lowest peak and the heaviest lowpass.
 */
export function playNotificationSound(): void {
  play(
    [
      { frequency: A4, at: 0, gain: 0.3, attack: 0.014, release: 0.42, cutoff: 1500 },
      { frequency: E4, at: 0.1, gain: 0.34, attack: 0.018, release: 0.95, cutoff: 1300, sub: 0.6 }
    ],
    0.9
  )
}

/** Rising fifth, low and round — someone joined the call (or you did). Warm, and it
 *  *arrives*: the second note is bigger than the first. */
export function playJoinSound(): void {
  play([
    { frequency: G3, at: 0, gain: 0.34, release: 0.3, cutoff: 1200 },
    { frequency: D4, at: 0.095, gain: 0.38, release: 0.7, cutoff: 1500, sub: 0.55 }
  ])
}

/** Falling fifth — someone left. The exact mirror of the join, so the pair is legible
 *  without having to think about it. Darker on the way down. */
export function playLeaveSound(): void {
  play([
    { frequency: D4, at: 0, gain: 0.34, release: 0.3, cutoff: 1300 },
    { frequency: G3, at: 0.095, gain: 0.36, release: 0.8, cutoff: 1000, sub: 0.65 }
  ])
}

/** One low, short, muffled note — mic off. A wooden "thock": heavy sub, low cutoff, quick
 *  decay. *You* just went quiet, and the sound says so. */
export function playMuteSound(): void {
  play([{ frequency: A3, at: 0, gain: 0.36, attack: 0.01, release: 0.2, cutoff: 800, sub: 0.75 }])
}

/** One note, a fifth up and more open — mic on. Same weight, less muffle. */
export function playUnmuteSound(): void {
  play([{ frequency: E4, at: 0, gain: 0.34, attack: 0.012, release: 0.26, cutoff: 1600, sub: 0.5 }])
}

/** Falling pair, very dark — you deafened. Heavy sub, cutoff down at 600: it *sounds* like
 *  the room closing over, which is exactly what just happened. */
export function playDeafenSound(): void {
  play([
    { frequency: E4, at: 0, gain: 0.32, release: 0.26, cutoff: 700, sub: 0.7, shimmer: 0.04 },
    { frequency: B3, at: 0.085, gain: 0.34, release: 0.6, cutoff: 550, sub: 0.8, shimmer: 0.02 }
  ])
}

/** Rising pair, open again — you undeafened. The room comes back. */
export function playUndeafenSound(): void {
  play([
    { frequency: B3, at: 0, gain: 0.32, release: 0.26, cutoff: 1200 },
    { frequency: E4, at: 0.085, gain: 0.36, release: 0.6, cutoff: 1700, sub: 0.45 }
  ])
}

/** Rising third — you started sharing. A touch brighter than a join (it's an action, not
 *  an arrival) but still well under the glare line. */
export function playScreenShareStartSound(): void {
  play([
    { frequency: C4, at: 0, gain: 0.3, release: 0.24, cutoff: 1600 },
    { frequency: G4, at: 0.075, gain: 0.32, release: 0.5, cutoff: 1800, sub: 0.4 }
  ])
}

/** Falling third — you stopped sharing. */
export function playScreenShareStopSound(): void {
  play([
    { frequency: G4, at: 0, gain: 0.3, release: 0.24, cutoff: 1500 },
    { frequency: C4, at: 0.075, gain: 0.32, release: 0.55, cutoff: 1100, sub: 0.55 }
  ])
}

/** Used by the settings slider: play the notification sound so you can hear what you're
 *  setting the volume to, instead of adjusting it blind. */
export function previewNotificationSound(): void {
  playNotificationSound()
}
