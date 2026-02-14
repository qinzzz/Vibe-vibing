import { Engine } from '../core/Engine';
import { System, Vector2D } from '../core/types';
import { EVENTS } from '../core/events';
import { GameDirector } from './GameDirector';
import { DiscoveryEngine } from './DiscoveryEngine';

export interface BlackHoleTheme {
    name: string;
    hueRange: [number, number];
    vocabularyPool: string[];
}

export interface BlackHole {
    id: string;
    x: number;
    y: number;
    radius: number;
    eventHorizon: number; // Actual collision radius
    influenceRadius: number; // Visual distortion radius
    hue: number; // Color variation
    pulsePhase: number; // For animation
    theme: BlackHoleTheme;
    teleportCount: number;
    lastVisited: number; // 0 = never visited
}

const BLACK_HOLE_THEMES: BlackHoleTheme[] = [
    {
        name: 'memory',
        hueRange: [30, 50],
        vocabularyPool: [
            'recall', 'fragment', 'echo', 'nostalgia', 'imprint', 'trace', 'remnant',
            'ghost', 'residue', 'memoir', 'forgotten', 'faded', 'sepia', 'album',
            'snapshot', 'relic', 'heirloom', 'diary', 'inscription', 'palimpsest',
            'afterimage', 'deja-vu', 'reverie', 'recollection', 'keepsake', 'bygone',
            'wistful', 'memorial', 'vestige', 'patina', 'amber', 'timepiece',
            'reminiscence', 'souvenir', 'chronicle'
        ]
    },
    {
        name: 'nature',
        hueRange: [120, 160],
        vocabularyPool: [
            'root', 'canopy', 'pollen', 'moss', 'current', 'erosion', 'bloom',
            'thorn', 'spore', 'lichen', 'mycelium', 'tendril', 'watershed', 'estuary',
            'migration', 'symbiosis', 'dormant', 'germinate', 'photosynthesis', 'sediment',
            'petrified', 'fossil', 'loam', 'strata', 'tidal', 'monsoon',
            'permafrost', 'delta', 'aquifer', 'understory', 'rhizome', 'cascade',
            'meadow', 'pollinate', 'biome'
        ]
    },
    {
        name: 'technology',
        hueRange: [190, 220],
        vocabularyPool: [
            'circuit', 'protocol', 'binary', 'recursive', 'compile', 'algorithm', 'signal',
            'bandwidth', 'latency', 'buffer', 'kernel', 'daemon', 'payload', 'checksum',
            'encrypt', 'decrypt', 'pipeline', 'runtime', 'syntax', 'debug',
            'firmware', 'voltage', 'transistor', 'bitwise', 'overclock', 'cache',
            'interrupt', 'register', 'handshake', 'throughput', 'subroutine', 'overflow',
            'telemetry', 'interface', 'bytecode'
        ]
    },
    {
        name: 'emotion',
        hueRange: [310, 340],
        vocabularyPool: [
            'yearning', 'grief', 'euphoria', 'dread', 'tenderness', 'longing', 'solace',
            'anguish', 'rapture', 'melancholy', 'serenity', 'fervor', 'remorse', 'elation',
            'desolation', 'compassion', 'restless', 'bittersweet', 'vulnerability', 'catharsis',
            'intimacy', 'abandon', 'torment', 'bliss', 'hollow', 'warmth',
            'trembling', 'wistfulness', 'devotion', 'sorrow', 'exhilaration', 'resignation',
            'comfort', 'unease', 'adoration'
        ]
    },
    {
        name: 'violence',
        hueRange: [0, 15],
        vocabularyPool: [
            'shatter', 'fracture', 'rupture', 'collision', 'entropy', 'decay', 'scar',
            'wreckage', 'impact', 'debris', 'tremor', 'eruption', 'detonation', 'rift',
            'corrosion', 'erosion', 'splinter', 'severance', 'puncture', 'abrasion',
            'aftermath', 'demolition', 'fissure', 'friction', 'turbulence', 'combustion',
            'concussion', 'avalanche', 'upheaval', 'implosion', 'disintegration', 'scorch',
            'obliterate', 'breach', 'ruin'
        ]
    },
    {
        name: 'cosmic',
        hueRange: [260, 300],
        vocabularyPool: [
            'void', 'abyss', 'singularity', 'eternity', 'cosmic', 'infinite',
            'gravitation', 'warped', 'event', 'horizon', 'spacetime', 'collapse',
            'quantum', 'entangled', 'nebula', 'stellar', 'dark', 'matter',
            'antimatter', 'photon', 'quasar', 'pulsar', 'neutron', 'gravity',
            'curvature', 'relativity', 'dimensional', 'wormhole', 'portal',
            'fabric', 'continuum', 'distortion', 'paradox', 'entropy', 'chaos'
        ]
    }
];

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
    private readonly sessionId = Math.random().toString(36).slice(2, 8);
    private cachedStoryKeywords: string[] = [];
    private storyKeywordsFetched = false;

    // Configuration
    private readonly INITIAL_BLACK_HOLES = 2;
    private readonly MIN_HOLE_DISTANCE = 2400; // Minimum distance between black holes
    private readonly GENERATION_DISTANCE = 3500; // Generate new holes when worm explores beyond this
    private readonly AMBIENT_WORDS_PER_HOLE = 40;
    private readonly TELEPORT_COOLDOWN = 2000; // ms
    private readonly TELEPORT_FLASH_DURATION = 300; // ms

    private lastTeleportTime = 0;
    private teleportFlashOpacity = 0;
    private nearestHoleId: string | null = null; // For proximity warning
    // 3-phase teleport transition
    private teleportPhase: 'idle' | 'fadeOut' | 'themed' | 'fadeIn' = 'idle';
    private teleportPhaseTimer = 0;
    private teleportExitHue = 260;
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

        // Fetch story keywords for seeding into black hole ambient words
        this.fetchStoryKeywords();

        // Generate initial black hole network
        this.generateInitialBlackHoles();

        // Listen for worm position updates to generate new holes
        this.engine.events.on('INPUT_START', this.checkForNewHoleGeneration);

        // Listen for clicks to eat ambient words
        this.engine.events.on('INPUT_START', this.handleEatAttempt);
    }

    private async fetchStoryKeywords() {
        if (this.storyKeywordsFetched) return;
        try {
            const wormId = this.engine.wormState?.activeWormId;
            if (!wormId) return;
            const res = await fetch(`/api/story/${wormId}`);
            const data = await res.json();
            if (data.hasStory && data.segments) {
                const unrevealed: string[] = [];
                for (const seg of data.segments) {
                    if (!seg.revealed && seg.keywordProgress) {
                        for (const kp of seg.keywordProgress) {
                            if (!kp.inVocab) {
                                unrevealed.push(kp.fullKeyword);
                            }
                        }
                    }
                }
                this.cachedStoryKeywords = unrevealed;
                console.log(`[BlackHole] Cached ${unrevealed.length} unrevealed story keywords`);
            }
        } catch (err) {
            console.warn('[BlackHole] Failed to fetch story keywords:', err);
        }
        this.storyKeywordsFetched = true;
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

        // Update 3-phase teleport transition
        if (this.teleportPhase !== 'idle') {
            this.teleportPhaseTimer += dt;
            if (this.teleportPhase === 'fadeOut' && this.teleportPhaseTimer >= 400) {
                this.teleportPhase = 'themed';
                this.teleportPhaseTimer = 0;
            } else if (this.teleportPhase === 'themed' && this.teleportPhaseTimer >= 400) {
                this.teleportPhase = 'fadeIn';
                this.teleportPhaseTimer = 0;
            } else if (this.teleportPhase === 'fadeIn' && this.teleportPhaseTimer >= 700) {
                this.teleportPhase = 'idle';
                this.teleportPhaseTimer = 0;
            }
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

        // Draw teleport transition effect
        if (this.teleportPhase !== 'idle') {
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
        const theme = BLACK_HOLE_THEMES[Math.floor(Math.random() * BLACK_HOLE_THEMES.length)];
        const hue = theme.hueRange[0] + Math.random() * (theme.hueRange[1] - theme.hueRange[0]);
        const hole: BlackHole = {
            id: `blackhole-${this.nextBlackHoleId++}`,
            x,
            y,
            radius,
            eventHorizon: radius,
            influenceRadius: radius * 5, // 5x for gravitational effects
            hue,
            pulsePhase: Math.random() * Math.PI * 2,
            theme,
            teleportCount: 0,
            lastVisited: 0
        };

        this.blackHoles.push(hole);

        // Generate ambient words around this black hole
        this.generateAmbientWords(hole);

        console.log(`[BlackHole] Created ${theme.name} hole at (${x.toFixed(0)}, ${y.toFixed(0)}) hue=${hue.toFixed(0)}`);
    }

    private generateAmbientWords(hole: BlackHole) {
        // Build word pool: themed vocabulary + 2-3 story keywords mixed in
        const pool = [...hole.theme.vocabularyPool];
        if (this.cachedStoryKeywords.length > 0) {
            const shuffledKeywords = [...this.cachedStoryKeywords].sort(() => Math.random() - 0.5);
            const keywordsToInject = shuffledKeywords.slice(0, 2 + Math.floor(Math.random() * 2)); // 2-3
            pool.push(...keywordsToInject);
        }

        for (let i = 0; i < this.AMBIENT_WORDS_PER_HOLE; i++) {
            const word = pool[Math.floor(Math.random() * pool.length)];
            const orbitRadius = hole.influenceRadius * (0.4 + Math.random() * 0.5);
            const orbitAngle = Math.random() * Math.PI * 2;
            const orbitSpeed = 0.1 + Math.random() * 0.2; // radians per second

            // Make 100% edible cosmic vocabulary!
            const isEdible = true;

            this.ambientWords.push({
                id: `ambient-${this.sessionId}-${this.nextWordId++}`,
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
        if (!hasHoleAhead && Math.random() < 0.12) {
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

        // Sanity cost/reward
        worm.sanity = Math.max(0, worm.sanity - 15); // teleport cost
        if (exitHole.lastVisited === 0) {
            // Discovery bonus for first visit
            worm.sanity = Math.min(100, worm.sanity + 20);
            this.engine.events.emit(EVENTS.JOURNAL_ENTRY, `Drifted into a ${exitHole.theme.name} dimension. The air tastes different here.`);
        }
        exitHole.lastVisited = performance.now();
        exitHole.teleportCount++;

        // Start 3-phase visual transition
        this.teleportPhase = 'fadeOut';
        this.teleportPhaseTimer = 0;
        this.teleportExitHue = exitHole.hue;
        this.lastTeleportTime = now;

        // Emit event with theme info
        this.engine.events.emit(EVENTS.WORMHOLE_TELEPORT, {
            entryHoleId,
            exitHoleId: exitHole.id,
            wormId: worm.id,
            exitTheme: exitHole.theme
        });

        console.log(`[BlackHole] Worm teleported from ${entryHoleId} to ${exitHole.id} (${exitHole.theme.name})`);
    }

    // ==================== Drawing ====================

    private drawBlackHoles(ctx: CanvasRenderingContext2D) {
        const t = performance.now() * 0.001;

        for (const hole of this.blackHoles) {
            ctx.save();

            const isNearby = this.nearestHoleId === hole.id;
            const pulse = Math.sin(hole.pulsePhase * (isNearby ? 2.0 : 1.0)) * 0.5 + 0.5;
            const eh = hole.eventHorizon;

            // --- 1. Gravitational lensing glow (large soft halo) ---
            const lensRadius = eh * 3.5;
            const lensGrad = ctx.createRadialGradient(
                hole.x, hole.y, eh * 0.8,
                hole.x, hole.y, lensRadius
            );
            lensGrad.addColorStop(0, `hsla(${hole.hue}, 60%, 15%, 0.25)`);
            lensGrad.addColorStop(0.3, `hsla(${hole.hue}, 50%, 10%, 0.12)`);
            lensGrad.addColorStop(0.6, `hsla(${hole.hue + 20}, 40%, 8%, 0.05)`);
            lensGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = lensGrad;
            ctx.beginPath();
            ctx.arc(hole.x, hole.y, lensRadius, 0, Math.PI * 2);
            ctx.fill();

            // --- 2. Accretion disk (elliptical, tilted) ---
            const diskOuterRadius = eh * 2.4;
            const diskInnerRadius = eh * 1.15;
            const diskTilt = 0.35; // Y-axis compression to simulate tilt
            const diskRotation = t * 0.15 + hole.hue * 0.01;

            ctx.save();
            ctx.translate(hole.x, hole.y);
            ctx.rotate(diskRotation);
            ctx.scale(1, diskTilt);

            // Multiple disk layers for depth
            for (let layer = 0; layer < 3; layer++) {
                const layerRadius = diskOuterRadius - layer * (diskOuterRadius - diskInnerRadius) / 3;
                const layerAlpha = (0.08 + layer * 0.04) * (isNearby ? 1.5 : 1.0);
                const layerHue = hole.hue + layer * 15;

                const diskGrad = ctx.createRadialGradient(0, 0, diskInnerRadius, 0, 0, layerRadius);
                diskGrad.addColorStop(0, `hsla(${layerHue + 30}, 90%, 70%, ${layerAlpha * 1.5})`);
                diskGrad.addColorStop(0.3, `hsla(${layerHue + 15}, 85%, 55%, ${layerAlpha})`);
                diskGrad.addColorStop(0.7, `hsla(${layerHue}, 70%, 40%, ${layerAlpha * 0.6})`);
                diskGrad.addColorStop(1, `hsla(${layerHue - 10}, 50%, 20%, 0)`);

                ctx.fillStyle = diskGrad;
                ctx.beginPath();
                ctx.arc(0, 0, layerRadius, 0, Math.PI * 2);
                ctx.fill();
            }

            // Hot bright inner edge
            const innerGlow = ctx.createRadialGradient(0, 0, eh * 1.0, 0, 0, diskInnerRadius * 1.3);
            innerGlow.addColorStop(0, `hsla(${hole.hue + 40}, 100%, 85%, ${0.3 * (isNearby ? 1.4 : 1.0)})`);
            innerGlow.addColorStop(0.5, `hsla(${hole.hue + 20}, 95%, 65%, 0.15)`);
            innerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = innerGlow;
            ctx.beginPath();
            ctx.arc(0, 0, diskInnerRadius * 1.3, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();

            // --- 3. Photon ring (thin bright ring at the edge of the shadow) ---
            const photonRadius = eh * 1.08;
            const photonAlpha = (0.4 + pulse * 0.25) * (isNearby ? 1.3 : 1.0);
            ctx.strokeStyle = `hsla(${hole.hue + 30}, 90%, 75%, ${photonAlpha})`;
            ctx.lineWidth = isNearby ? 2.5 : 1.5;
            ctx.beginPath();
            ctx.arc(hole.x, hole.y, photonRadius, 0, Math.PI * 2);
            ctx.stroke();

            // Second photon ring (dimmer, slightly larger)
            ctx.strokeStyle = `hsla(${hole.hue + 15}, 80%, 60%, ${photonAlpha * 0.4})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(hole.x, hole.y, eh * 1.18, 0, Math.PI * 2);
            ctx.stroke();

            // --- 4. Event horizon shadow (pure black circle) ---
            const shadowGrad = ctx.createRadialGradient(
                hole.x, hole.y, 0,
                hole.x, hole.y, eh
            );
            shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
            shadowGrad.addColorStop(0.85, 'rgba(0, 0, 0, 1)');
            shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
            ctx.fillStyle = shadowGrad;
            ctx.beginPath();
            ctx.arc(hole.x, hole.y, eh, 0, Math.PI * 2);
            ctx.fill();

            // --- 5. Orbital particles (bits of matter in the accretion disk) ---
            const particleCount = isNearby ? 40 : 24;
            for (let i = 0; i < particleCount; i++) {
                const seed = hole.hue * 100 + i * 137.508; // golden angle distribution
                const orbitR = diskInnerRadius + (diskOuterRadius - diskInnerRadius) * ((i * 0.618) % 1);
                const speed = 0.3 + (1.0 / (orbitR / eh)) * 0.5; // faster closer in (Kepler-ish)
                const angle = seed + t * speed;
                const px = hole.x + Math.cos(angle) * orbitR;
                const py = hole.y + Math.sin(angle) * orbitR * diskTilt;

                const particleHue = hole.hue + 20 + Math.sin(seed) * 30;
                const particleBright = 50 + (1 - (orbitR - diskInnerRadius) / (diskOuterRadius - diskInnerRadius)) * 40;
                const particleAlpha = 0.3 + pulse * 0.15 + Math.sin(seed * 2.3) * 0.1;
                const particleSize = 1 + Math.sin(seed * 3.7) * 0.8;

                ctx.fillStyle = `hsla(${particleHue}, 85%, ${particleBright}%, ${particleAlpha})`;
                ctx.beginPath();
                ctx.arc(px, py, particleSize, 0, Math.PI * 2);
                ctx.fill();
            }

            // --- 6. Proximity warning glow ---
            if (isNearby) {
                const warningGrad = ctx.createRadialGradient(
                    hole.x, hole.y, eh,
                    hole.x, hole.y, eh * 2.0
                );
                warningGrad.addColorStop(0, `hsla(${hole.hue}, 90%, 60%, ${pulse * 0.15})`);
                warningGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = warningGrad;
                ctx.beginPath();
                ctx.arc(hole.x, hole.y, eh * 2.0, 0, Math.PI * 2);
                ctx.fill();
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

        // No distortion — just position and opacity
        const rotation = 0;
        const scaleX = 1;
        const scaleY = 1;

        // Opacity: fade out when close to event horizon
        const eventHorizonProximity = Math.max(0, 1 - (dist - hole.eventHorizon) / (hole.influenceRadius * 0.3));
        const opacity = Math.max(0, 1 - eventHorizonProximity * 0.7) * (0.3 + influence * 0.4);

        return {
            x,
            y,
            rotation,
            scaleX,
            scaleY,
            opacity
        };
    }

    private drawTeleportFlash(ctx: CanvasRenderingContext2D) {
        const cx = this.engine.cameraPos.x;
        const cy = this.engine.cameraPos.y;
        const w = this.engine.width;
        const h = this.engine.height;
        const left = cx - w;
        const top = cy - h;
        const fullW = w * 2;
        const fullH = h * 2;

        ctx.save();

        if (this.teleportPhase === 'fadeOut') {
            // Phase 1: Fade to black (0-400ms)
            const t = Math.min(this.teleportPhaseTimer / 400, 1);
            const opacity = t * t; // ease-in
            ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
            ctx.fillRect(left, top, fullW, fullH);
        } else if (this.teleportPhase === 'themed') {
            // Phase 2: Black with theme color bleeding from edges
            const t = Math.min(this.teleportPhaseTimer / 400, 1);
            // Full black background
            ctx.fillStyle = 'rgba(0, 0, 0, 1)';
            ctx.fillRect(left, top, fullW, fullH);
            // Radial gradient of theme color from edges inward
            const hue = this.teleportExitHue;
            const glowAlpha = 0.3 + t * 0.4;
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h));
            grad.addColorStop(0, `hsla(${hue}, 80%, 30%, 0)`);
            grad.addColorStop(0.5, `hsla(${hue}, 70%, 20%, ${glowAlpha * 0.3})`);
            grad.addColorStop(0.8, `hsla(${hue}, 90%, 40%, ${glowAlpha * 0.6})`);
            grad.addColorStop(1, `hsla(${hue}, 100%, 50%, ${glowAlpha})`);
            ctx.fillStyle = grad;
            ctx.fillRect(left, top, fullW, fullH);
        } else if (this.teleportPhase === 'fadeIn') {
            // Phase 3: Fade from black to clear, theme glow lingers
            const t = Math.min(this.teleportPhaseTimer / 700, 1);
            const opacity = 1 - t * t; // ease-out
            ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
            ctx.fillRect(left, top, fullW, fullH);
            // Lingering theme glow
            const hue = this.teleportExitHue;
            const glowAlpha = (1 - t) * 0.3;
            if (glowAlpha > 0.01) {
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h));
                grad.addColorStop(0, `hsla(${hue}, 80%, 30%, 0)`);
                grad.addColorStop(0.7, `hsla(${hue}, 70%, 25%, ${glowAlpha * 0.4})`);
                grad.addColorStop(1, `hsla(${hue}, 90%, 40%, ${glowAlpha})`);
                ctx.fillStyle = grad;
                ctx.fillRect(left, top, fullW, fullH);
            }
        }

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
