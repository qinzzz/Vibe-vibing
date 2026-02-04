import { EventBus, EVENTS } from '../core/events';

export class AudioService {
    private audioCtx: AudioContext | null = null;
    private events: EventBus;

    constructor(events: EventBus) {
        this.events = events;
        this.events.on(EVENTS.SFX_MUNCH, this.playMunchSound);
    }

    private initAudio() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    }

    private playMunchSound = () => {
        // Try to play external file first
        const audio = new Audio('/sfx/munch.mp3');
        audio.play().catch(() => {
            // Fallback to procedural if file missing
            this.initAudio();
            if (!this.audioCtx) return;
            const ctx = this.audioCtx;
            if (ctx.state === 'suspended') ctx.resume();

            const bufferSize = ctx.sampleRate * 0.1;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

            const noise = ctx.createBufferSource();
            noise.buffer = buffer;

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1200, ctx.currentTime);
            filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);

            noise.start();
            noise.stop(ctx.currentTime + 0.1);
        });
    };

    cleanup() {
        this.events.off(EVENTS.SFX_MUNCH, this.playMunchSound);
        if (this.audioCtx) {
            this.audioCtx.close();
        }
    }
}
