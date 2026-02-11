import { Engine } from '../core/Engine';
import { System, Vector2D } from '../core/types';
import { EVENTS } from '../core/events';
import { GameDirector } from './GameDirector';
import { DiscoveryEngine } from './DiscoveryEngine';

export interface BlackHole {
    id: string;
    x: number;
    y: number;
    radius: number;
    eventHorizon: number; // Actual collision radius
    influenceRadius: number; // Visual distortion radius
    hue: number; // Color variation
    pulsePhase: number; // For animation
}

export interface AmbientWord {
    id: string;
    text: string;
    x: number;
    y: number;
    orbitRadius: number;
    orbitAngle: number;
    orbitSpeed: number;
    fontSize: number;
    nearestHoleId: string;
    isEdible: boolean; // False for decoration
}

export class BlackHoleSystem implements System {
    private engine!: Engine;
    private blackHoles: BlackHole[] = [];
    private ambientWords: AmbientWord[] = [];
    private nextBlackHoleId = 0;
    private nextWordId = 0;

    // Configuration
    private readonly INITIAL_BLACK_HOLES = 4;
    private readonly MIN_HOLE_DISTANCE = 1200; // Minimum distance between black holes
    private readonly GENERATION_DISTANCE = 2000; // Generate new holes when worm explores beyond this
    private readonly AMBIENT_WORDS_PER_HOLE = 40;
    private readonly TELEPORT_COOLDOWN = 2000; // ms
    private readonly TELEPORT_FLASH_DURATION = 300; // ms

    private lastTeleportTime = 0;
    private teleportFlashOpacity = 0;
    private nearestHoleId: string | null = null; // For proximity warning
    private wordVocabulary = [
        'void', 'abyss', 'singularity', 'eternity', 'cosmic', 'infinite',
        'gravitation', 'warped', 'event', 'horizon', 'spacetime', 'collapse',
        'quantum', 'entangled', 'nebula', 'stellar', 'dark', 'matter',
        'antimatter', 'photon', 'quasar', 'pulsar', 'neutron', 'gravity',
        'curvature', 'relativity', 'dimensional', 'wormhole', 'portal',
        'fabric', 'continuum', 'distortion', 'paradox', 'entropy', 'chaos'
    ];

    init(engine: Engine) {
        this.engine = engine;

        // Generate initial black hole network
        this.generateInitialBlackHoles();

        // Listen for worm position updates to generate new holes
        this.engine.events.on('INPUT_START', this.checkForNewHoleGeneration);

        // Listen for clicks to eat ambient words
        this.engine.events.on('INPUT_START', this.handleEatAttempt);
    }

    update(dt: number) {
        const worm = this.engine.activeWorm;
        if (!DiscoveryEngine.isFeatureEnabled(worm, 'BLACK_HOLE')) {
            return;
        }

        const dtSec = dt / 1000;
        const now = performance.now();

        // Update black hole animations
        for (const hole of this.blackHoles) {
            hole.pulsePhase += dtSec * 0.5; // Slow pulse
        }

        // Track nearest black hole for proximity warning
        let nearestDist = Infinity;
        this.nearestHoleId = null;
        for (const hole of this.blackHoles) {
            const dx = worm.corePos.x - hole.x;
            const dy = worm.corePos.y - hole.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < nearestDist && dist < 300) { // 300px warning range
                nearestDist = dist;
                this.nearestHoleId = hole.id;
            }
        }

        // Update ambient word orbits
        for (const word of this.ambientWords) {
            word.orbitAngle += word.orbitSpeed * dtSec;

            // Recalculate position based on orbit
            const hole = this.blackHoles.find(h => h.id === word.nearestHoleId);
            if (hole) {
                word.x = hole.x + Math.cos(word.orbitAngle) * word.orbitRadius;
                word.y = hole.y + Math.sin(word.orbitAngle) * word.orbitRadius;
            }
        }

        // Check for worm-black hole collisions (teleportation)
        this.checkTeleportation(now);

        // Update teleport flash effect
        if (this.teleportFlashOpacity > 0) {
            this.teleportFlashOpacity -= dtSec * 3; // Fade out quickly
            this.teleportFlashOpacity = Math.max(0, this.teleportFlashOpacity);
        }

        // Check if we need to generate new black holes
        this.checkForNewHoleGeneration();
    }

    draw(ctx: CanvasRenderingContext2D) {
        if (!DiscoveryEngine.isFeatureEnabled(this.engine.activeWorm, 'BLACK_HOLE')) return;

        // Draw black holes and their effects
        this.drawBlackHoles(ctx);

        // Draw ambient words with gravitational distortion
        this.drawAmbientWords(ctx);

        // Draw teleport flash effect
        if (this.teleportFlashOpacity > 0) {
            this.drawTeleportFlash(ctx);
        }
    }

    cleanup() {
        this.engine.events.off('INPUT_START', this.checkForNewHoleGeneration);
        this.engine.events.off('INPUT_START', this.handleEatAttempt);
        this.blackHoles = [];
        this.ambientWords = [];
    }

    // ==================== Generation ====================

    private generateInitialBlackHoles() {
        const worm = this.engine.activeWorm;
        const spread = 3000;

        for (let i = 0; i < this.INITIAL_BLACK_HOLES; i++) {
            let attempts = 0;
            let placed = false;

            while (!placed && attempts < 50) {
                const angle = (i / this.INITIAL_BLACK_HOLES) * Math.PI * 2 + Math.random() * 0.5;
                const distance = 800 + Math.random() * spread;
                const x = worm.corePos.x + Math.cos(angle) * distance;
                const y = worm.corePos.y + Math.sin(angle) * distance;

                if (this.isValidBlackHolePosition(x, y)) {
                    this.createBlackHole(x, y);
                    placed = true;
                }
                attempts++;
            }
        }
    }

    private createBlackHole(x: number, y: number) {
        const radius = 80 + Math.random() * 40; // 80-120px event horizon
        const hole: BlackHole = {
            id: `blackhole-${this.nextBlackHoleId++}`,
            x,
            y,
            radius,
            eventHorizon: radius,
            influenceRadius: radius * 5, // 5x for gravitational effects
            hue: 260 + Math.random() * 40, // Purple-ish
            pulsePhase: Math.random() * Math.PI * 2
        };

        this.blackHoles.push(hole);

        // Generate ambient words around this black hole
        this.generateAmbientWords(hole);

        console.log(`[BlackHole] Created at (${x.toFixed(0)}, ${y.toFixed(0)})`);
    }

    private generateAmbientWords(hole: BlackHole) {
        for (let i = 0; i < this.AMBIENT_WORDS_PER_HOLE; i++) {
            const word = this.randomWord();
            const orbitRadius = hole.influenceRadius * (0.4 + Math.random() * 0.5);
            const orbitAngle = Math.random() * Math.PI * 2;
            const orbitSpeed = 0.1 + Math.random() * 0.2; // radians per second

            // Make 100% edible cosmic vocabulary!
            const isEdible = true;

            this.ambientWords.push({
                id: `ambient-${this.nextWordId++}`,
                text: word,
                x: hole.x + Math.cos(orbitAngle) * orbitRadius,
                y: hole.y + Math.sin(orbitAngle) * orbitRadius,
                orbitRadius,
                orbitAngle,
                orbitSpeed: orbitSpeed * (Math.random() > 0.5 ? 1 : -1), // Random direction
                fontSize: 12 + Math.random() * 8,
                nearestHoleId: hole.id,
                isEdible
            });
        }
    }

    private isValidBlackHolePosition(x: number, y: number): boolean {
        // Check minimum distance from existing black holes
        for (const hole of this.blackHoles) {
            const dx = x - hole.x;
            const dy = y - hole.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < this.MIN_HOLE_DISTANCE) {
                return false;
            }
        }
        return true;
    }

    private checkForNewHoleGeneration = () => {
        const worm = this.engine.activeWorm;
        const explorationRadius = this.GENERATION_DISTANCE;

        // Find the direction the worm is heading
        const wormDx = worm.targetPos.x - worm.corePos.x;
        const wormDy = worm.targetPos.y - worm.corePos.y;
        const wormDist = Math.sqrt(wormDx * wormDx + wormDy * wormDy);

        if (wormDist < 10) return; // Worm not moving

        const wormAngle = Math.atan2(wormDy, wormDx);

        // Check if there's a black hole in the direction of travel
        let hasHoleAhead = false;
        for (const hole of this.blackHoles) {
            const dx = hole.x - worm.corePos.x;
            const dy = hole.y - worm.corePos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx);
            const angleDiff = Math.abs(this.normalizeAngle(angle - wormAngle));

            if (dist < explorationRadius && angleDiff < Math.PI / 3) {
                hasHoleAhead = true;
                break;
            }
        }

        // Generate new black hole ahead if needed
        if (!hasHoleAhead && Math.random() < 0.3) {
            const distance = explorationRadius * 0.8;
            const angleOffset = (Math.random() - 0.5) * (Math.PI / 2);
            const x = worm.corePos.x + Math.cos(wormAngle + angleOffset) * distance;
            const y = worm.corePos.y + Math.sin(wormAngle + angleOffset) * distance;

            if (this.isValidBlackHolePosition(x, y)) {
                this.createBlackHole(x, y);
            }
        }
    };

    private handleEatAttempt = (pos: { x: number; y: number }) => {
        const worm = this.engine.activeWorm;

        // Find edible words within eating range
        for (let i = this.ambientWords.length - 1; i >= 0; i--) {
            const word = this.ambientWords[i];
            if (!word.isEdible) continue;

            const hole = this.blackHoles.find(h => h.id === word.nearestHoleId);
            if (!hole) continue;

            // USE DISTORTED POSITION FOR CLICK CHECK
            const distorted = this.applyGravitationalDistortion(word.x, word.y, word.text, hole);

            // 1. Check if click hit this distorted word
            const dxClick = distorted.x - pos.x;
            const dyClick = distorted.y - pos.y;
            const distClick = Math.sqrt(dxClick * dxClick + dyClick * dyClick);

            // 2. Check if the word is near the worm
            const dxWorm = distorted.x - worm.corePos.x;
            const dyWorm = distorted.y - worm.corePos.y;
            const distWorm = Math.sqrt(dxWorm * dxWorm + dyWorm * dyWorm);

            if (distClick < 120) { // Removed distWorm check entirely for now to ensure they are edible
                // Consume the word
                console.log(`[BlackHole] Worm ate ambient word: "${word.text}"`);

                // CRUCIAL: Use TOKEN_EATEN to trigger DigestionSystem's ATTACHING state
                this.engine.events.emit(EVENTS.TOKEN_EATEN, {
                    id: word.id,
                    text: word.text,
                    pos: { x: distorted.x, y: distorted.y }
                });

                // Remove from ambient words
                this.ambientWords.splice(i, 1);

                // Only eat one word per click
                break;
            }
        }
    };


    // ==================== Teleportation ====================

    private checkTeleportation(now: number) {
        const worm = this.engine.activeWorm;

        // Check cooldown
        if (now - this.lastTeleportTime < this.TELEPORT_COOLDOWN) {
            return;
        }

        // Check if worm is inside any black hole's event horizon
        for (const hole of this.blackHoles) {
            const dx = worm.corePos.x - hole.x;
            const dy = worm.corePos.y - hole.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < hole.eventHorizon) {
                this.triggerTeleport(hole.id, now);
                return;
            }
        }
    }

    private triggerTeleport(entryHoleId: string, now: number) {
        // Select random exit hole (not the entry)
        const exitCandidates = this.blackHoles.filter(h => h.id !== entryHoleId);
        if (exitCandidates.length === 0) return; // Need at least 2 holes

        const exitHole = exitCandidates[Math.floor(Math.random() * exitCandidates.length)];

        // Teleport worm
        const worm = this.engine.activeWorm;
        worm.corePos.x = exitHole.x;
        worm.corePos.y = exitHole.y;
        worm.targetPos = { ...exitHole }; // Reset target to prevent instant re-entry

        // Reset IK legs to prevent stretching
        for (const leg of worm.legs) {
            leg.footPos = { ...worm.corePos };
            leg.kneePos = { ...worm.corePos };
            leg.stepStart = { ...worm.corePos };
            leg.stepTarget = { ...worm.corePos };
            leg.isStepping = false;
        }

        // Trigger visual effects
        this.teleportFlashOpacity = 1.0;
        this.lastTeleportTime = now;

        // Emit event
        this.engine.events.emit(EVENTS.WORMHOLE_TELEPORT, {
            entryHoleId,
            exitHoleId: exitHole.id,
            wormId: worm.id
        });

        console.log(`[BlackHole] Worm teleported from ${entryHoleId} to ${exitHole.id}`);
    }

    // ==================== Drawing ====================

    private drawBlackHoles(ctx: CanvasRenderingContext2D) {
        for (const hole of this.blackHoles) {
            ctx.save();

            // Check if this is the nearest hole (proximity warning)
            const isNearby = this.nearestHoleId === hole.id;

            // Pulsing glow (faster when nearby)
            const pulseSpeed = isNearby ? 2.0 : 1.0;
            const pulse = Math.sin(hole.pulsePhase * pulseSpeed) * 0.5 + 0.5; // 0-1
            const glowRadius = hole.radius * (1.5 + pulse * (isNearby ? 0.5 : 0.3));

            // Outer glow (brighter when nearby)
            const gradient = ctx.createRadialGradient(
                hole.x, hole.y, 0,
                hole.x, hole.y, glowRadius
            );
            const glowIntensity = isNearby ? 0.5 : 0.3;
            gradient.addColorStop(0, `hsla(${hole.hue}, 70%, 30%, ${glowIntensity})`);
            gradient.addColorStop(0.5, `hsla(${hole.hue}, 60%, 20%, ${glowIntensity * 0.6})`);
            gradient.addColorStop(1, `hsla(${hole.hue}, 50%, 10%, 0)`);

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(hole.x, hole.y, glowRadius, 0, Math.PI * 2);
            ctx.fill();

            // Event horizon (pure black)
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(hole.x, hole.y, hole.eventHorizon, 0, Math.PI * 2);
            ctx.fill();

            // Accretion disk effect (brighter when nearby)
            const ringAlpha = (0.4 + pulse * 0.2) * (isNearby ? 1.5 : 1.0);
            ctx.strokeStyle = `hsla(${hole.hue}, 80%, 50%, ${ringAlpha})`;
            ctx.lineWidth = isNearby ? 3 : 2;
            ctx.beginPath();
            ctx.arc(hole.x, hole.y, hole.eventHorizon * 1.2, 0, Math.PI * 2);
            ctx.stroke();

            // Warning ring when very close
            if (isNearby) {
                ctx.strokeStyle = `hsla(${hole.hue}, 90%, 60%, ${pulse * 0.4})`;
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.arc(hole.x, hole.y, hole.eventHorizon * 1.5, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            ctx.restore();
        }
    }

    private drawAmbientWords(ctx: CanvasRenderingContext2D) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const word of this.ambientWords) {
            const hole = this.blackHoles.find(h => h.id === word.nearestHoleId);
            if (!hole) continue;

            // Apply gravitational distortion
            const distorted = this.applyGravitationalDistortion(
                word.x, word.y, word.text, hole
            );

            // Check if mouse is hovering (for visual feedback)
            const dxMouse = distorted.x - this.engine.mousePos.x;
            const dyMouse = distorted.y - this.engine.mousePos.y;
            const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);
            const isHovered = distMouse < 100; // 100px hover feedback

            if (isHovered) {
                this.engine.blobState.isHoveringEdible = true;
            }

            ctx.save();
            ctx.translate(distorted.x, distorted.y);
            ctx.rotate(distorted.rotation);

            // Apply spaghettification scaling
            ctx.scale(distorted.scaleX, distorted.scaleY);

            ctx.font = `${isHovered ? word.fontSize + 4 : word.fontSize}px monospace`;

            // Edible words: brighter cyan/white, Decorative: dimmer blue
            const baseColor = isHovered
                ? 'rgba(255, 255, 255' // White when hovered
                : word.isEdible
                    ? 'rgba(200, 240, 255' // Brighter cyan for edible
                    : 'rgba(100, 150, 200'; // Dimmer blue for decorative

            const finalOpacity = isHovered
                ? 1.0
                : distorted.opacity;

            ctx.fillStyle = `${baseColor}, ${finalOpacity})`;

            // Add a small glow shadow for hovered words
            if (isHovered) {
                ctx.shadowBlur = 10;
                ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
            }

            ctx.fillText(word.text, 0, 0);

            // Reset shadow
            ctx.shadowBlur = 0;

            ctx.restore();
        }

        ctx.restore();
    }

    private applyGravitationalDistortion(
        x: number,
        y: number,
        text: string,
        hole: BlackHole
    ): {
        x: number;
        y: number;
        rotation: number;
        scaleX: number;
        scaleY: number;
        opacity: number;
    } {
        const dx = x - hole.x;
        const dy = y - hole.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Calculate influence (0.0 - 1.0, higher when closer)
        const influence = Math.max(0, 1 - dist / hole.influenceRadius);

        // --- 1. SPIRAL ROTATION ---
        // Closer to center = more rotation
        const spiralAngle = influence * Math.PI * 2 * 3; // Up to 3 full rotations

        // Rotate position around black hole
        const angle = Math.atan2(dy, dx);
        const newAngle = angle + spiralAngle;
        const spiralX = hole.x + Math.cos(newAngle) * dist;
        const spiralY = hole.y + Math.sin(newAngle) * dist;

        // --- 2. SPAGHETTIFICATION ---
        let rotation = 0;
        let scaleX = 1;
        let scaleY = 1;

        if (influence > 0.5) {
            // Rotate text to face the black hole center
            const angleToCenter = Math.atan2(dy, dx);
            rotation = angleToCenter;

            // Stretch towards center based on influence
            const stretchFactor = 1 + (influence * 4); // Up to 5x stretch
            scaleX = stretchFactor;
            scaleY = 1 / stretchFactor; // Compress perpendicular
        }

        // --- 3. OPACITY FADE ---
        // Fade out when very close to event horizon
        const eventHorizonProximity = Math.max(0, 1 - (dist - hole.eventHorizon) / (hole.influenceRadius * 0.3));
        const opacity = Math.max(0, 1 - eventHorizonProximity * 0.7) * (0.3 + influence * 0.4);

        return {
            x: spiralX,
            y: spiralY,
            rotation,
            scaleX,
            scaleY,
            opacity
        };
    }

    private drawTeleportFlash(ctx: CanvasRenderingContext2D) {
        ctx.save();
        ctx.fillStyle = `rgba(147, 51, 234, ${this.teleportFlashOpacity * 0.3})`; // Purple flash
        ctx.fillRect(
            this.engine.cameraPos.x - this.engine.width,
            this.engine.cameraPos.y - this.engine.height,
            this.engine.width * 2,
            this.engine.height * 2
        );
        ctx.restore();
    }

    // ==================== Utilities ====================

    private randomWord(): string {
        return this.wordVocabulary[Math.floor(Math.random() * this.wordVocabulary.length)];
    }

    private normalizeAngle(angle: number): number {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
    }
}
