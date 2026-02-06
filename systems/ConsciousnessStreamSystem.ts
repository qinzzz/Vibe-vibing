import { LAYOUT_CONSTANTS, STREAM_SOURCE } from '../constants';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';
import { System } from '../core/types';

type StreamFragmentState = 'flowing' | 'selected' | 'consumed';
type ParticleLayer = 'far' | 'mid' | 'near';

interface StreamFragment {
    id: string;
    text: string;
    words: StreamWord[];
    x: number;
    y: number;
    vx: number; // px/sec
    vy: number; // px/sec
    age: number;
    fadeIn: number;
    depth: number;
    fontSize: number;
    width: number;
    height: number;
    baseRotation: number;
    rotationWobbleAmp: number;
    rotationWobbleSpeed: number;
    rotationPhase: number;
    wormGlow: number;
    isHovered: boolean;
    hoveredWordIndex: number | null;
    state: StreamFragmentState;
}

interface StreamWord {
    text: string;
    width: number;
    xOffset: number;
    consumed: boolean;
}

interface StreamParticle {
    id: string;
    x: number;
    y: number;
    vx: number; // px/sec
    vy: number; // px/sec
    age: number;
    lifetime: number;
    size: number;
    depth: number;
    layer: ParticleLayer;
    baseAlpha: number;
    speedScale: number;
    orbitPhase: number;
    orbitSpeed: number;
    orbitAmp: number;
    twinklePhase: number;
    hueShift: number;
    wormGlow: number;
}

interface StreamEddy {
    id: string;
    x: number;
    y: number;
    radius: number;
    strength: number;
    duration: number;
    age: number;
    spin: 1 | -1;
}

interface ActiveEatTarget {
    fragmentId: string;
    startWord: number;
    endWord: number;
}

export class ConsciousnessStreamSystem implements System {
    private engine!: Engine;
    private fragments: StreamFragment[] = [];
    private particles: StreamParticle[] = [];
    private eddies: StreamEddy[] = [];

    private streamBaseY = 0;
    private fragmentSpawnTimer = 0;
    private particleSpawnTimer = 0;
    private eddyTimer = 0;
    private idCounter = 0;
    private warmupElapsed = 0;

    private activeEatTarget: ActiveEatTarget | null = null;

    private readonly FRAGMENT_SPAWN_MIN = 1.25;
    private readonly FRAGMENT_SPAWN_MAX = 2.15;
    private readonly PARTICLE_SPAWN_MIN = 0.02;
    private readonly PARTICLE_SPAWN_MAX = 0.08;
    private readonly EAT_DISTANCE = 70;
    private readonly WORM_INFLUENCE_RADIUS = 180;
    private readonly WARMUP_DURATION = 14; // seconds

    init(engine: Engine) {
        this.engine = engine;
        this.streamBaseY = engine.activeWorm?.corePos.y ?? engine.cameraPos.y;
        this.fragmentSpawnTimer = this.randomRange(this.FRAGMENT_SPAWN_MIN, this.FRAGMENT_SPAWN_MAX);
        this.particleSpawnTimer = 0;
        this.eddyTimer = this.randomRange(10, 20);
        this.seedInitialPopulation();

        this.engine.events.on('INPUT_START', this.handleInput);
    }

    update(dt: number) {
        const dtSec = Math.max(0.001, dt / 1000);
        this.warmupElapsed += dtSec;
        const step = dt / 16.66;
        const t = performance.now() * 0.001;
        const streamWidth = this.getStreamWidth();

        this.updateHoverState(t, streamWidth);

        const targetFragments = this.getTargetFragmentCount();
        this.fragmentSpawnTimer -= dtSec;
        while (this.fragmentSpawnTimer <= 0) {
            if (this.countActiveFragments() < targetFragments) {
                this.spawnFragment(t, false);
            }
            this.fragmentSpawnTimer += this.randomRange(this.FRAGMENT_SPAWN_MIN, this.FRAGMENT_SPAWN_MAX);
        }

        const targetParticles = this.getTargetParticleCount();
        this.particleSpawnTimer -= dtSec;
        while (this.particles.length < targetParticles && this.particleSpawnTimer <= 0) {
            this.spawnParticle(t, false);
            this.particleSpawnTimer += this.randomRange(this.PARTICLE_SPAWN_MIN, this.PARTICLE_SPAWN_MAX);
        }

        this.eddyTimer -= dtSec;
        if (this.eddyTimer <= 0) {
            this.spawnEddy(t, streamWidth);
            this.eddyTimer = this.randomRange(10, 20);
        }

        this.updateEddies(dtSec);
        this.updateFragments(dtSec, step, t, streamWidth);
        this.resolveFragmentSpacing(step);
        this.updateParticles(dtSec, step, t, streamWidth);

        this.fragments = this.fragments.filter(fragment => !this.shouldCullFragment(fragment));
        this.particles = this.particles.filter(particle => !this.shouldCullParticle(particle, streamWidth, t));

        if (this.particles.length > targetParticles + 18) {
            this.particles.sort((a, b) => b.age - a.age);
            this.particles.length = targetParticles + 18;
        }
    }

    draw(ctx: CanvasRenderingContext2D) {
        const t = performance.now() * 0.001;
        const streamWidth = this.getStreamWidth();

        this.drawStreamBody(ctx, t, streamWidth);
        this.drawParticles(ctx, t, streamWidth);
        this.drawFragments(ctx, t, streamWidth);
    }

    cleanup() {
        this.engine.events.off('INPUT_START', this.handleInput);
        this.fragments = [];
        this.particles = [];
        this.eddies = [];
        this.activeEatTarget = null;
    }

    private handleInput = (pos: { x: number; y: number }) => {
        const t = performance.now() * 0.001;
        const hit = this.getWordHit(pos.x, pos.y, t, 6);
        if (!hit) return;

        const range = this.pickWordRangeToEat(hit.fragment, hit.wordIndex);
        if (!range) return;
        this.activeEatTarget = {
            fragmentId: hit.fragment.id,
            startWord: range.startWord,
            endWord: range.endWord
        };

        hit.fragment.isHovered = true;
        hit.fragment.hoveredWordIndex = hit.wordIndex;
    };

    private seedInitialPopulation() {
        const t = performance.now() * 0.001;
        const initialFragments = Math.round(this.getBaseFragmentCount() * 0.9);
        let guard = 0;
        while (this.countActiveFragments() < initialFragments && guard < initialFragments * 14) {
            this.spawnFragment(t, true);
            guard++;
        }

        const initialParticles = Math.round(this.getBaseParticleCount() * 0.85);
        for (let i = 0; i < initialParticles; i++) {
            this.spawnParticle(t, true);
        }
    }

    private updateHoverState(t: number, streamWidth: number) {
        const mouse = this.engine.mousePos;

        for (const fragment of this.fragments) {
            fragment.isHovered = false;
            fragment.hoveredWordIndex = null;
        }

        const hit = this.getWordHit(mouse.x, mouse.y, t, 4, streamWidth);
        const hoveredAny = Boolean(hit);
        if (hit) {
            hit.fragment.isHovered = true;
            hit.fragment.hoveredWordIndex = hit.wordIndex;
        }

        // Stream runs before BackgroundSystem; Background ORs this flag instead of replacing it.
        this.engine.blobState.isHoveringEdible = hoveredAny;
    }

    private updateEddies(dtSec: number) {
        this.eddies = this.eddies.filter(eddy => {
            eddy.age += dtSec;
            return eddy.age < eddy.duration;
        });
    }

    private updateFragments(dtSec: number, step: number, t: number, streamWidth: number) {
        for (const fragment of this.fragments) {
            if (fragment.state === 'consumed') continue;

            fragment.age += dtSec;

            const flow = this.sampleFlow(fragment.x, fragment.y, t, streamWidth, fragment.depth);
            const velocityLerp = this.clamp(0.055 * step, 0, 1);
            fragment.vx += (flow.vx - fragment.vx) * velocityLerp;
            fragment.vy += (flow.vy - fragment.vy) * velocityLerp;

            this.applyEddyInfluence(fragment, step, 1.0);
            const wormInfluence = this.applyWormInfluence(fragment, step, 0.85);
            fragment.wormGlow += (wormInfluence - fragment.wormGlow) * this.clamp(0.1 * step, 0, 1);

            fragment.x += fragment.vx * dtSec;
            fragment.y += fragment.vy * dtSec;
        }

        this.resolveActiveEatTarget(t);
    }

    private resolveFragmentSpacing(step: number) {
        const active = this.fragments.filter(fragment => fragment.state !== 'consumed');

        for (let i = 0; i < active.length; i++) {
            for (let j = i + 1; j < active.length; j++) {
                const a = active[i];
                const b = active[j];

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.hypot(dx, dy);
                const minDistance = Math.max(84, (a.width + b.width) * 0.26);
                if (dist < 0.001 || dist >= minDistance) continue;

                const overlap = minDistance - dist;
                const nx = dx / dist;
                const ny = dy / dist;
                const push = overlap * 0.03 * step;

                a.vx -= nx * push;
                b.vx += nx * push;
                a.vy -= ny * push * 1.25;
                b.vy += ny * push * 1.25;
            }
        }
    }

    private updateParticles(dtSec: number, step: number, t: number, streamWidth: number) {
        for (const particle of this.particles) {
            particle.age += dtSec;

            const flow = this.sampleFlow(particle.x, particle.y, t, streamWidth, particle.depth * 0.92);
            const desiredVx = flow.vx * (0.52 + particle.depth * 0.21);
            const desiredVy = flow.vy * (0.5 + particle.depth * 0.17);
            const velocityLerp = this.clamp(0.05 * step, 0, 1);
            particle.vx += (desiredVx - particle.vx) * velocityLerp;
            particle.vy += (desiredVy - particle.vy) * velocityLerp;

            this.applyEddyInfluence(particle, step, 0.5);
            const wormInfluence = this.applyWormInfluence(particle, step, 0.42);
            particle.wormGlow += (wormInfluence - particle.wormGlow) * this.clamp(0.09 * step, 0, 1);

            particle.x += particle.vx * dtSec;
            particle.y += particle.vy * dtSec;
        }
    }

    private drawStreamBody(ctx: CanvasRenderingContext2D, t: number, streamWidth: number) {
        const left = this.engine.cameraPos.x - this.engine.width / 2;
        const right = this.engine.cameraPos.x + this.engine.width / 2;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const radius = streamWidth * 0.58;

        for (let x = left - 180; x <= right + 180; x += 96) {
            const centerY = this.centerlineY(x, t);
            const gradient = ctx.createRadialGradient(x, centerY, 0, x, centerY, radius);
            gradient.addColorStop(0, 'rgba(98, 164, 228, 0.06)');
            gradient.addColorStop(0.42, 'rgba(78, 128, 182, 0.024)');
            gradient.addColorStop(1, 'rgba(70, 112, 162, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, centerY, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        const layers = [
            { offset: -streamWidth * 0.18, width: 1.2, alpha: 0.13, hue: 205 },
            { offset: -streamWidth * 0.08, width: 1.5, alpha: 0.16, hue: 202 },
            { offset: streamWidth * 0.01, width: 1.8, alpha: 0.18, hue: 198 },
            { offset: streamWidth * 0.1, width: 1.4, alpha: 0.14, hue: 200 }
        ];

        for (const layer of layers) {
            ctx.beginPath();
            let first = true;
            for (let x = left - 160; x <= right + 160; x += 24) {
                const jitter = this.valueNoise2D(x * 0.004 + t * 0.08, layer.offset * 0.004 + t * 0.12) * 8;
                const y = this.centerlineY(x, t) + layer.offset + jitter;
                if (first) {
                    ctx.moveTo(x, y);
                    first = false;
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.strokeStyle = `hsla(${layer.hue}, 70%, 66%, ${layer.alpha})`;
            ctx.lineWidth = layer.width;
            ctx.stroke();
        }

        ctx.restore();
    }

    private drawParticles(ctx: CanvasRenderingContext2D, t: number, streamWidth: number) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const warmupFactor = this.getWarmupFactor();

        for (const particle of this.particles) {
            const distanceData = this.getDistanceData(particle.x, particle.y, t, streamWidth);
            if (distanceData.edgeFactor <= 0) continue;

            const lifeOpacity = this.getLifeOpacity(particle.age, particle.lifetime, 0.3, 1.4);
            if (lifeOpacity <= 0) continue;

            const twinkle = 0.9 + Math.sin(t * 1.9 + particle.twinklePhase) * 0.1;
            const baseOpacity = this.lerp(0.17, 0.36, particle.depth);
            const opacity = baseOpacity * lifeOpacity * distanceData.edgeOpacity * twinkle * (1 + particle.wormGlow * 0.28);
            if (opacity < 0.015) continue;

            const radius = particle.size * (0.8 + particle.depth * 0.5);
            const hue = 208 + particle.hueShift;
            ctx.fillStyle = `hsla(${hue}, 76%, 70%, ${this.clamp(opacity, 0, 0.45)})`;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
            ctx.fill();

            if (particle.depth > 0.65 && warmupFactor > 0.45) {
                const trailLen = this.clamp(Math.hypot(particle.vx, particle.vy) * 0.04, 1.6, 6);
                const speed = Math.max(0.001, Math.hypot(particle.vx, particle.vy));
                const tx = particle.vx / speed;
                const ty = particle.vy / speed;
                ctx.strokeStyle = `hsla(${hue}, 70%, 72%, ${this.clamp(opacity * 0.55, 0, 0.26)})`;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(particle.x, particle.y);
                ctx.lineTo(particle.x - tx * trailLen, particle.y - ty * trailLen);
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    private drawFragments(ctx: CanvasRenderingContext2D, t: number, streamWidth: number) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalCompositeOperation = 'screen';

        for (const fragment of this.fragments) {
            if (fragment.state === 'consumed') continue;

            const distanceData = this.getDistanceData(fragment.x, fragment.y, t, streamWidth);
            if (distanceData.edgeFactor <= 0) continue;

            const fadeInOpacity = this.clamp(fragment.age / fragment.fadeIn, 0, 1);
            if (fadeInOpacity <= 0) continue;

            const baseOpacity = this.lerp(0.4, 0.76, fragment.depth);
            const opacity = baseOpacity
                * fadeInOpacity
                * distanceData.edgeOpacity
                * (1 + fragment.wormGlow * 0.2);
            if (opacity < 0.03) continue;

            const rotation = this.getFragmentRotation(fragment, t);
            const selectedRange = this.activeEatTarget && this.activeEatTarget.fragmentId === fragment.id
                ? { start: this.activeEatTarget.startWord, end: this.activeEatTarget.endWord }
                : null;
            const isSelected = Boolean(selectedRange);
            const hoverBoost = fragment.isHovered ? 0.22 : 0;
            const selectedBoost = isSelected ? 0.36 : 0;
            const finalAlpha = this.clamp(opacity + hoverBoost + selectedBoost, 0, 0.94);

            ctx.save();
            ctx.translate(fragment.x, fragment.y);
            ctx.rotate(rotation);
            ctx.font = `${fragment.fontSize.toFixed(1)}px monospace`;
            ctx.shadowColor = isSelected
                ? `rgba(96, 165, 250, ${this.clamp(finalAlpha * 0.8, 0, 0.65)})`
                : `rgba(186, 205, 224, ${this.clamp(finalAlpha * 0.45, 0, 0.4)})`;
            ctx.shadowBlur = isSelected ? 10 : 5;
            ctx.fillStyle = isSelected
                ? `rgba(191, 219, 254, ${finalAlpha})`
                : fragment.isHovered
                    ? `rgba(147, 197, 253, ${finalAlpha})`
                    : `rgba(238, 244, 249, ${finalAlpha})`;
            const hasConsumedWords = fragment.words.some(word => word.consumed);
            if (!hasConsumedWords) {
                ctx.fillText(fragment.text, 0, 0);
            } else {
                for (const word of fragment.words) {
                    if (word.consumed) continue;
                    ctx.fillText(word.text, word.xOffset, 0);
                }
            }

            // Word-level highlights for interaction while keeping sentence rendered as a coherent line.
            if (fragment.hoveredWordIndex !== null) {
                const hovered = fragment.words[fragment.hoveredWordIndex];
                if (hovered && !hovered.consumed) {
                    ctx.shadowColor = `rgba(125, 177, 245, ${this.clamp(finalAlpha * 0.65, 0, 0.5)})`;
                    ctx.shadowBlur = 7;
                    ctx.fillStyle = `rgba(147, 197, 253, ${this.clamp(finalAlpha, 0, 0.95)})`;
                    ctx.fillText(hovered.text, hovered.xOffset, 0);
                }
            }

            if (selectedRange) {
                for (let wordIndex = selectedRange.start; wordIndex <= selectedRange.end; wordIndex++) {
                    const word = fragment.words[wordIndex];
                    if (!word || word.consumed) continue;
                    ctx.shadowColor = `rgba(96, 165, 250, ${this.clamp(finalAlpha * 0.78, 0, 0.62)})`;
                    ctx.shadowBlur = 9;
                    ctx.fillStyle = `rgba(191, 219, 254, ${this.clamp(finalAlpha, 0, 0.95)})`;
                    ctx.fillText(word.text, word.xOffset, 0);
                }
            }
            ctx.restore();
        }

        ctx.restore();
    }

    private spawnFragment(t: number, scatterAcrossViewport: boolean) {
        const streamWidth = this.getStreamWidth();
        const halfWidth = streamWidth * 0.5;
        const text = this.pickStreamChunkText();
        const fontSize = this.randomRange(
            Math.max(12, LAYOUT_CONSTANTS.FONT_SIZE - 3),
            LAYOUT_CONSTANTS.FONT_SIZE
        );
        const wordLayout = this.layoutFragmentWords(text, fontSize);
        const width = wordLayout.totalWidth;

        let x = 0;
        let y = 0;
        let placed = false;

        for (let attempt = 0; attempt < 7; attempt++) {
            x = scatterAcrossViewport
                ? this.randomRange(
                    this.engine.cameraPos.x - this.engine.width * 0.82,
                    this.engine.cameraPos.x + this.engine.width * 0.82
                )
                : this.engine.cameraPos.x - this.engine.width / 2 - this.randomRange(120, 320);

            const centerY = this.centerlineY(x, t);
            y = centerY + this.biasedRange(-halfWidth, halfWidth);

            if (!this.isCrowdedAt(x, y, Math.max(82, width * 0.52))) {
                placed = true;
                break;
            }
        }

        if (!placed) return;

        const depth = Math.pow(Math.random(), 0.9);
        const fragment: StreamFragment = {
            id: `stream-fragment-${this.idCounter++}`,
            text,
            x,
            y,
            vx: this.randomRange(26, 52) * (0.78 + depth * 0.42),
            vy: this.randomRange(-4, 4),
            age: scatterAcrossViewport ? this.randomRange(0, 18) : 0,
            fadeIn: 0.5,
            depth,
            fontSize,
            width,
            height: fontSize * 1.08,
            baseRotation: this.degToRad(this.randomRange(-6, 6)),
            rotationWobbleAmp: this.degToRad(this.randomRange(0.7, 1.9)),
            rotationWobbleSpeed: this.randomRange(0.35, 0.92),
            rotationPhase: this.randomRange(0, Math.PI * 2),
            wormGlow: 0,
            words: wordLayout.words,
            isHovered: false,
            hoveredWordIndex: null,
            state: 'flowing'
        };

        this.fragments.push(fragment);
    }

    private spawnParticle(t: number, scatterAcrossViewport: boolean) {
        const x = scatterAcrossViewport
            ? this.randomRange(
                this.engine.cameraPos.x - this.engine.width * 0.86,
                this.engine.cameraPos.x + this.engine.width * 0.86
            )
            : this.engine.cameraPos.x - this.engine.width / 2 - this.randomRange(60, 220);

        const streamWidth = this.getStreamWidth();
        const halfWidth = streamWidth * 0.5;
        const centerY = this.centerlineY(x, t);
        const y = centerY + this.biasedRange(-halfWidth, halfWidth);
        const depth = Math.pow(Math.random(), 1.02);
        const speedScale = this.randomRange(0.74, 1.2);
        const layer: ParticleLayer = depth > 0.72 ? 'near' : depth > 0.4 ? 'mid' : 'far';
        const baseAlpha = this.lerp(0.08, 0.22, depth);

        const lifetime = this.randomRange(16, 30);

        const particle: StreamParticle = {
            id: `stream-particle-${this.idCounter++}`,
            x,
            y,
            vx: this.randomRange(18, 34) * (0.66 + depth * 0.25),
            vy: 0,
            age: scatterAcrossViewport ? this.randomRange(0, lifetime * 0.8) : 0,
            lifetime,
            size: this.randomRange(1, 2.6),
            depth,
            layer,
            baseAlpha,
            speedScale,
            orbitPhase: this.randomRange(0, Math.PI * 2),
            orbitSpeed: this.randomRange(1.1, 2.2),
            orbitAmp: this.randomRange(0.5, 2.4),
            twinklePhase: this.randomRange(0, Math.PI * 2),
            hueShift: this.randomRange(-8, 8),
            wormGlow: 0
        };

        this.particles.push(particle);
    }

    private spawnEddy(t: number, streamWidth: number) {
        const x = this.randomRange(
            this.engine.cameraPos.x - this.engine.width * 0.24,
            this.engine.cameraPos.x + this.engine.width * 0.24
        );
        const y = this.centerlineY(x, t) + this.biasedRange(-streamWidth * 0.22, streamWidth * 0.22);

        this.eddies.push({
            id: `stream-eddy-${this.idCounter++}`,
            x,
            y,
            radius: this.randomRange(86, 148),
            strength: this.randomRange(0.9, 2.0),
            duration: this.randomRange(1.7, 2.3),
            age: 0,
            spin: Math.random() > 0.5 ? 1 : -1
        });
    }

    private shouldCullFragment(fragment: StreamFragment) {
        if (fragment.state === 'consumed') return true;

        const screenX = this.toScreenX(fragment.x);
        const screenY = this.toScreenY(fragment.y);
        if (screenX > this.engine.width + 760) return true;
        if (screenX < -960) return true;
        if (screenY > this.engine.height + 560) return true;
        if (screenY < -560) return true;

        return false;
    }

    private shouldCullParticle(particle: StreamParticle, streamWidth: number, t: number) {
        if (particle.age >= particle.lifetime) return true;

        const screenX = this.toScreenX(particle.x);
        if (screenX > this.engine.width + 240) return true;
        if (screenX < -300) return true;

        const distanceData = this.getDistanceData(particle.x, particle.y, t, streamWidth);
        return distanceData.edgeFactor <= 0 && particle.age > 0.9;
    }

    private applyEddyInfluence(
        body: { x: number; y: number; vx: number; vy: number },
        step: number,
        scale: number
    ) {
        for (const eddy of this.eddies) {
            const dx = body.x - eddy.x;
            const dy = body.y - eddy.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 0.001 || dist >= eddy.radius) continue;

            const influence = Math.pow(1 - dist / eddy.radius, 2);
            const tangentX = (-dy / dist) * eddy.spin;
            const tangentY = (dx / dist) * eddy.spin;
            const push = eddy.strength * influence * step * scale;
            body.vx += tangentX * push;
            body.vy += tangentY * push;
        }
    }

    private applyWormInfluence(
        body: { x: number; y: number; vx: number; vy: number },
        step: number,
        scale: number
    ) {
        let maxInfluence = 0;
        for (const worm of this.engine.wormState.worms.values()) {
            const dx = worm.corePos.x - body.x;
            const dy = worm.corePos.y - body.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 0.001 || dist >= this.WORM_INFLUENCE_RADIUS) continue;

            const influence = 1 - dist / this.WORM_INFLUENCE_RADIUS;
            maxInfluence = Math.max(maxInfluence, influence);

            const nx = dx / dist;
            const ny = dy / dist;
            const pull = 2.2 * influence * step * scale;
            body.vx += nx * pull;
            body.vy += ny * pull;

            const slowdown = this.clamp(1 - influence * 0.028 * scale * step, 0.87, 1);
            body.vx *= slowdown;
            body.vy *= this.clamp(1 - influence * 0.014 * scale * step, 0.9, 1);
        }

        return maxInfluence;
    }

    private sampleFlow(x: number, y: number, t: number, streamWidth: number, depth: number) {
        const centerY = this.centerlineY(x, t);
        const halfWidth = streamWidth * 0.5;
        const signedDistance = y - centerY;
        const distance = Math.abs(signedDistance);
        const edgeFactor = this.clamp(1 - distance / halfWidth, 0, 1);

        const yAhead = this.centerlineY(x + 42, t);
        const yBehind = this.centerlineY(x - 42, t);
        const slope = (yAhead - yBehind) / 84;
        const tangentLen = Math.hypot(1, slope);
        const tx = 1 / tangentLen;
        const ty = slope / tangentLen;

        const speedBase = this.lerp(28, 50, depth) * this.lerp(0.74, 1.16, edgeFactor);
        const speedNoise = this.valueNoise2D(x * 0.003 + t * 0.12, y * 0.0018 - t * 0.06) * 8.2;
        const streamPulse = this.valueNoise2D(x * 0.0013 - t * 0.03, t * 0.18 + depth * 4.9) * 4.6;
        const speed = speedBase + speedNoise + streamPulse;

        const crossNoise = this.valueNoise2D(x * 0.0022 + t * 0.14 + 17.3, y * 0.0031 - t * 0.1 + 5.2)
            * this.lerp(0.8, 6.8, edgeFactor);
        const centerPull = -signedDistance * 0.13;
        const crossVelocity = crossNoise + centerPull;

        const vx = tx * speed - ty * crossVelocity;
        const vy = ty * speed + tx * crossVelocity;

        return { vx, vy, edgeFactor, centerY };
    }

    private getDistanceData(x: number, y: number, t: number, streamWidth: number) {
        const centerY = this.centerlineY(x, t);
        const halfWidth = streamWidth * 0.5;
        const distanceFromCenter = Math.abs(y - centerY);
        const edgeFactor = this.clamp(1 - distanceFromCenter / halfWidth, 0, 1);
        const edgeOpacity = this.clamp(edgeFactor * 0.9, 0, 0.9);
        return { centerY, edgeFactor, edgeOpacity };
    }

    private getLifeOpacity(age: number, lifetime: number, fadeIn: number, fadeOut: number) {
        const fadeInFactor = this.clamp(age / fadeIn, 0, 1);
        const fadeOutFactor = this.clamp((lifetime - age) / fadeOut, 0, 1);
        return fadeInFactor * fadeOutFactor;
    }

    private centerlineY(worldX: number, t: number) {
        return this.streamBaseY
            + Math.sin(worldX * 0.002 + t * 0.15) * 40
            + this.valueNoise1D(worldX * 0.001 + t * 0.05) * 30;
    }

    private getFragmentRotation(fragment: StreamFragment, t: number) {
        return fragment.baseRotation
            + Math.sin(t * fragment.rotationWobbleSpeed + fragment.rotationPhase) * fragment.rotationWobbleAmp;
    }

    private getWordHit(
        px: number,
        py: number,
        t: number,
        padding = 0,
        streamWidthOverride?: number
    ) {
        let best: { fragment: StreamFragment; wordIndex: number } | null = null;
        let bestScore = Number.NEGATIVE_INFINITY;
        const streamWidth = streamWidthOverride ?? this.getStreamWidth();

        for (const fragment of this.fragments) {
            if (fragment.state === 'consumed') continue;
            const edgeFactor = this.getDistanceData(fragment.x, fragment.y, t, streamWidth).edgeFactor;
            if (edgeFactor <= 0.06) continue;

            const rotation = this.getFragmentRotation(fragment, t);
            const local = this.worldToFragmentLocal(px, py, fragment, rotation);
            if (Math.abs(local.y) > fragment.height * 0.5 + padding) continue;

            for (let wordIndex = 0; wordIndex < fragment.words.length; wordIndex++) {
                const word = fragment.words[wordIndex];
                if (word.consumed) continue;

                const halfW = word.width * 0.5 + padding;
                if (local.x < word.xOffset - halfW || local.x > word.xOffset + halfW) continue;

                const score = fragment.depth * 1.4 - fragment.age * 0.01;
                if (score > bestScore) {
                    best = { fragment, wordIndex };
                    bestScore = score;
                }
            }
        }

        return best;
    }

    private worldToFragmentLocal(px: number, py: number, fragment: StreamFragment, rotation: number) {
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const dx = px - fragment.x;
        const dy = py - fragment.y;
        return {
            x: dx * cos - dy * sin,
            y: dx * sin + dy * cos
        };
    }

    private pickWordRangeToEat(fragment: StreamFragment, wordIndex: number) {
        if (fragment.words[wordIndex]?.consumed) return null;

        let startWord = wordIndex;
        let endWord = wordIndex;

        // Usually one word, occasionally two adjacent words.
        if (Math.random() < 0.22) {
            const neighbors: Array<{ startWord: number; endWord: number }> = [];
            if (wordIndex > 0 && !fragment.words[wordIndex - 1].consumed) {
                neighbors.push({ startWord: wordIndex - 1, endWord: wordIndex });
            }
            if (wordIndex < fragment.words.length - 1 && !fragment.words[wordIndex + 1].consumed) {
                neighbors.push({ startWord: wordIndex, endWord: wordIndex + 1 });
            }
            if (neighbors.length > 0) {
                const pick = neighbors[this.randomInt(0, neighbors.length - 1)];
                startWord = pick.startWord;
                endWord = pick.endWord;
            }
        }

        return { startWord, endWord };
    }

    private resolveActiveEatTarget(t: number) {
        const target = this.activeEatTarget;
        if (!target) return;

        const fragment = this.fragments.find(item => item.id === target.fragmentId && item.state !== 'consumed');
        if (!fragment) {
            this.activeEatTarget = null;
            return;
        }
        if (this.isWordRangeConsumed(fragment, target.startWord, target.endWord)) {
            this.activeEatTarget = null;
            return;
        }

        const targetPos = this.getWordRangeWorldCenter(fragment, target.startWord, target.endWord, t);
        const worm = this.engine.activeWorm;
        const dx = worm.corePos.x - targetPos.x;
        const dy = worm.corePos.y - targetPos.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= this.EAT_DISTANCE) return;

        this.markWordsConsumed(fragment, target.startWord, target.endWord);
        const text = fragment.words
            .slice(target.startWord, target.endWord + 1)
            .map(word => word.text)
            .join(' ');
        this.engine.events.emit(EVENTS.TOKEN_EATEN, {
            id: `${fragment.id}:${target.startWord}-${target.endWord}:${this.idCounter++}`,
            text,
            pos: targetPos
        });
        this.activeEatTarget = null;

        if (fragment.words.every(word => word.consumed)) {
            fragment.state = 'consumed';
        }
    }

    private getWordRangeWorldCenter(fragment: StreamFragment, startWord: number, endWord: number, t: number) {
        const rotation = this.getFragmentRotation(fragment, t);
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const localStart = fragment.words[startWord];
        const localEnd = fragment.words[endWord];
        const centerLocalX = ((localStart.xOffset - localStart.width * 0.5) + (localEnd.xOffset + localEnd.width * 0.5)) * 0.5;
        return {
            x: fragment.x + cos * centerLocalX,
            y: fragment.y + sin * centerLocalX
        };
    }

    private isWordRangeConsumed(fragment: StreamFragment, startWord: number, endWord: number) {
        for (let i = startWord; i <= endWord; i++) {
            if (!fragment.words[i]?.consumed) return false;
        }
        return true;
    }

    private markWordsConsumed(fragment: StreamFragment, startWord: number, endWord: number) {
        for (let i = startWord; i <= endWord; i++) {
            if (fragment.words[i]) {
                fragment.words[i].consumed = true;
            }
        }
    }

    private isCrowdedAt(x: number, y: number, minDistance: number) {
        for (const fragment of this.fragments) {
            if (fragment.state === 'consumed') continue;
            const dx = fragment.x - x;
            const dy = fragment.y - y;
            if (dx * dx + dy * dy < minDistance * minDistance) {
                return true;
            }
        }

        return false;
    }

    private toScreenX(worldX: number) {
        return worldX - this.engine.cameraPos.x + this.engine.width / 2;
    }

    private toScreenY(worldY: number) {
        return worldY - this.engine.cameraPos.y + this.engine.height / 2;
    }

    private getStreamWidth() {
        const base = this.clamp(this.engine.height * 0.35, 300, 450);
        const t = performance.now() * 0.001;
        const animated = base + Math.sin(t * 0.12) * 14 + this.valueNoise1D(t * 0.18) * 11;
        return this.clamp(animated, 300, 450);
    }

    private getBaseFragmentCount() {
        return Math.round(this.clamp(this.engine.width * 0.0074, 8, 16));
    }

    private getBaseParticleCount() {
        return Math.round(this.clamp(this.engine.width * 0.1, 95, 180));
    }

    private getTargetFragmentCount() {
        return Math.round(this.getBaseFragmentCount() * this.lerp(0.65, 1, this.getWarmupFactor()));
    }

    private getTargetParticleCount() {
        return Math.round(this.getBaseParticleCount() * this.lerp(0.52, 1, this.getWarmupFactor()));
    }

    private getWarmupFactor() {
        return this.clamp(this.warmupElapsed / this.WARMUP_DURATION, 0, 1);
    }

    private countActiveFragments() {
        return this.fragments.reduce((acc, fragment) => acc + (fragment.state === 'consumed' ? 0 : 1), 0);
    }

    private pickStreamChunkText() {
        if (STREAM_SOURCE.length === 0) {
            return 'ambient fragment';
        }

        const source = STREAM_SOURCE[this.randomInt(0, STREAM_SOURCE.length - 1)];
        const words = source.text.trim().split(/\s+/).filter(Boolean);
        if (words.length <= 2) return source.text;

        const roll = Math.random();
        let chunkLength = 3;
        if (roll < 0.18) {
            // full or near-full quote occasionally
            chunkLength = this.randomInt(Math.max(2, words.length - 2), words.length);
        } else if (roll < 0.48) {
            // medium phrases
            chunkLength = this.randomInt(4, Math.min(7, words.length));
        } else if (roll < 0.82) {
            // short fragments
            chunkLength = this.randomInt(2, Math.min(4, words.length));
        } else {
            // long sweep fragments
            chunkLength = this.randomInt(Math.min(6, words.length), Math.min(10, words.length));
        }

        chunkLength = Math.max(2, Math.min(words.length, Math.floor(chunkLength)));
        const maxStart = Math.max(0, words.length - chunkLength);
        const start = maxStart > 0 ? this.randomInt(0, maxStart) : 0;
        return words.slice(start, start + chunkLength).join(' ');
    }

    private layoutFragmentWords(text: string, fontSize: number) {
        const ctx = this.engine.ctx;
        ctx.save();
        ctx.font = `${fontSize.toFixed(1)}px monospace`;
        const words = text.trim().split(/\s+/).filter(Boolean);
        const wordMetrics = words.map(word => ({
            text: word,
            width: ctx.measureText(word).width
        }));
        const spaceWidth = ctx.measureText(' ').width;
        const totalWidth = wordMetrics.reduce(
            (acc, word, idx) => acc + word.width + (idx < wordMetrics.length - 1 ? spaceWidth : 0),
            0
        );

        let cursor = -totalWidth / 2;
        const layoutWords: StreamWord[] = wordMetrics.map((word, idx) => {
            const xOffset = cursor + word.width / 2;
            cursor += word.width + (idx < wordMetrics.length - 1 ? spaceWidth : 0);
            return {
                text: word.text,
                width: word.width,
                xOffset,
                consumed: false
            };
        });

        ctx.restore();
        return {
            words: layoutWords,
            totalWidth
        };
    }

    private biasedRange(min: number, max: number) {
        // Triangular sampling biases toward the stream center and avoids rigid lane fills.
        const centered = Math.random() + Math.random() - 1;
        const half = (max - min) * 0.5;
        const midpoint = (min + max) * 0.5;
        return midpoint + centered * half;
    }

    private valueNoise1D(x: number) {
        const xi = Math.floor(x);
        const xf = x - xi;
        const a = this.hash1D(xi);
        const b = this.hash1D(xi + 1);
        const t = xf * xf * (3 - 2 * xf);
        return this.lerp(a, b, t);
    }

    private valueNoise2D(x: number, y: number) {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const xf = x - xi;
        const yf = y - yi;

        const v00 = this.hash2D(xi, yi);
        const v10 = this.hash2D(xi + 1, yi);
        const v01 = this.hash2D(xi, yi + 1);
        const v11 = this.hash2D(xi + 1, yi + 1);

        const u = xf * xf * (3 - 2 * xf);
        const v = yf * yf * (3 - 2 * yf);

        const nx0 = this.lerp(v00, v10, u);
        const nx1 = this.lerp(v01, v11, u);
        return this.lerp(nx0, nx1, v);
    }

    private hash1D(n: number) {
        const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
        return (s - Math.floor(s)) * 2 - 1;
    }

    private hash2D(x: number, y: number) {
        const s = Math.sin(x * 127.1 + y * 311.7 + 74.7) * 43758.5453123;
        return (s - Math.floor(s)) * 2 - 1;
    }

    private degToRad(deg: number) {
        return (deg * Math.PI) / 180;
    }

    private randomRange(min: number, max: number) {
        return min + Math.random() * (max - min);
    }

    private randomInt(min: number, max: number) {
        return Math.floor(this.randomRange(min, max + 1));
    }

    private clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
    }

    private lerp(a: number, b: number, t: number) {
        return a + (b - a) * this.clamp(t, 0, 1);
    }
}
