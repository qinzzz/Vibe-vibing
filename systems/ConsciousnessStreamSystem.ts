import { LAYOUT_CONSTANTS, STREAM_SOURCE } from '../constants';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';
import { System } from '../core/types';

type StreamThought = {
    id: string;
    text: string;
    source: string;
    timestamp: number;
};

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
    maxWidth: number;
}

interface StreamWord {
    text: string;
    width: number;
    xOffset: number;
    yOffset: number;
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
    private streamThoughts: StreamThought[] = [];
    private seenThoughtTexts: Set<string> = new Set();
    private thoughtRefreshTimer: number | null = null;
    private isRefreshingThoughts = false;
    private currentSourceIndex = 0;
    private sources = ['contemporary']; // Unified contemporary text rotation

    private streamBaseY = 0;
    private streamLabelX = 0;
    private fragmentSpawnTimer = 0;
    private particleSpawnTimer = 0;
    private eddyTimer = 0;
    private idCounter = 0;
    private warmupElapsed = 0;

    private activeEatTarget: ActiveEatTarget | null = null;

    private readonly FRAGMENT_SPAWN_MIN = 0.25; // Much closer appearance
    private readonly FRAGMENT_SPAWN_MAX = 0.55;
    private readonly PARTICLE_SPAWN_MIN = 0.02;
    private readonly PARTICLE_SPAWN_MAX = 0.08;
    private readonly EAT_DISTANCE = 70;
    private readonly WORM_INFLUENCE_RADIUS = 180;
    private readonly WARMUP_DURATION = 14; // seconds
    private readonly THOUGHT_REFRESH_MS = 2 * 60 * 60 * 1000;
    private readonly THOUGHT_FETCH_LIMIT = 20;

    init(engine: Engine) {
        this.engine = engine;
        this.initializeThoughtStore();
        const activeWorm = engine.activeWorm;
        const wormBaseY = activeWorm?.corePos.y ?? engine.cameraPos.y;
        const wormHeight = engine.config.coreRadius * (activeWorm?.sizeMultiplier ?? 1);
        this.streamBaseY = wormBaseY + wormHeight * 1.34;
        this.streamLabelX = activeWorm?.corePos.x ?? engine.cameraPos.x;
        this.fragmentSpawnTimer = this.randomRange(this.FRAGMENT_SPAWN_MIN, this.FRAGMENT_SPAWN_MAX);
        this.particleSpawnTimer = 0;
        this.eddyTimer = this.randomRange(10, 20);
        this.seedInitialPopulation();
        this.refreshThoughtsFromSource();
        this.thoughtRefreshTimer = window.setInterval(
            this.refreshThoughtsFromSource,
            this.THOUGHT_REFRESH_MS
        );

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
        this.drawStreamLabel(ctx, t, streamWidth);
    }

    cleanup() {
        this.engine.events.off('INPUT_START', this.handleInput);
        if (this.thoughtRefreshTimer !== null) {
            window.clearInterval(this.thoughtRefreshTimer);
            this.thoughtRefreshTimer = null;
        }
        this.fragments = [];
        this.particles = [];
        this.eddies = [];
        this.activeEatTarget = null;
        this.seenThoughtTexts.clear();
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
                const minDistance = Math.max(110, (a.width + b.width) * 0.35);
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

            // Newspaper font (Stable, legible)
            ctx.font = `normal italic ${fragment.fontSize.toFixed(1)}px monospace`;
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

            // Render stable word positions from the fragment's stored layout
            for (const word of fragment.words) {
                if (word.consumed) continue;
                ctx.fillText(word.text, word.xOffset, word.yOffset);
            }

            // Word-level highlights for interaction while keeping sentence rendered as a coherent line.
            if (fragment.hoveredWordIndex !== null) {
                const hovered = fragment.words[fragment.hoveredWordIndex];
                if (hovered && !hovered.consumed) {
                    ctx.shadowColor = `rgba(125, 177, 245, ${this.clamp(finalAlpha * 0.65, 0, 0.5)})`;
                    ctx.shadowBlur = 7;
                    ctx.fillStyle = `rgba(147, 197, 253, ${this.clamp(finalAlpha, 0, 0.95)})`;
                    ctx.fillText(hovered.text, hovered.xOffset, hovered.yOffset);
                }
            }

            if (selectedRange) {
                for (let wordIndex = selectedRange.start; wordIndex <= selectedRange.end; wordIndex++) {
                    const word = fragment.words[wordIndex];
                    if (!word || word.consumed) continue;
                    ctx.shadowColor = `rgba(96, 165, 250, ${this.clamp(finalAlpha * 0.78, 0, 0.62)})`;
                    ctx.shadowBlur = 9;
                    ctx.fillStyle = `rgba(191, 219, 254, ${this.clamp(finalAlpha, 0, 0.95)})`;
                    ctx.fillText(word.text, word.xOffset, word.yOffset);
                }
            }
            ctx.restore();
        }

        ctx.restore();
    }

    private drawStreamLabel(ctx: CanvasRenderingContext2D, t: number, streamWidth: number) {
        const text = 'STREAM OF CONCIOUSNESS';
        const labelY = this.centerlineY(this.streamLabelX, t) + streamWidth * 0.24 - 4;
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = "italic 16px 'Space Mono'";

        const glyphs = text.split('');
        const tracking = 3.8;
        const widths = glyphs.map(glyph => ctx.measureText(glyph).width);
        const totalWidth = widths.reduce((sum, width) => sum + width, 0) + tracking * Math.max(0, glyphs.length - 1);
        let cursor = -totalWidth / 2;

        for (let i = 0; i < glyphs.length; i++) {
            const glyph = glyphs[i];
            const glyphWidth = widths[i];
            const x = this.streamLabelX + cursor;
            const y = labelY + Math.sin(t * 0.9 + i * 0.44) * 2.1;
            const rotation = this.degToRad(
                Math.sin(t * 0.7 + i * 0.6) * 4 + this.valueNoise1D(i * 0.37 + t * 0.2) * 1.8
            );
            const hue = 198 + Math.sin(i * 0.26 + t * 0.2) * 10;
            const lightness = 68 + Math.sin(t * 1.1 + i * 0.48) * 8;
            const alpha = 0.58 + Math.sin(t * 0.8 + i * 0.31) * 0.09;

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.shadowColor = `hsla(${hue}, 80%, 70%, ${this.clamp(alpha * 0.55, 0, 0.42)})`;
            ctx.shadowBlur = 4;
            ctx.fillStyle = `hsla(${hue}, 78%, ${lightness}%, ${this.clamp(alpha, 0.44, 0.72)})`;
            ctx.fillText(glyph, 0, 0);
            ctx.restore();

            cursor += glyphWidth + tracking;
        }

        ctx.restore();
    }

    private spawnFragment(t: number, scatterAcrossViewport: boolean) {
        const streamWidth = this.getStreamWidth();
        const halfWidth = streamWidth * 0.5;
        const source = this.pickStreamChunk();
        const text = source.text;
        const maxWidth = 200 + Math.random() * 350;

        const fontSize = this.randomRange(
            Math.max(12, LAYOUT_CONSTANTS.FONT_SIZE - 3),
            LAYOUT_CONSTANTS.FONT_SIZE
        );
        const wordLayout = this.layoutFragmentWords(text, fontSize, maxWidth);
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
            y = centerY + this.randomRange(-halfWidth * 0.85, halfWidth * 0.85);

            if (!this.isCrowdedAt(x, y, Math.max(50, width * 0.35))) {
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
            vx: this.randomRange(22, 38) * (0.8 + depth * 0.4),
            vy: this.randomRange(-4, 4),
            age: scatterAcrossViewport ? this.randomRange(0, 18) : 0,
            fadeIn: 0.5,
            depth,
            fontSize,
            width,
            height: fontSize * 1.08,
            baseRotation: this.degToRad(this.randomRange(-24, 24)),
            rotationWobbleAmp: this.degToRad(this.randomRange(2.2, 5.5)),
            rotationWobbleSpeed: this.randomRange(0.35, 0.92),
            rotationPhase: this.randomRange(0, Math.PI * 2),
            wormGlow: 0,
            words: wordLayout.words,
            isHovered: false,
            hoveredWordIndex: null,
            state: 'flowing',
            maxWidth
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
            * this.lerp(3.5, 14.0, edgeFactor);
        const centerPull = -signedDistance * 0.035;
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

            // Check strictly for same "line" placement within crowded X-range
            if (Math.abs(fragment.y - y) < 14 && Math.abs(fragment.x - x) < 220) {
                return true;
            }

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
        const base = this.clamp(this.engine.height * 0.55, 450, 700);
        const t = performance.now() * 0.001;
        const animated = base + Math.sin(t * 0.12) * 14 + this.valueNoise1D(t * 0.18) * 11;
        return this.clamp(animated, 450, 700);
    }

    private getBaseFragmentCount() {
        return Math.round(this.clamp(this.engine.width * 0.0045, 5, 8));
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

    private initializeThoughtStore() {
        this.seenThoughtTexts.clear();
        this.streamThoughts = [];
        // Re-enabled with newspaper/AI prompt seed data
        for (const thought of STREAM_SOURCE) {
            this.addThoughtIfNew({
                id: String(thought.id),
                text: String(thought.text),
                source: String(thought.source),
                timestamp: Number(thought.timestamp)
            });
        }
    }

    private refreshThoughtsFromSource = async () => {
        if (this.isRefreshingThoughts) return;
        this.isRefreshingThoughts = true;

        try {
            // Rotate through sources
            const source = this.sources[this.currentSourceIndex];
            this.currentSourceIndex = (this.currentSourceIndex + 1) % this.sources.length;

            let endpoint = '/api/stream-thoughts';
            if (source === 'contemporary') {
                endpoint = '/api/newspaper-thoughts';
            }

            const response = await fetch(`${endpoint}?limit=${this.THOUGHT_FETCH_LIMIT}`);
            if (!response.ok) return;
            const data = await response.json() as { thoughts?: StreamThought[] };
            const incoming = Array.isArray(data.thoughts) ? data.thoughts : [];
            const beforeCount = this.streamThoughts.length;
            incoming.forEach(thought => this.addThoughtIfNew(thought));
            const appended = this.streamThoughts.length - beforeCount;
            console.log(
                `[STREAM] Thought refresh success (source: ${source}): fetched=${incoming.length}, appended=${appended}, total=${this.streamThoughts.length}`
            );
        } catch (err) {
            console.warn('[STREAM] Thought refresh failed', err);
        } finally {
            this.isRefreshingThoughts = false;
        }
    };

    private addThoughtIfNew(thought: StreamThought) {
        const text = (thought.text || '').trim();
        if (!text) return;

        const dedupeKey = this.normalizeThoughtText(text);
        if (this.seenThoughtTexts.has(dedupeKey)) return;

        this.seenThoughtTexts.add(dedupeKey);
        this.streamThoughts.push({
            id: thought.id || `np-${this.idCounter++}`,
            text,
            source: thought.source || 'Archive',
            timestamp: Number.isFinite(thought.timestamp) ? thought.timestamp : Math.floor(Date.now() / 1000)
        });
    }

    private normalizeThoughtText(text: string) {
        return text.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    private pickStreamChunk(): StreamThought {
        if (this.streamThoughts.length === 0) {
            return {
                id: 'default',
                text: 'ambient fragment',
                source: 'Default',
                timestamp: Date.now()
            };
        }

        return this.streamThoughts[this.randomInt(0, this.streamThoughts.length - 1)];
    }

    private layoutFragmentWords(text: string, fontSize: number, maxWidth: number) {
        const ctx = this.engine.ctx;
        ctx.save();
        ctx.font = `${fontSize.toFixed(1)}px monospace`;

        const words = text.trim().split(/\s+/).filter(Boolean);
        const spaceWidth = ctx.measureText(' ').width;
        const lineHeight = fontSize * 1.2;

        const lines: { words: { text: string; width: number }[]; width: number }[] = [];
        let currentLineWords: { text: string; width: number }[] = [];
        let currentWidth = 0;

        words.forEach(wordText => {
            const wordWidth = ctx.measureText(wordText).width;
            if (currentLineWords.length > 0 && currentWidth + spaceWidth + wordWidth > maxWidth) {
                lines.push({ words: currentLineWords, width: currentWidth });
                currentLineWords = [];
                currentWidth = 0;
            }
            currentLineWords.push({ text: wordText, width: wordWidth });
            currentWidth += wordWidth + (currentLineWords.length > 1 ? spaceWidth : 0);
        });
        if (currentLineWords.length > 0) {
            lines.push({ words: currentLineWords, width: currentWidth });
        }

        const layoutWords: StreamWord[] = [];
        const startY = -(lines.length - 1) * lineHeight / 2;

        lines.forEach((line, lineIdx) => {
            let cursor = -line.width / 2;
            const yOffset = startY + lineIdx * lineHeight;

            line.words.forEach((word, wordIdx) => {
                layoutWords.push({
                    text: word.text,
                    width: word.width,
                    xOffset: cursor + word.width / 2,
                    yOffset,
                    consumed: false
                });
                cursor += word.width + spaceWidth;
            });
        });

        ctx.restore();

        // Find max line width for internal bounding box
        const totalWidth = lines.reduce((max, line) => Math.max(max, line.width), 0);
        const totalHeight = lines.length * lineHeight;

        return {
            words: layoutWords,
            totalWidth,
            totalHeight
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
