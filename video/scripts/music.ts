/**
 * Synthesizes the soundtrack: an upbeat 120 BPM loop (pad, pluck arpeggio,
 * bass, drums) plus quiet UI sounds (key presses, clicks, pops) at the cues of
 * src/timeline.ts. Everything is generated here, from code, so the music has
 * no third-party license: it ships under the repository's MIT license.
 *
 *   bun scripts/music.ts   →   public/music.wav (44.1 kHz, 16-bit stereo)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CUES, FPS, SCENE_ORDER, schedule, totalFrames } from '../src/timeline';
import type { Cue } from '../src/timeline';

const RATE = 44_100;
const BPM = 120;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const DURATION = totalFrames(SCENE_ORDER) / FPS;
const LENGTH = Math.ceil(DURATION * RATE);

/** Drums come in with the title ("Your week."), and leave for the end card. */
const DRUMS_IN = BAR;
const END_CARD = (schedule(SCENE_ORDER).at(-1)?.from ?? 0) / FPS;
const DRUMS_OUT = Math.floor(END_CARD / BAR) * BAR + BAR;

const left = new Float32Array(LENGTH);
const right = new Float32Array(LENGTH);
const reverbSend = new Float32Array(LENGTH);

// A deterministic noise source, so every run writes the same file.
let seed = 0x2f6e2b1;
function noise(): number {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;

    return (seed / 0xffffffff) * 2 - 1;
}

const midiToHz = (note: number) => 440 * 2 ** ((note - 69) / 12);

function add(index: number, value: number, pan = 0, send = 0): void {
    if (index < 0 || index >= LENGTH) {
        return;
    }

    left[index] += value * Math.min(1, 1 - pan);
    right[index] += value * Math.min(1, 1 + pan);
    reverbSend[index] += value * send;
}

/** 1 → ~0.45 right after each kick, back to 1 over a beat: the "pump". */
function duck(time: number): number {
    if (time < DRUMS_IN || time >= DRUMS_OUT) {
        return 1;
    }

    const sinceKick = time % BEAT;

    return 1 - 0.55 * Math.exp(-sinceKick / 0.11);
}

// Cmaj9 · Am7 · Fmaj7 · G6, one bar each.
const CHORDS = [
    { bass: 36, pad: [64, 67, 71, 74] },
    { bass: 45, pad: [60, 64, 67, 72] },
    { bass: 41, pad: [57, 60, 64, 69] },
    { bass: 43, pad: [59, 62, 64, 67] },
];

const chordAt = (time: number) =>
    CHORDS[Math.floor(time / BAR) % CHORDS.length];

/** A soft pad: detuned saws through a one-pole low-pass that opens up. */
function renderPad(): void {
    const voices = 3;
    const phases = new Float64Array(16 * voices);
    let lowL = 0;
    let lowR = 0;

    for (let i = 0; i < LENGTH; i++) {
        const time = i / RATE;
        const chord = chordAt(time);
        const barPos = (time % BAR) / BAR;
        // Swells into each bar, never fully silent.
        const swell = 0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, barPos * 3));
        const cutoff = 500 + 1600 * Math.min(1, time / (BAR * 2));
        const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
        let sumL = 0;
        let sumR = 0;

        chord.pad.forEach((note, n) => {
            for (let v = 0; v < voices; v++) {
                const detune = (v - 1) * 0.08;
                const k = n * voices + v;
                phases[k] = (phases[k] + midiToHz(note + detune) / RATE) % 1;
                const saw = phases[k] * 2 - 1;

                if (v === 0) {
                    sumL += saw;
                } else if (v === 2) {
                    sumR += saw;
                } else {
                    sumL += saw * 0.5;
                    sumR += saw * 0.5;
                }
            }
        });

        lowL += alpha * (sumL - lowL);
        lowR += alpha * (sumR - lowR);
        const gain = 0.028 * swell * duck(time);
        left[i] += lowL * gain;
        right[i] += lowR * gain;
        reverbSend[i] += (lowL + lowR) * gain * 0.3;
    }
}

/** A plucked arpeggio in 8ths over the chord, an octave up. */
function renderPluck(): void {
    const step = BEAT / 2;
    const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
    const steps = Math.floor(DURATION / step);

    for (let s = 0; s < steps; s++) {
        const start = s * step;

        if (start >= DRUMS_OUT + BAR) {
            break;
        }

        const chord = chordAt(start);
        const note = chord.pad[pattern[s % pattern.length]] + 12;
        const freq = midiToHz(note);
        const begin = Math.floor(start * RATE);
        const length = Math.floor(0.45 * RATE);
        const pan = s % 2 === 0 ? -0.35 : 0.35;
        const accent = s % 4 === 0 ? 1 : 0.7;
        let low = 0;

        for (let j = 0; j < length; j++) {
            const t = j / RATE;
            const env = Math.exp(-t / 0.11) * Math.min(1, t / 0.003);
            const tone =
                Math.sin(2 * Math.PI * freq * t) * 0.7 +
                Math.sin(2 * Math.PI * freq * 2 * t) *
                    0.25 *
                    Math.exp(-t / 0.04) +
                (((freq * t) % 1) - 0.5) * 0.3;
            low += 0.35 * (tone - low);
            add(begin + j, low * env * 0.07 * accent, pan, 0.45);
        }
    }
}

/** Bass on a syncopated pattern: beat 1, the "and" of 2, beat 3, the "and" of 4. */
function renderBass(): void {
    const hits = [0, 1.5, 2, 3.5];
    const bars = Math.ceil(DURATION / BAR);

    for (let b = 0; b < bars; b++) {
        for (const hit of hits) {
            const start = b * BAR + hit * BEAT;

            if (start < DRUMS_IN || start >= DRUMS_OUT) {
                continue;
            }

            const freq = midiToHz(chordAt(start).bass);
            const begin = Math.floor(start * RATE);
            const length = Math.floor(BEAT * 0.9 * RATE);

            for (let j = 0; j < length; j++) {
                const t = j / RATE;
                const env =
                    Math.min(1, t / 0.005) *
                    Math.exp(-t / 0.35) *
                    Math.min(1, (length - j) / (RATE * 0.02));
                const tone =
                    Math.sin(2 * Math.PI * freq * t) +
                    0.3 * Math.sin(2 * Math.PI * freq * 2 * t);
                add(begin + j, tone * env * 0.16);
            }
        }
    }
}

function renderDrums(): void {
    const beats = Math.floor(DURATION / BEAT);

    for (let b = 0; b < beats; b++) {
        const start = b * BEAT;

        if (start < DRUMS_IN || start >= DRUMS_OUT) {
            continue;
        }

        const begin = Math.floor(start * RATE);

        // Kick: a sine that drops from 140 Hz to 45 Hz.
        let phase = 0;

        for (let j = 0; j < RATE * 0.3; j++) {
            const t = j / RATE;
            const freq = 45 + 95 * Math.exp(-t / 0.03);
            phase += (2 * Math.PI * freq) / RATE;
            add(begin + j, Math.sin(phase) * Math.exp(-t / 0.12) * 0.42);
        }

        // Clap on 2 and 4: a few quick noise bursts, band-limited.
        if (b % 2 === 1) {
            let low = 0;
            let lower = 0;

            for (let j = 0; j < RATE * 0.2; j++) {
                const t = j / RATE;
                const bursts =
                    t < 0.03 ? Math.exp(-((t * 1000) % 10) / 2.5) : 1;
                const env = Math.exp(-t / 0.07) * bursts;
                const n = noise();
                low += 0.45 * (n - low);
                lower += 0.08 * (n - lower);
                add(begin + j, (low - lower) * env * 0.2, 0, 0.5);
            }
        }

        // Hats on the off-beats (and a quieter one on the beat).
        for (const [offset, level] of [
            [0.5, 0.075],
            [0, 0.03],
        ] as const) {
            const hatBegin = begin + Math.floor(offset * BEAT * RATE);
            let low = 0;

            for (let j = 0; j < RATE * 0.05; j++) {
                const t = j / RATE;
                const n = noise();
                low += 0.6 * (n - low);
                add(
                    hatBegin + j,
                    (n - low) * Math.exp(-t / 0.015) * level,
                    0.2,
                );
            }
        }
    }
}

/** Quiet UI sounds under the picture. */
function renderCue(at: number, kind: Cue['kind']): void {
    const begin = Math.floor(at * RATE);

    switch (kind) {
        case 'key': {
            let low = 0;

            for (let j = 0; j < RATE * 0.025; j++) {
                const t = j / RATE;
                const n = noise();
                low += 0.5 * (n - low);
                const tick = Math.sin(2 * Math.PI * 1900 * t);
                add(
                    begin + j,
                    ((n - low) * 0.5 + tick * 0.3) *
                        Math.exp(-t / 0.006) *
                        0.12,
                    0.1,
                );
            }

            break;
        }

        case 'enter':
        case 'click': {
            const deep = kind === 'enter';

            for (let j = 0; j < RATE * 0.06; j++) {
                const t = j / RATE;
                const n = noise();
                const body = Math.sin(2 * Math.PI * (deep ? 520 : 1300) * t);
                add(
                    begin + j,
                    (n * 0.35 + body * 0.65) *
                        Math.exp(-t / (deep ? 0.016 : 0.008)) *
                        (deep ? 0.2 : 0.13),
                );
            }

            break;
        }

        case 'pop': {
            let phase = 0;

            for (let j = 0; j < RATE * 0.12; j++) {
                const t = j / RATE;
                const freq = 520 + 500 * Math.min(1, t / 0.04);
                phase += (2 * Math.PI * freq) / RATE;
                add(
                    begin + j,
                    Math.sin(phase) *
                        Math.exp(-t / 0.035) *
                        Math.min(1, t / 0.002) *
                        0.14,
                    0,
                    0.3,
                );
            }

            break;
        }

        case 'whoosh': {
            const length = RATE * 0.6;
            let low = 0;

            for (let j = 0; j < length; j++) {
                const t = j / length;
                const env = Math.sin(Math.PI * t) ** 2;
                const cutoff = 0.02 + 0.25 * t;
                low += cutoff * (noise() - low);
                add(
                    begin + j - Math.floor(length / 2),
                    low * env * 0.5,
                    Math.sin(t * Math.PI) * 0.4 - 0.2,
                    0.4,
                );
            }

            break;
        }
    }
}

function renderCues(): void {
    for (const scene of schedule(SCENE_ORDER)) {
        for (const cue of CUES[scene.id] ?? []) {
            renderCue((scene.from + cue.frame) / FPS, cue.kind);
        }
    }
}

/** A small Schroeder reverb over the send bus. */
function renderReverb(): void {
    const combs = [1557, 1617, 1491, 1422].map((delay) => ({
        buffer: new Float32Array(delay),
        index: 0,
    }));
    const allpasses = [225, 556].map((delay) => ({
        buffer: new Float32Array(delay),
        index: 0,
    }));

    for (let i = 0; i < LENGTH; i++) {
        const input = reverbSend[i];
        let out = 0;

        for (const comb of combs) {
            const delayed = comb.buffer[comb.index];
            comb.buffer[comb.index] = input + delayed * 0.8;
            comb.index = (comb.index + 1) % comb.buffer.length;
            out += delayed;
        }

        for (const allpass of allpasses) {
            const delayed = allpass.buffer[allpass.index];
            allpass.buffer[allpass.index] = out + delayed * 0.5;
            allpass.index = (allpass.index + 1) % allpass.buffer.length;
            out = delayed - out * 0.5;
        }

        left[i] += out * 0.16;
        right[i] += out * 0.16 * (i % 2 === 0 ? 1 : 0.98);
    }
}

function writeWav(file: string): void {
    let peak = 0;

    for (let i = 0; i < LENGTH; i++) {
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    }

    const gain = peak > 0 ? 0.89 / peak : 1;
    const data = Buffer.alloc(LENGTH * 4);

    for (let i = 0; i < LENGTH; i++) {
        // Soft clip keeps any stray peak round.
        const l = Math.tanh(left[i] * gain * 1.1) / Math.tanh(1.1);
        const r = Math.tanh(right[i] * gain * 1.1) / Math.tanh(1.1);
        data.writeInt16LE(Math.round(l * 32_767), i * 4);
        data.writeInt16LE(Math.round(r * 32_767), i * 4 + 2);
    }

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);

    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.concat([header, data]));
}

renderPad();
renderPluck();
renderBass();
renderDrums();
renderCues();
renderReverb();

const output = path.resolve(import.meta.dirname, '../public/music.wav');
writeWav(output);
console.log(`${output} (${DURATION.toFixed(2)} s)`);
