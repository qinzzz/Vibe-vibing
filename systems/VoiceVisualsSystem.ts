import { System } from '../core/types';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';
import { COLORS } from '../constants';

interface VoiceWord {
    id: string;
    text: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    volume: number; // 0-1
    pitch: number;
    age: number;
    life: number;
    color: string;
    size: number;
    state: 'falling' | 'absorbed';
}

export class VoiceVisualsSystem implements System {
    private engine!: Engine;
    private words: VoiceWord[] = [];
    private particles: any[] = []; // For "Particle Stream" effect

    init(engine: Engine) {
        this.engine = engine;
        this.engine.events.on(EVENTS.VOICE_WORD_SPAWNED, this.handleWordSpawn);
        this.engine.events.on(EVENTS.VOICE_PARTICLE_STREAM, this.handleParticleStream);
        this.engine.events.on(EVENTS.VOICE_INTERIM_RESULT, this.handleInterimResult);
    }

    cleanup() {
        this.engine.events.off(EVENTS.VOICE_WORD_SPAWNED, this.handleWordSpawn);
        this.engine.events.off(EVENTS.VOICE_PARTICLE_STREAM, this.handleParticleStream);
        this.engine.events.off(EVENTS.VOICE_INTERIM_RESULT, this.handleInterimResult);
    }

    update(dt: number) {
        const dtSec = dt / 1000;
        const worm = this.engine.activeWorm;
        const targetPos = worm.corePos;

        // Update Words
        this.words = this.words.filter(word => {
            if (word.state === 'absorbed') return false;

            word.age += dtSec;
            if (word.age > word.life) return false;

            // Physics: Gravity towards worm
            const dx = targetPos.x - word.x;
            const dy = targetPos.y - word.y;
            const dist = Math.hypot(dx, dy);

            // Accelerate towards worm based on distance and volume
            // Louder words move faster
            const speed = 200 + (word.volume * 400);

            if (dist > 10) {
                // Gravity towards worm (attraction) - Softened
                const pullStrength = 150 + (word.volume * 300);
                const ax = (dx / dist) * pullStrength;
                const ay = (dy / dist) * pullStrength;

                // Vertical global gravity (falling effect) - More graceful
                const globalGravity = 250;
                word.vy += globalGravity * dtSec;

                word.vx += (ax - word.vx) * 0.05;
                word.vy += (ay - word.vy) * 0.05;

                // Add some noise/jitter based on volume ("shout" jitters more)
                const jitter = word.volume * 8;
                word.x += word.vx * dtSec + (Math.random() - 0.5) * jitter;
                word.y += word.vy * dtSec + (Math.random() - 0.5) * jitter;
            }

            // Check Collision with Worm
            if (dist < 60) { // Consumption radius
                this.consumeWord(word);
                return false;
            }

            return true;
        });

        // Update Particles
        this.particles = this.particles.filter(p => {
            p.age += dtSec;
            p.x += p.vx * dtSec;
            p.y += p.vy * dtSec;
            p.alpha -= dtSec * 0.5;
            return p.alpha > 0;
        });
    }

    draw(ctx: CanvasRenderingContext2D) {
        // Draw Particles
        ctx.save();
        for (const p of this.particles) {
            ctx.fillStyle = `rgba(200, 200, 255, ${p.alpha})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // Draw Words
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const word of this.words) {
            ctx.save();
            ctx.translate(word.x, word.y);

            // Whisper vs Shout Visuals
            // Whisper: Thin, Blur
            // Shout: Bold, Shake

            const fontSize = word.size;
            const isShout = word.volume > 0.6;
            const isWhisper = word.volume < 0.2;

            let fontStyle = 'normal';
            if (isShout) fontStyle = 'bold';
            if (isWhisper) fontStyle = 'italic'; // or a thin font weight if available

            ctx.font = `${fontStyle} ${fontSize}px monospace`;

            const opacity = Math.min(1, word.life - word.age);

            // Color based on Pitch/Volume
            // The user wants RED or BLUE.
            // Map Pitch (100Hz - 800Hz) to Hue (220 - 0)
            const minPitch = 100;
            const maxPitch = 800;
            const normalizedPitch = Math.max(0, Math.min(1, (word.pitch - minPitch) / (maxPitch - minPitch)));

            // Map to 220 (Blue) or 0 (Red)
            const hue = normalizedPitch > 0.5 ? 0 : 220;

            ctx.fillStyle = `hsla(${hue}, 90%, 65%, ${opacity})`;

            if (isShout) {
                ctx.shadowColor = `hsla(${hue}, 90%, 65%, 0.7)`;
                ctx.shadowBlur = 10;
                // Jitter rotation
                ctx.rotate((Math.random() - 0.5) * 0.1);
            } else if (isWhisper) {
                ctx.shadowColor = 'rgba(100, 200, 255, 0.3)';
            }

            ctx.fillText(word.text, 0, 0);
            ctx.restore();
        }
        ctx.restore();
    }

    private handleWordSpawn = (data: { text: string, volume: number, pitch: number }) => {
        // Spawn from the top of the viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Use a much larger vertical offset.
        // cameraPos is the center. viewportHeight/2 is the top edge.
        const startX = this.engine.cameraPos.x + (Math.random() - 0.5) * viewportWidth * 1.5;
        const startY = this.engine.cameraPos.y - (viewportHeight / 2) - 1000; // 1000px above the top edge

        // Size based on volume
        const baseSize = 20;
        const size = baseSize + (data.volume * 40);

        this.words.push({
            id: Math.random().toString(),
            text: data.text,
            x: startX,
            y: startY,
            vx: 0,
            vy: 0,
            volume: data.volume,
            pitch: data.pitch,
            age: 0,
            life: 10, // 10 seconds before disappearing if not eaten
            color: '#ffffff',
            size: size,
            state: 'falling'
        });
    };

    private handleParticleStream = (data: { volume: number, pitch: number }) => {
        // Emit particles for breath
        // Only if volume is high enough to register but no word yet? 
        // Or just always trace the voice?
        if (data.volume < 0.05) return;

        const count = Math.floor(data.volume * 5);
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: this.engine.cameraPos.x + (Math.random() - 0.5) * 50,
                y: this.engine.cameraPos.y + (Math.random() - 0.5) * 50,
                vx: (Math.random() - 0.5) * 100,
                vy: (Math.random() - 0.5) * 100,
                alpha: 0.5 + Math.random() * 0.5,
                age: 0,
                size: Math.random() * 3
            });
        }
    }

    private handleInterimResult = (data: { text: string }) => {
        // Just extra visual feedback
        const count = 3;
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: this.engine.cameraPos.x + (Math.random() - 0.5) * 150,
                y: this.engine.cameraPos.y + (Math.random() - 0.5) * 150,
                vx: (Math.random() - 0.5) * 200,
                vy: (Math.random() - 0.5) * 200,
                alpha: 0.8,
                age: 0,
                size: 2 + Math.random() * 2
            });
        }
    }

    private consumeWord(word: VoiceWord) {
        word.state = 'absorbed';
        // Trigger Digestion Logic
        this.engine.events.emit(EVENTS.TOKEN_EATEN, {
            id: word.id,
            text: word.text,
            pos: { x: word.x, y: word.y }
        });

        // Also trigger "Echo" mechanism (Narrative)
        // We'll leave that for the Narrative System integration or DigestionSystem
    }
}
