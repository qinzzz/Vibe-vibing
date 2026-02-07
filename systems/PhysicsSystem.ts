import { System, Worm, SoulParticle } from '../core/types';
import { Engine } from '../core/Engine';
import { BLOB_CONSTANTS } from '../constants';
import { solveIK, lerp } from '../utils/physics';
import { computeField } from '../utils/marchingSquares';
import { Vector2D } from '../core/types';
import { EVENTS } from '../core/events';

export class PhysicsSystem implements System {
    private engine!: Engine;
    private gaitSequence = [0, 3, 1, 2];
    private currentGaitIdx = 0;
    private lastTarget: { x: number; y: number } | null = null;
    private moveStartDistance = 0;

    init(engine: Engine) {
        this.engine = engine;

        // Initialize legs for initial worm
        const worm = this.engine.activeWorm;
        this.initializeWormLegs(worm);

        // Listen for new worms being born
        this.engine.events.on(EVENTS.WORM_BORN, this.handleWormBorn);
    }

    private handleWormBorn = (worm: Worm) => {
        this.initializeWormLegs(worm);
    };

    private initializeWormLegs(worm: Worm) {
        const labels = ['FL', 'FR', 'BL', 'BR'];
        worm.legs = BLOB_CONSTANTS.HIP_OFFSETS.map((offset, i) => {
            const footX = worm.corePos.x + offset.x * 2.5;
            const footY = worm.corePos.y + offset.y * 2.5;
            return {
                id: labels[i],
                hipOffset: offset,
                footPos: { x: footX, y: footY },
                kneePos: { x: footX, y: footY },
                stepStart: { x: footX, y: footY },
                stepTarget: { x: footX, y: footY },
                stepProgress: 1,
                isStepping: false
            };
        });
    }

    update(dt: number) {
        const s = this.engine.config;
        const dtSec = dt / 1000;

        this.engine.wormState.worms.forEach(worm => {
            this.updateWormMovement(worm, dt, s);
            this.updateParticles(worm, dtSec);
            this.emitSoulParticles(worm);
        });
    }

    private updateWormMovement(worm: Worm, dt: number, s: any) {
        // Only update movement for active worm or if we add AI later
        if (worm.id !== this.engine.wormState.activeWormId) return;

        const core = worm.corePos;
        const target = worm.targetPos;
        const speedMultiplier = worm.speedMultiplier || 1;

        const prevCore = { ...core };

        // Organic idle wobble
        const time = performance.now() * 0.001;
        const toTargetX = target.x - core.x;
        const toTargetY = target.y - core.y;
        const distToTarget = Math.hypot(toTargetX, toTargetY);

        // Soul-based movement modifiers
        const axes = worm.soul?.axes || { calm: 0, bold: 0, focused: 0 };
        const jitter = (axes.bold * 0.5 - axes.calm * 0.3) * 2; // Bold worms jitter more
        const smooth = Math.max(0, axes.calm * 0.5 + axes.focused * 0.3); // Calm worms move smoother

        const targetChanged = !this.lastTarget
            || Math.abs(target.x - this.lastTarget.x) > 0.001
            || Math.abs(target.y - this.lastTarget.y) > 0.001;

        if (targetChanged) {
            this.moveStartDistance = distToTarget;
            this.lastTarget = { x: target.x, y: target.y };
        }

        const shortHopThreshold = 205;
        const isShortHop = this.moveStartDistance <= shortHopThreshold;
        const nearFactor = isShortHop ? this.clamp(1 - distToTarget / 250, 0, 1) : 0;

        // Modify wobble based on soul
        const baseWobble = this.clamp((distToTarget - 6) / 220, 0, 1);
        const wobbleScale = baseWobble * (1 + jitter);

        const wobbleX = (Math.sin(time * 0.7) * 4 + Math.cos(time * 1.3) * 2) * wobbleScale;
        const wobbleY = (Math.cos(time * 0.8) * 4 + Math.sin(time * 1.1) * 2) * wobbleScale;

        const closeBoost = lerp(1.2, 7.2, nearFactor);
        const closeAssist = nearFactor * 0.02 * speedMultiplier;

        // Adjusted Lerp for smoothness
        const baseLerp = (s.coreLerp * speedMultiplier * closeBoost) + closeAssist;
        const followLerp = this.clamp(baseLerp * (1 - smooth * 0.2), 0.002, 0.14);

        const desiredX = target.x + wobbleX;
        const desiredY = target.y + wobbleY;

        core.x += (desiredX - core.x) * followLerp;
        core.y += (desiredY - core.y) * followLerp;

        const postDx = target.x - core.x;
        const postDy = target.y - core.y;
        const remainingDist = Math.hypot(postDx, postDy);

        if (isShortHop && remainingDist < 2.2) {
            core.x = target.x;
            core.y = target.y;
        }

        worm.coreVel = { x: core.x - prevCore.x, y: core.y - prevCore.y };

        this.updateLegs(worm, s);
    }

    private updateLegs(worm: Worm, s: any) {
        const core = worm.corePos;
        const coreVel = worm.coreVel;
        const legs = worm.legs;

        if (!legs.some(l => l.isStepping)) {
            const leg = legs[this.gaitSequence[this.currentGaitIdx]];
            const hipPos = { x: core.x + leg.hipOffset.x, y: core.y + leg.hipOffset.y };
            const ideal = {
                x: hipPos.x + leg.hipOffset.x * 1.5 + coreVel.x * BLOB_CONSTANTS.STEP_LEAD,
                y: hipPos.y + leg.hipOffset.y * 1.5 + coreVel.y * BLOB_CONSTANTS.STEP_LEAD
            };
            if (Math.sqrt((leg.footPos.x - ideal.x) ** 2 + (leg.footPos.y - ideal.y) ** 2) > s.stepTrigger) {
                leg.isStepping = true; leg.stepProgress = 0; leg.stepStart = { ...leg.footPos }; leg.stepTarget = { ...ideal };
                this.currentGaitIdx = (this.currentGaitIdx + 1) % this.gaitSequence.length;
            }
        }

        legs.forEach(leg => {
            if (leg.isStepping) {
                leg.stepProgress += 1 / BLOB_CONSTANTS.STEP_DURATION;
                const t = -(Math.cos(Math.PI * leg.stepProgress) - 1) / 2;
                const arc = Math.sin(leg.stepProgress * Math.PI) * BLOB_CONSTANTS.STEP_HEIGHT;
                leg.footPos.x = leg.stepStart.x + (leg.stepTarget.x - leg.stepStart.x) * t;
                leg.footPos.y = leg.stepStart.y + (leg.stepTarget.y - leg.stepStart.y) * t - arc;
                if (leg.stepProgress >= 1) { leg.footPos = { ...leg.stepTarget }; leg.isStepping = false; }
            }
            leg.kneePos = solveIK({ x: core.x + leg.hipOffset.x, y: core.y + leg.hipOffset.y }, leg.footPos, s.l1, s.l2, leg.hipOffset.x > 0);
        });
    }

    private updateParticles(worm: Worm, dt: number) {
        if (!worm.particles) worm.particles = [];

        for (let i = worm.particles.length - 1; i >= 0; i--) {
            const p = worm.particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                worm.particles.splice(i, 1);
                continue;
            }

            p.x += p.vx * dt * 60;
            p.y += p.vy * dt * 60;

            // Friction
            p.vx *= 0.95;
            p.vy *= 0.95;

            // Behavior by type
            if (p.type === 'bubble') {
                p.vy -= 0.02; // Float up
                p.x += Math.sin(performance.now() * 0.01 + p.y * 0.1) * 0.1;
            } else if (p.type === 'spark') {
                p.vy += 0.05; // Gravity
            } else if (p.type === 'heart') {
                p.vy -= 0.01;
                p.size = Math.max(0, p.size - 0.01);
            } else if (p.type === 'tear') {
                p.vy += 0.08; // Heavy gravity
            }
        }
    }

    private emitSoulParticles(worm: Worm) {
        if (!worm.soul) return;
        const axes = worm.soul.axes;
        const chance = 0.02; // Base chance per frame

        if (Math.random() > chance) return;

        const core = worm.corePos;
        const r = this.engine.config.coreRadius * worm.sizeMultiplier;

        // Random position on surface
        const angle = Math.random() * Math.PI * 2;
        const x = core.x + Math.cos(angle) * r;
        const y = core.y + Math.sin(angle) * r;

        // Calculate worm's actual color
        const baseHue = worm.hue;
        const soulHue = this.getSoulHueOffset(worm.soul?.axes);
        const finalHue = (baseHue + soulHue + 360) % 360;

        // Use worm's color with high lightness for particles
        const particleColor = `hsla(${finalHue}, 80%, 75%, 0.8)`;

        if (axes.bold > 0.4) {
            this.addParticle(worm, x, y, 'spark', particleColor);
        }
        if (axes.calm > 0.4) {
            this.addParticle(worm, x, y, 'bubble', particleColor);
        }
        if (axes.tender > 0.4) {
            this.addParticle(worm, x, y, 'heart', particleColor);
        }
        if (axes.hopeful < -0.4 || axes.calm < -0.4) {
            // Dust stays gray-ish but tinted
            const dustColor = `hsla(${finalHue}, 20%, 60%, 0.6)`;
            this.addParticle(worm, x, y, 'dust', dustColor);
        }
        if (axes.poetic > 0.5) {
            this.addParticle(worm, x, y, 'fizz', particleColor);
        }
    }

    private addParticle(worm: Worm, x: number, y: number, type: SoulParticle['type'], color: string) {
        worm.particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 1.5,
            vy: (Math.random() - 0.5) * 1.5,
            life: 1.5 + Math.random(),
            maxLife: 2.5,
            size: 2 + Math.random() * 2,
            type,
            color
        });
    }

    draw(ctx: CanvasRenderingContext2D) {
        const s = this.engine.config;
        this.engine.wormState.worms.forEach(worm => {
            this.drawParticles(ctx, worm);
            this.drawWorm(ctx, worm, s);
        });
    }

    private drawParticles(ctx: CanvasRenderingContext2D, worm: Worm) {
        if (!worm.particles) return;

        worm.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.life / p.maxLife;
            ctx.fillStyle = p.color;
            ctx.beginPath();

            if (p.type === 'heart') {
                // Simple heart shape
                const size = p.size;
                ctx.translate(p.x, p.y);
                ctx.moveTo(0, size * 0.3);
                ctx.bezierCurveTo(size * 0.5, -size * 0.5, size, 0, 0, size);
                ctx.bezierCurveTo(-size, 0, -size * 0.5, -size * 0.5, 0, size * 0.3);
            } else {
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            }

            ctx.fill();
            ctx.restore();
        });
    }

    private drawWorm(ctx: CanvasRenderingContext2D, worm: Worm, s: any) {
        const core = worm.corePos;
        const legs = worm.legs;

        // Soul-based color tint
        const baseHue = worm.hue;
        const soulHue = this.getSoulHueOffset(worm.soul?.axes);
        const finalHue = (baseHue + soulHue + 360) % 360; // Wrap around

        const saturation = this.getSoulSaturation(worm.soul?.axes);
        const lightness = this.getSoulLightness(worm.soul?.axes);

        // Color params
        const outlineColor = `hsla(${finalHue}, ${saturation}%, ${Math.max(20, lightness - 20)}%, 0.6)`; // Darker outline
        const coreColor = `hsla(${finalHue}, ${saturation}%, ${lightness}%, 0.3)`;

        const coreRadius = s.coreRadius * worm.sizeMultiplier;
        const hipRadius = s.hipRadius * worm.sizeMultiplier;
        const kneeRadius = s.kneeRadius * worm.sizeMultiplier;
        const footRadius = s.footRadius * worm.sizeMultiplier;

        // Draw Skeleton
        if (s.showSkeleton) {
            ctx.strokeStyle = `hsla(${finalHue}, 50%, 70%, 0.3)`;
            ctx.lineWidth = 1;
            legs.forEach(leg => {
                const h = { x: core.x + leg.hipOffset.x, y: core.y + leg.hipOffset.y };
                ctx.beginPath();
                ctx.moveTo(h.x, h.y);
                ctx.lineTo(leg.kneePos.x, leg.kneePos.y);
                ctx.lineTo(leg.footPos.x, leg.footPos.y);
                ctx.stroke();
            });

            // Draw Face/Eyes
            this.drawEyes(ctx, worm, coreRadius);
        }

        // Draw Metaballs
        const metaballPoints: { pos: Vector2D, r: number, w: number }[] = [];
        metaballPoints.push({ pos: core, r: coreRadius, w: s.coreWeight });
        legs.forEach(l => {
            const hip = { x: core.x + l.hipOffset.x, y: core.y + l.hipOffset.y };
            metaballPoints.push({ pos: hip, r: hipRadius * 1.1, w: s.hipWeight }); // Slightly larger hips for better blending
            metaballPoints.push({ pos: l.kneePos, r: kneeRadius, w: s.kneeWeight });
            let fr = footRadius;
            if (l.isStepping) fr *= (1 - Math.sin(l.stepProgress * Math.PI) * 0.25);
            metaballPoints.push({ pos: l.footPos, r: fr, w: s.footWeight });
        });

        // Marching Squares Rendering
        let minX = core.x, minY = core.y, maxX = core.x, maxY = core.y;
        metaballPoints.forEach(p => {
            minX = Math.min(minX, p.pos.x - p.r);
            minY = Math.min(minY, p.pos.y - p.r);
            maxX = Math.max(maxX, p.pos.x + p.r);
            maxY = Math.max(maxY, p.pos.y + p.r);
        });

        const cellSize = s.cellSize, iso = s.isoThreshold, padding = BLOB_CONSTANTS.METABALL.ROI_PADDING;
        const gridMinX = Math.floor((minX - padding) / cellSize) * cellSize;
        const gridMinY = Math.floor((minY - padding) / cellSize) * cellSize;
        const cols = Math.floor((Math.ceil((maxX + padding) / cellSize) * cellSize - gridMinX) / cellSize);
        const rows = Math.floor((Math.ceil((maxY + padding) / cellSize) * cellSize - gridMinY) / cellSize);

        if (cols > 0 && rows > 0) {
            const gridValues: number[][] = [];
            for (let i = 0; i <= cols; i++) {
                gridValues[i] = [];
                for (let j = 0; j <= rows; j++) {
                    gridValues[i][j] = computeField(gridMinX + i * cellSize, gridMinY + j * cellSize, metaballPoints);
                }
            }

            ctx.beginPath();
            ctx.strokeStyle = outlineColor;
            ctx.lineWidth = 1.5;
            // Also fill slightly for volume
            ctx.fillStyle = coreColor;

            // Simple Marching Squares drawing loop
            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < rows; j++) {
                    const x = gridMinX + i * cellSize, y = gridMinY + j * cellSize;
                    const v0 = gridValues[i][j], v1 = gridValues[i + 1][j];
                    const v2 = gridValues[i + 1][j + 1], v3 = gridValues[i][j + 1];
                    let caseIdx = 0;
                    if (v0 >= iso) caseIdx += 1;
                    if (v1 >= iso) caseIdx += 2;
                    if (v2 >= iso) caseIdx += 4;
                    if (v3 >= iso) caseIdx += 8;
                    if (caseIdx === 0 || caseIdx === 15) continue;

                    const gp = (p0: Vector2D, p1: Vector2D, va0: number, va1: number) => {
                        const t = (iso - va0) / (va1 - va0);
                        return { x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) };
                    };
                    const p0 = { x, y }, p1 = { x: x + cellSize, y };
                    const p2 = { x: x + cellSize, y: y + cellSize }, p3 = { x, y: y + cellSize };
                    const e0 = gp(p0, p1, v0, v1), e1 = gp(p1, p2, v1, v2);
                    const e2 = gp(p2, p3, v2, v3), e3 = gp(p3, p0, v3, v0);
                    const dl = (a: Vector2D, b: Vector2D) => {
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                    };

                    switch (caseIdx) {
                        case 1: case 14: dl(e3, e0); break;
                        case 2: case 13: dl(e0, e1); break;
                        case 3: case 12: dl(e3, e1); break;
                        case 4: case 11: dl(e1, e2); break;
                        case 5: dl(e0, e1); dl(e2, e3); break;
                        case 6: case 9: dl(e0, e2); break;
                        case 7: case 8: dl(e3, e2); break;
                        case 10: dl(e3, e0); dl(e1, e2); break;
                    }
                }
            }
            ctx.stroke();
            // Fill is tricky with lines, skipping fill for now to keep style consistent with original
        }
    }

    private drawEyes(ctx: CanvasRenderingContext2D, worm: Worm, coreRadius: number) {
        const cx = worm.corePos.x;
        const cy = worm.corePos.y;
        const mood = worm.soul?.identity?.mood || 'watchful';
        const eyeOffset = coreRadius * 0.35;
        const eyeSize = 2;

        ctx.strokeStyle = `rgba(255, 255, 255, 0.6)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        // Left Eye
        this.drawOneEye(ctx, cx - eyeOffset, cy, mood, true);
        // Right Eye
        this.drawOneEye(ctx, cx + eyeOffset, cy, mood, false);

        ctx.stroke();
    }

    private drawOneEye(ctx: CanvasRenderingContext2D, x: number, y: number, mood: string, isLeft: boolean) {
        const size = 3;
        if (mood === 'serene' || mood === 'wistful') {
            // Closed/Relaxed: - -
            ctx.moveTo(x - size, y);
            ctx.lineTo(x + size, y);
        } else if (mood === 'playful' || mood === 'electric') {
            // Happy: ^ ^
            ctx.moveTo(x - size, y + size / 2);
            ctx.lineTo(x, y - size / 2);
            ctx.lineTo(x + size, y + size / 2);
        } else if (mood === 'impatient' || mood === 'irritable') {
            // Angry: \ /
            if (isLeft) {
                ctx.moveTo(x - size, y - size);
                ctx.lineTo(x + size, y + size / 2);
            } else {
                ctx.moveTo(x - size, y + size / 2);
                ctx.lineTo(x + size, y - size);
            }
        } else if (mood === 'contemplative' || mood === 'focused') {
            // Wide/Round: O
            ctx.moveTo(x + size, y);
            ctx.arc(x, y, size, 0, Math.PI * 2);
        } else {
            // Default/Watchful: . .
            ctx.moveTo(x, y);
            ctx.arc(x, y, 1, 0, Math.PI * 2);
        }
    }

    private getSoulHueOffset(axes: any): number {
        if (!axes) return 0;
        let offset = 0;
        // Bold -> Red/Orange (Warm shift) - MORE DRAMATIC
        if (axes.bold > 0) offset -= 80 * axes.bold;
        // Calm -> Blue/Teal (Cool shift)
        if (axes.calm > 0) offset += 60 * axes.calm;
        // Tender -> Pink/Magenta
        if (axes.tender > 0) offset += 100 * axes.tender;
        // Poetic -> Purple/Violet
        if (axes.poetic > 0) offset += 90 * axes.poetic;
        // Mystery/Deep -> Dark Blue
        if (axes.focused > 0) offset += 20 * axes.focused;

        return offset;
    }

    private getSoulSaturation(axes: any): number {
        if (!axes) return 60; // Default
        let sat = 60;

        // Intensity boosters
        if (axes.focused > 0) sat += 30 * axes.focused; // Focused = Vibrant
        if (axes.bold > 0) sat += 20 * axes.bold;       // Bold = Vibrant

        // Intensity reducers
        if (axes.calm > 0) sat -= 10 * axes.calm;       // Calm = Slightly muted
        if (axes.hopeful < -0.3) sat -= 40;             // Despair = Grey

        return this.clamp(sat, 10, 100);
    }

    private getSoulLightness(axes: any): number {
        if (!axes) return 60; // Default
        let light = 60;

        // Brightness boosters
        if (axes.hopeful > 0) light += 20 * axes.hopeful; // Hopeful = Bright
        if (axes.tender > 0) light += 10 * axes.tender;   // Tender = Soft/Bright

        // Darkness boosters
        if (axes.stubborn > 0) light -= 20 * axes.stubborn; // Stubborn = Darker/Solid
        if (axes.focused > 0) light -= 10 * axes.focused;   // Focused = Deep color implies slightly darker for contrast

        return this.clamp(light, 20, 90);
    }

    cleanup() {
        this.engine.events.off(EVENTS.WORM_BORN, this.handleWormBorn);
    }

    private clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
    }
}
