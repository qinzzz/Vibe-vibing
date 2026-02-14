import { System, TextBlock, Token } from '../core/types';
import { Engine } from '../core/Engine';
import { BACKGROUND_PARAGRAPHS, LAYOUT_CONSTANTS } from '../constants';
import { tokenizeAndLayout } from '../utils/textLayout';
import { EVENTS } from '../core/events';
import { DiscoveryEngine } from './DiscoveryEngine';

type StormPhase = 'vortex' | 'alignment' | 'settling';
type StormLetterMode = 'advect' | 'settled';
type StormPlacement = 'anchor' | 'viewport';

interface Vec2 {
    x: number;
    y: number;
}

interface DockPath {
    points: Vec2[];
    arcS: number[];
    totalLength: number;
    travel: number;
}

interface StormLetter {
    id: string;
    char: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    targetX: number;
    targetY: number;
    drag: number;
    wobble: number;
    landed: boolean;
    mode: StormLetterMode;
    dockPath: DockPath | null;
}

interface NewsStorm {
    id: string;
    headline: string;
    phase: StormPhase;
    phaseClock: number;
    age: number;
    maxAge: number;
    center: { x: number; y: number };
    centerVel: { x: number; y: number };
    centerDrag: number;
    dissipateCenter: { x: number; y: number };
    windDir: { x: number; y: number };
    spin: 1 | -1;
    placement: StormPlacement;
    letters: StormLetter[];
    finalBlock: TextBlock;
    pathStart: { x: number; y: number };
    settledFrames: number;
    tuning: StormTuning;
}

interface StormDebugConfig {
    entryWind: number;
    entrySwirl: number;
    entrySpeed: number;
    dragStrength: number;
    targetPull: number;
    landingRadius: number;
    landingSpeed: number;
}

interface StormTuning {
    entryWind: number;
    entrySwirl: number;
    entrySpeed: number;
    dragStrength: number;
}

interface StormWeatherConfig {
    baseWindSpeed: number;
    speedVariance: number;
    volatility: number;
}

interface WeatherPhase {
    speed: number;
    wind: number;
    swirl: number;
    drag: number;
}

interface QueuedStorm {
    headline: string;
    placement: StormPlacement;
}

interface NewsHeadlineFeedItem {
    title?: string;
}

export class BackgroundSystem implements System {
    private engine!: Engine;
    private blocks: TextBlock[] = [];
    private isRegenerating = false;
    private regenParagraphsEnabled = true;
    private lastWordCount = 0;
    private nearbyWordCheckTimer = 0;
    private regenerationCooldownTimer = 0;
    private startupRegenerationDelay = 0;
    private readonly MIN_WORD_THRESHOLD = 30;
    private readonly NEARBY_WORD_CHECK_INTERVAL = 0.5; // seconds
    private readonly REGENERATION_COOLDOWN = 6.0; // seconds
    private readonly STARTUP_REGEN_GUARD = 4.0; // seconds
    private readonly SPAWN_MIN_DISTANCE = 150;
    private readonly SPAWN_MAX_DISTANCE = 700;

    private readonly STORM_MAX_FRAMES = 230;
    private readonly STORM_GOLDEN_ANGLE = 2.399963229728653;
    private readonly STORM_PATH_SAMPLES = 100;
    private readonly STORM_MODE_MAX_QUEUE = 4;

    private pendingToken: Token | null = null;
    private activeStorm: NewsStorm | null = null;
    private queuedStorms: QueuedStorm[] = [];
    private stormModeEnabled = false;
    private stormModeSpawnTimer = 0;
    private lastCameraPos: Vec2 | null = null;
    private weatherPhaseTimer = 0;
    private directionPhaseTimer = 0;
    private weatherPhase: WeatherPhase = { speed: 1, wind: 1, swirl: 1, drag: 1 };
    private prevailingWind: Vec2 = { x: 1, y: 0 };
    private prevailingTargetWind: Vec2 = { x: 1, y: 0 };
    private prevailingSpin: 1 | -1 = 1;
    private prevailingSpinTarget: 1 | -1 = 1;
    private stormWeather: StormWeatherConfig = {
        baseWindSpeed: 1.0,
        speedVariance: 0.22,
        volatility: 0.55
    };
    private stormDebug: StormDebugConfig = {
        entryWind: 0.74,
        entrySwirl: 0.52,
        entrySpeed: 0.7,
        dragStrength: 1.0,
        targetPull: 1.0,
        landingRadius: 1.0,
        landingSpeed: 1.0
    };
    private streamAvoidBaseY = 0;
    private streamAvoidHalfHeight = 0;
    private newsHeadlinePool: string[] = [];
    private newsHeadlineSeen: Set<string> = new Set();
    private newsHeadlineCursor = 0;
    private newsRefreshTimer: number | null = null;
    private isRefreshingNewsPool = false;
    private readonly NEWS_REFRESH_MS = 2 * 60 * 60 * 1000;
    private readonly NEWS_FETCH_LIMIT = 60;

    init(engine: Engine) {
        this.engine = engine;
        const activeWorm = engine.activeWorm;
        const wormHeight = engine.config.coreRadius * (activeWorm?.sizeMultiplier ?? 1);
        this.streamAvoidBaseY = (activeWorm?.corePos.y ?? engine.cameraPos.y) + wormHeight * 1.34;
        const streamWidth = this.clamp(engine.height * 0.35, 300, 450);
        this.streamAvoidHalfHeight = streamWidth * 0.5 + 92;
        this.lastCameraPos = { x: engine.cameraPos.x, y: engine.cameraPos.y };
        this.nearbyWordCheckTimer = this.NEARBY_WORD_CHECK_INTERVAL;
        this.regenerationCooldownTimer = 0;
        this.startupRegenerationDelay = this.STARTUP_REGEN_GUARD;
        const initialAngle = (Math.random() - 0.5) * Math.PI * 2;
        this.prevailingWind = { x: Math.cos(initialAngle), y: Math.sin(initialAngle) };
        this.prevailingTargetWind = { ...this.prevailingWind };
        this.prevailingSpin = Math.random() > 0.5 ? 1 : -1;
        this.prevailingSpinTarget = this.prevailingSpin;
        this.initBackgroundText();
        this.refreshNewsHeadlinePool();
        this.newsRefreshTimer = window.setInterval(this.refreshNewsHeadlinePool, this.NEWS_REFRESH_MS);

        this.engine.events.on('INPUT_START', this.handleInput);
        this.engine.events.on(EVENTS.WORD_RELEASED, this.handleWordReleased);
        this.engine.events.on(EVENTS.NEWS_STORM_TRIGGERED, this.handleNewsStormTriggered);
        this.engine.events.on(EVENTS.NEWS_STORM_DEBUG_UPDATED, this.handleNewsStormDebugUpdated);
        this.engine.events.on(EVENTS.NEWS_STORM_MODE_UPDATED, this.handleNewsStormModeUpdated);
        this.engine.events.on(EVENTS.NEWS_STORM_WEATHER_UPDATED, this.handleNewsStormWeatherUpdated);
        this.engine.events.on(EVENTS.TOGGLE_REGEN_PARAGRAPHS, (data: { enabled: boolean }) => {
            this.regenParagraphsEnabled = data.enabled;
            console.log(`[BACKGROUND] Paragraph regeneration ${data.enabled ? 'enabled' : 'disabled'}`);
        });

        this.engine.events.on(EVENTS.GAME_RESET, () => {
            this.blocks = [];
            this.activeStorm = null;
            this.queuedStorms = [];
            this.nearbyWordCheckTimer = 0;
            this.regenerationCooldownTimer = 0;
            this.startupRegenerationDelay = this.STARTUP_REGEN_GUARD;
        });

        // World shift on wormhole teleport: age existing blocks and regenerate with theme
        this.engine.events.on(EVENTS.WORMHOLE_TELEPORT, (data: { exitTheme?: { name: string } }) => {
            console.log(`[BACKGROUND] Wormhole teleport detected, shifting world to "${data.exitTheme?.name || 'unknown'}" dimension`);
            // Age all existing blocks to 35+ so they fade out rapidly
            for (const block of this.blocks) {
                if ((block.age ?? 0) < 35) {
                    block.age = 35;
                }
            }
            // After 1s delay, regenerate with themed content
            const themeName = data.exitTheme?.name;
            setTimeout(() => {
                this.regenerateWordsWithTheme(themeName);
            }, 1000);
        });
    }

    private handleWordReleased = (data: { text: string; pos: { x: number; y: number } }) => {
        const ctx = this.engine.ctx;
        const block = tokenizeAndLayout(data.text, data.pos.x, data.pos.y, ctx);
        this.blocks.push(block);
    };

    private handleNewsStormTriggered = (payload?: {
        headline?: string;
        placement?: StormPlacement;
        immediate?: boolean;
    }) => {
        const worm = this.engine.activeWorm;
        if (!worm || !DiscoveryEngine.isFeatureEnabled(worm, 'NEWS_STORM')) return;

        const headline = payload?.headline?.trim()
            || this.pickStormHeadline()
            || this.generateSimulatedHeadline();
        const density = this.getOnScreenDensity();
        if (density.paragraphs > 4 || density.standaloneWords > 10) {
            console.log(`[NEWS] Storm suppressed due to density (P:${density.paragraphs}, W:${density.standaloneWords})`);
            return;
        }

        this.enqueueStorm({
            headline,
            placement: payload?.placement ?? 'anchor',
            immediate: payload?.immediate ?? true
        });
    };

    private handleNewsStormDebugUpdated = (payload?: Partial<StormDebugConfig>) => {
        if (!payload) return;
        this.stormDebug = {
            entryWind: this.clamp(payload.entryWind ?? this.stormDebug.entryWind, 0.1, 2.0),
            entrySwirl: this.clamp(payload.entrySwirl ?? this.stormDebug.entrySwirl, 0.1, 2.0),
            entrySpeed: this.clamp(payload.entrySpeed ?? this.stormDebug.entrySpeed, 0.3, 3.0),
            dragStrength: this.clamp(payload.dragStrength ?? this.stormDebug.dragStrength, 0.2, 3.0),
            targetPull: this.clamp(payload.targetPull ?? this.stormDebug.targetPull, 0.2, 2.5),
            landingRadius: this.clamp(payload.landingRadius ?? this.stormDebug.landingRadius, 0.3, 2.5),
            landingSpeed: this.clamp(payload.landingSpeed ?? this.stormDebug.landingSpeed, 0.3, 2.5)
        };
    };

    private handleNewsStormModeUpdated = (payload?: { enabled?: boolean }) => {
        const enabled = Boolean(payload?.enabled);
        this.stormModeEnabled = enabled;
        this.stormModeSpawnTimer = enabled ? this.nextStormModeDelayFrames(true) : 0;
        this.weatherPhaseTimer = enabled ? this.nextWeatherPhaseDurationFrames() : 0;
        this.directionPhaseTimer = enabled ? this.nextDirectionPhaseDurationFrames() : 0;
        if (enabled) {
            this.reseedWeatherPhase();
            this.reseedPrevailingDirection(false);
            this.refreshNewsHeadlinePool();
        } else {
            this.weatherPhase = { speed: 1, wind: 1, swirl: 1, drag: 1 };
            this.prevailingTargetWind = { ...this.prevailingWind };
            this.prevailingSpinTarget = this.prevailingSpin;
        }
        if (!enabled) {
            this.queuedStorms = [];
        }
    };

    private handleNewsStormWeatherUpdated = (payload?: Partial<StormWeatherConfig>) => {
        if (!payload) return;
        this.stormWeather = {
            baseWindSpeed: this.clamp(payload.baseWindSpeed ?? this.stormWeather.baseWindSpeed, 0.5, 2.2),
            speedVariance: this.clamp(payload.speedVariance ?? this.stormWeather.speedVariance, 0, 1.1),
            volatility: this.clamp(payload.volatility ?? this.stormWeather.volatility, 0.1, 1.0)
        };
    };

    private resolveStormTuning(placement: StormPlacement): StormTuning {
        const base: StormTuning = {
            entryWind: this.stormDebug.entryWind,
            entrySwirl: this.stormDebug.entrySwirl,
            entrySpeed: this.stormDebug.entrySpeed,
            dragStrength: this.stormDebug.dragStrength
        };

        const variance = this.stormWeather.speedVariance;
        const sampledWindSpeed = this.clamp(
            this.stormWeather.baseWindSpeed + this.randomRange(-variance, variance),
            0.5,
            2.2
        );
        const speedWindFactor = this.clamp(0.88 + (sampledWindSpeed - 1) * 0.65, 0.58, 1.75);
        const speedDragFactor = this.clamp(1.08 - (sampledWindSpeed - 1) * 0.35, 0.55, 1.45);
        const phase = this.stormModeEnabled ? this.weatherPhase : { speed: 1, wind: 1, swirl: 1, drag: 1 };
        const shouldVary = this.stormModeEnabled || placement === 'viewport';
        if (!shouldVary) {
            return {
                entryWind: this.clamp(base.entryWind * speedWindFactor, 0.16, 1.9),
                entrySwirl: this.clamp(base.entrySwirl, 0.14, 1.9),
                entrySpeed: this.clamp(base.entrySpeed * sampledWindSpeed, 0.45, 1.5),
                dragStrength: this.clamp(base.dragStrength * speedDragFactor, 0.55, 2.1)
            };
        }

        const profileRoll = Math.random();
        let profile = { wind: 1.0, swirl: 1.0, speed: 1.0, drag: 1.0 };
        if (profileRoll < 0.24) {
            // broad heavy front
            profile = { wind: 1.18, swirl: 0.82, speed: 0.9, drag: 1.2 };
        } else if (profileRoll < 0.5) {
            // clean directional stream
            profile = { wind: 1.06, swirl: 0.95, speed: 1.0, drag: 1.05 };
        } else if (profileRoll < 0.76) {
            // curled eddy
            profile = { wind: 0.92, swirl: 1.22, speed: 0.96, drag: 0.95 };
        } else {
            // relaxed drift band
            profile = { wind: 0.84, swirl: 0.88, speed: 0.86, drag: 1.08 };
        }

        const volatility = this.stormWeather.volatility;
        const jitter = 0.06 + volatility * 0.09;

        return {
            entryWind: this.clamp(
                base.entryWind * speedWindFactor * phase.wind * profile.wind + this.randomRange(-jitter, jitter),
                0.16,
                1.9
            ),
            entrySwirl: this.clamp(
                base.entrySwirl * phase.swirl * profile.swirl + this.randomRange(-jitter, jitter),
                0.14,
                1.9
            ),
            entrySpeed: this.clamp(
                base.entrySpeed * sampledWindSpeed * phase.speed * profile.speed + this.randomRange(-jitter * 0.7, jitter * 0.7),
                0.45,
                1.5
            ),
            dragStrength: this.clamp(
                base.dragStrength * speedDragFactor * phase.drag * profile.drag + this.randomRange(-jitter * 1.1, jitter * 1.1),
                0.55,
                2.1
            )
        };
    }

    private updateWeatherPhase(dt: number) {
        if (!this.stormModeEnabled) return;
        const step = dt / 16.66;
        this.weatherPhaseTimer -= step;
        if (this.weatherPhaseTimer > 0) return;
        this.reseedWeatherPhase();
        this.weatherPhaseTimer = this.nextWeatherPhaseDurationFrames();
    }

    private updatePrevailingWindField(dt: number) {
        if (!this.stormModeEnabled) return;
        const step = dt / 16.66;
        this.directionPhaseTimer -= step;
        if (this.directionPhaseTimer <= 0) {
            this.reseedPrevailingDirection(true);
            this.directionPhaseTimer = this.nextDirectionPhaseDurationFrames();
        }

        const volatility = this.stormWeather.volatility;
        const turnPerFrame = this.lerp(0.002, 0.008, volatility);
        this.prevailingWind = this.rotateTowards(
            this.prevailingWind,
            this.prevailingTargetWind,
            turnPerFrame * step
        );
        if (!this.activeStorm) {
            this.prevailingSpin = this.prevailingSpinTarget;
        }
    }

    private nextWeatherPhaseDurationFrames() {
        const volatility = this.stormWeather.volatility;
        const minFrames = this.lerp(640, 320, volatility);
        const maxFrames = this.lerp(1260, 760, volatility);
        return this.randomRange(minFrames, maxFrames);
    }

    private nextDirectionPhaseDurationFrames() {
        const volatility = this.stormWeather.volatility;
        return this.randomRange(this.lerp(1800, 1200, volatility), this.lerp(3600, 2400, volatility));
    }

    private reseedPrevailingDirection(allowLargeShift: boolean) {
        const currentAngle = Math.atan2(this.prevailingTargetWind.y, this.prevailingTargetWind.x);
        const smallShift = this.lerp(0.08, 0.24, this.stormWeather.volatility);
        const largeShift = this.lerp(0.32, 0.68, this.stormWeather.volatility);
        const doLarge = allowLargeShift && Math.random() < this.lerp(0.04, 0.12, this.stormWeather.volatility);
        const shiftRange = doLarge ? largeShift : smallShift;
        const delta = this.randomRange(-shiftRange, shiftRange);
        const nextAngle = currentAngle + delta;
        this.prevailingTargetWind = { x: Math.cos(nextAngle), y: Math.sin(nextAngle) };

        if (doLarge && Math.random() < this.lerp(0.04, 0.12, this.stormWeather.volatility)) {
            this.prevailingSpinTarget = (this.prevailingSpinTarget === 1 ? -1 : 1);
        }
    }

    private reseedWeatherPhase() {
        const roll = Math.random();
        let preset: WeatherPhase = { speed: 1, wind: 1, swirl: 1, drag: 1 };
        if (roll < 0.18) {
            // deep front
            preset = { speed: 0.84, wind: 1.18, swirl: 0.82, drag: 1.2 };
        } else if (roll < 0.46) {
            // steady carrier wind
            preset = { speed: 1.0, wind: 1.05, swirl: 0.95, drag: 1.02 };
        } else if (roll < 0.72) {
            // gust field
            preset = { speed: 1.18, wind: 1.12, swirl: 0.9, drag: 0.9 };
        } else {
            // curled pocket
            preset = { speed: 1.04, wind: 0.92, swirl: 1.24, drag: 0.92 };
        }

        const vol = this.stormWeather.volatility;
        const jitter = 0.05 + vol * 0.12;
        this.weatherPhase = {
            speed: this.clamp(preset.speed + this.randomRange(-jitter, jitter), 0.72, 1.38),
            wind: this.clamp(preset.wind + this.randomRange(-jitter, jitter), 0.72, 1.38),
            swirl: this.clamp(preset.swirl + this.randomRange(-jitter, jitter), 0.68, 1.45),
            drag: this.clamp(preset.drag + this.randomRange(-jitter, jitter), 0.68, 1.45)
        };
    }

    private initBackgroundText() {
        this.blocks = [];
        const attempts = 100;
        const ctx = this.engine.ctx;

        const wormId = this.engine.wormState?.activeWormId;
        const url = wormId ? `/api/world-text?wormId=${encodeURIComponent(wormId)}` : '/api/world-text';

        fetch(url)
            .then(res => res.json())
            .then(data => {
                const paragraphs = data.paragraphs || BACKGROUND_PARAGRAPHS;
                this.generateBlocks(paragraphs, attempts, ctx);
            })
            .catch(err => {
                console.error('Failed to load world text', err);
                this.generateBlocks(BACKGROUND_PARAGRAPHS, attempts, ctx);
            });
    }

    private getSpawnAnchor() {
        const activeWorm = this.engine.wormState.worms.get(this.engine.wormState.activeWormId);
        return activeWorm?.corePos || this.engine.cameraPos;
    }

    private getSpawnPosition() {
        const anchor = this.getSpawnAnchor();
        const angle = Math.random() * Math.PI * 2;
        const radius = this.SPAWN_MIN_DISTANCE + Math.random() * (this.SPAWN_MAX_DISTANCE - this.SPAWN_MIN_DISTANCE);
        return {
            x: anchor.x + Math.cos(angle) * radius,
            y: anchor.y + Math.sin(angle) * radius
        };
    }

    private hasPresentTokens(block: TextBlock) {
        return block.tokens.some(token => token.state === 'present');
    }

    private blocksOverlap(a: TextBlock, b: TextBlock, padding: number) {
        return (
            a.x < b.x + b.width + padding &&
            a.x + a.width > b.x - padding &&
            a.y < b.y + b.height + padding &&
            a.y + a.height > b.y - padding
        );
    }

    private canPlaceBlock(testBlock: TextBlock, padding = 50, avoidStream = false) {
        if (avoidStream && this.overlapsStreamLane(testBlock, padding)) return false;

        // Density Check: Max 10 tokens in 150px radius
        const radius = 150;
        const radiusSq = radius * radius;
        let localCount = 0;
        const centerX = testBlock.x + testBlock.width / 2;
        const centerY = testBlock.y + testBlock.height / 2;

        for (const block of this.blocks) {
            for (const token of block.tokens) {
                if (token.state === 'present') {
                    const dx = token.x + token.width / 2 - centerX;
                    const dy = token.y + token.height / 2 - centerY;
                    if (dx * dx + dy * dy < radiusSq) {
                        localCount++;
                    }
                }
            }
        }

        if (localCount > 10) return false;

        return !this.blocks.some(block => this.hasPresentTokens(block) && this.blocksOverlap(testBlock, block, padding));
    }

    private overlapsStreamLane(block: TextBlock, padding = 0) {
        const minY = this.streamAvoidBaseY - this.streamAvoidHalfHeight - padding;
        const maxY = this.streamAvoidBaseY + this.streamAvoidHalfHeight + padding;
        return block.y < maxY && (block.y + block.height) > minY;
    }

    private generateBlocks(paragraphs: string[], attempts: number, ctx: CanvasRenderingContext2D) {
        for (let i = 0; i < LAYOUT_CONSTANTS.MAX_BLOCKS; i++) {
            const text = paragraphs[i % paragraphs.length];
            let placed = false;

            for (let j = 0; j < attempts; j++) {
                const spawn = this.getSpawnPosition();
                const testBlock = tokenizeAndLayout(text, spawn.x, spawn.y, ctx);

                if (this.canPlaceBlock(testBlock, 50, true)) {
                    testBlock.age = 0;
                    testBlock.opacity = 0; // Initial opacity for fade-in
                    this.blocks.push(testBlock);
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                console.log('[BACKGROUND] Could not place initial paragraph');
            }
        }
    }

    private enqueueStorm(options: { headline: string; placement: StormPlacement; immediate?: boolean }) {
        const immediate = Boolean(options.immediate);

        if (immediate) {
            if (this.activeStorm) {
                this.forceCompleteStorm(this.activeStorm);
            }
            this.startNewsStorm(options.headline, options.placement);
            return;
        }

        if (!this.activeStorm) {
            this.startNewsStorm(options.headline, options.placement);
            return;
        }

        if (this.queuedStorms.length < this.STORM_MODE_MAX_QUEUE) {
            this.queuedStorms.push({ headline: options.headline, placement: options.placement });
        }
    }

    private startQueuedStormIfIdle() {
        if (this.activeStorm || this.queuedStorms.length === 0) return;
        const next = this.queuedStorms.shift();
        if (!next) return;
        this.startNewsStorm(next.headline, next.placement);
    }

    private startNewsStorm(headline: string, placement: StormPlacement = 'anchor') {
        const path = this.buildStormPath(placement);
        const finalBlock = this.resolveLandingBlock(headline, path.dissipateCenter.x, path.dissipateCenter.y);
        const tuning = this.resolveStormTuning(placement);

        const storm: NewsStorm = {
            id: `storm-${Date.now()}`,
            headline,
            phase: 'vortex',
            phaseClock: 0,
            age: 0,
            maxAge: this.STORM_MAX_FRAMES,
            center: { ...path.startCenter },
            centerVel: { ...path.centerVel },
            centerDrag: path.centerDrag,
            dissipateCenter: { ...path.dissipateCenter },
            windDir: { ...path.windDir },
            spin: path.spin,
            placement,
            letters: [],
            finalBlock,
            pathStart: { ...path.startCenter },
            settledFrames: 0,
            tuning
        };

        storm.letters = this.createStormLetters(storm, finalBlock);
        this.applyAirflowDisplacement(storm);
        this.activeStorm = storm;
    }

    private buildStormPath(placement: StormPlacement) {
        if (placement === 'viewport') {
            return this.buildViewportStormPath();
        }

        const anchor = this.getSpawnAnchor();
        const halfW = this.engine.width / 2;
        const halfH = this.engine.height / 2;

        const leftToRight = Math.random() > 0.5;
        const startCenter = {
            x: anchor.x + (leftToRight ? -halfW - 170 : halfW + 170),
            y: anchor.y + (Math.random() - 0.5) * halfH * 0.7
        };

        const dissipateCenter = {
            x: anchor.x + (Math.random() - 0.5) * halfW * 0.5,
            y: anchor.y + (Math.random() - 0.5) * halfH * 0.34
        };

        const centerDrag = 0.992;
        const centerVel = {
            x: (dissipateCenter.x - startCenter.x) * (1 - centerDrag),
            y: (dissipateCenter.y - startCenter.y) * (1 - centerDrag)
        };

        let windDir = this.normalize(centerVel);
        if (Math.hypot(windDir.x, windDir.y) < 0.001) {
            windDir = leftToRight ? { x: 1, y: 0 } : { x: -1, y: 0 };
        }

        const spin: 1 | -1 = Math.random() > 0.5 ? 1 : -1;

        return {
            startCenter,
            dissipateCenter,
            centerVel,
            centerDrag,
            windDir,
            spin
        };
    }

    private buildViewportStormPath() {
        const anchor = this.engine.cameraPos;
        const halfW = this.engine.width / 2;
        const halfH = this.engine.height / 2;
        let baseWind = this.normalize(this.prevailingWind);
        if (Math.hypot(baseWind.x, baseWind.y) < 0.001) {
            baseWind = { x: 1, y: 0 };
        }

        const dirJitter = this.lerp(0.004, 0.02, this.stormWeather.volatility);
        const windDir = this.normalize(this.rotateVector(baseWind, this.randomRange(-dirJitter, dirJitter)));
        const safeWind = Math.hypot(windDir.x, windDir.y) < 0.001 ? baseWind : windDir;
        const perp = { x: -safeWind.y, y: safeWind.x };
        const offscreen = 220;
        const spawnCandidates = [
            {
                x: anchor.x - halfW - offscreen,
                y: anchor.y + this.randomRange(-halfH * 0.95, halfH * 0.2)
            },
            {
                x: anchor.x + halfW + offscreen,
                y: anchor.y + this.randomRange(-halfH * 0.95, halfH * 0.2)
            },
            {
                x: anchor.x + this.randomRange(-halfW * 1.05, halfW * 1.05),
                y: anchor.y - halfH - offscreen
            }
        ];
        let startCenter = spawnCandidates[0];
        let bestScore = Number.POSITIVE_INFINITY;
        for (const candidate of spawnCandidates) {
            const rel = { x: candidate.x - anchor.x, y: candidate.y - anchor.y };
            const upwindScore = rel.x * safeWind.x + rel.y * safeWind.y;
            const noisyScore = upwindScore + this.randomRange(-halfW * 0.08, halfW * 0.08);
            if (noisyScore < bestScore) {
                bestScore = noisyScore;
                startCenter = candidate;
            }
        }
        startCenter = {
            x: startCenter.x,
            y: Math.min(startCenter.y, anchor.y + halfH * 0.25)
        };

        const mostlyOnscreen = Math.random() < 0.78;
        let dissipateCenter = mostlyOnscreen
            ? {
                x: anchor.x + this.randomRange(-halfW * 0.58, halfW * 0.58),
                y: anchor.y + this.randomRange(-halfH * 0.46, halfH * 0.46)
            }
            : {
                x: anchor.x + this.randomRange(-halfW * 1.22, halfW * 1.22),
                y: anchor.y + this.randomRange(-halfH * 0.95, halfH * 0.95)
            };
        dissipateCenter = {
            x: dissipateCenter.x + safeWind.x * this.randomRange(30, 160),
            y: dissipateCenter.y + safeWind.y * this.randomRange(30, 160)
        };
        const rawDelta = { x: dissipateCenter.x - startCenter.x, y: dissipateCenter.y - startCenter.y };
        const along = this.clamp(
            rawDelta.x * safeWind.x + rawDelta.y * safeWind.y,
            380,
            Math.max(1100, this.engine.width * 1.8)
        );
        const across = this.clamp(
            rawDelta.x * perp.x + rawDelta.y * perp.y,
            -halfH * 0.52,
            halfH * 0.52
        );
        dissipateCenter = {
            x: startCenter.x + safeWind.x * along + perp.x * across,
            y: startCenter.y + safeWind.y * along + perp.y * across
        };

        const centerDrag = 0.992;
        const centerVel = {
            x: (dissipateCenter.x - startCenter.x) * (1 - centerDrag),
            y: (dissipateCenter.y - startCenter.y) * (1 - centerDrag)
        };

        const wind = safeWind;
        const altSpinChance = this.lerp(0.08, 0.2, this.stormWeather.volatility);
        const spin: 1 | -1 = Math.random() < altSpinChance
            ? (this.prevailingSpin === 1 ? -1 : 1)
            : this.prevailingSpin;

        return {
            startCenter,
            dissipateCenter,
            centerVel,
            centerDrag,
            windDir: wind,
            spin
        };
    }

    private resolveLandingBlock(headline: string, desiredCenterX: number, desiredCenterY: number) {
        const maxWidth = Math.max(260, Math.min(420, this.engine.width * 0.48));
        let fallback = this.layoutHeadlineBlock(headline, desiredCenterX, desiredCenterY, maxWidth);
        if (this.canPlaceBlock(fallback, 30)) return fallback;

        for (let i = 1; i <= 48; i++) {
            const radius = 14 + i * 11;
            const angle = i * this.STORM_GOLDEN_ANGLE;
            const x = desiredCenterX + Math.cos(angle) * radius;
            const y = desiredCenterY + Math.sin(angle) * radius;
            const candidate = this.layoutHeadlineBlock(headline, x, y, maxWidth);

            if (this.canPlaceBlock(candidate, 30)) {
                return candidate;
            }

            fallback = candidate;
        }

        return fallback;
    }

    private layoutHeadlineBlock(text: string, centerX: number, centerY: number, maxWidth: number): TextBlock {
        const ctx = this.engine.ctx;
        const words = text.trim().split(/\s+/).filter(Boolean);
        const lineHeight = LAYOUT_CONSTANTS.LINE_HEIGHT;
        const fontSize = LAYOUT_CONSTANTS.FONT_SIZE;
        ctx.font = `${fontSize}px monospace`;
        const spaceWidth = ctx.measureText(' ').width;

        const lines: string[][] = [];
        const lineWidths: number[] = [];
        let currentLine: string[] = [];
        let currentWidth = 0;

        for (const word of words) {
            const wordWidth = ctx.measureText(word).width;
            const isFirstWord = currentLine.length === 0;
            const testWidth = isFirstWord ? wordWidth : currentWidth + spaceWidth + wordWidth;

            if (!isFirstWord && testWidth > maxWidth) {
                lines.push(currentLine);
                lineWidths.push(currentWidth);
                currentLine = [word];
                currentWidth = wordWidth;
            } else {
                currentLine.push(word);
                currentWidth = testWidth;
            }
        }

        if (currentLine.length > 0) {
            lines.push(currentLine);
            lineWidths.push(currentWidth);
        }

        const measuredWidth = Math.max(...lineWidths, 0);
        const width = Math.max(measuredWidth, 1);
        const height = Math.max(lineHeight, lines.length * lineHeight);
        const top = centerY - height / 2;

        const tokens: Token[] = [];

        lines.forEach((lineWords, lineIndex) => {
            const lineWidth = lineWidths[lineIndex];
            let cursorX = centerX - lineWidth / 2;
            const lineY = top + lineIndex * lineHeight;

            lineWords.forEach((word, wordIndex) => {
                if (wordIndex > 0) cursorX += spaceWidth;

                const tokenWidth = ctx.measureText(word).width;
                const tokenId = `${Date.now().toString(36)}-${lineIndex}-${wordIndex}-${Math.random().toString(36).slice(2, 8)}`;
                const letters = [] as Token['letters'];
                let charCursor = cursorX;

                for (let i = 0; i < word.length; i++) {
                    const char = word[i];
                    const charWidth = ctx.measureText(char).width;
                    letters.push({
                        char,
                        x: charCursor + charWidth / 2,
                        y: lineY + fontSize / 2,
                        tokenId
                    });
                    charCursor += charWidth;
                }

                tokens.push({
                    id: tokenId,
                    text: word,
                    x: cursorX,
                    y: lineY,
                    width: tokenWidth,
                    height: fontSize,
                    state: 'present',
                    letters
                });

                cursorX += tokenWidth;
            });
        });

        return {
            id: `headline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            tokens,
            x: centerX - width / 2,
            y: top,
            width,
            height,
            age: 0,
            opacity: 0.15
        };
    }

    private createStormLetters(storm: NewsStorm, finalBlock: TextBlock): StormLetter[] {
        const letters: StormLetter[] = [];
        const finalCenter = {
            x: finalBlock.x + finalBlock.width / 2,
            y: finalBlock.y + finalBlock.height / 2
        };
        const letterTargets: Array<{ char: string; x: number; y: number }> = [];
        finalBlock.tokens.forEach(token => {
            token.letters.forEach(letter => {
                letterTargets.push({ char: letter.char, x: letter.x, y: letter.y });
            });
        });

        const total = Math.max(1, letterTargets.length);
        letterTargets.forEach((target, index) => {
            const spawn = this.getCoherentSpawnPosition(storm, index, total, { x: target.x, y: target.y }, finalCenter);
            const path = this.buildSwirlDockPath(
                storm,
                spawn,
                { x: target.x, y: target.y },
                finalCenter,
                index,
                total
            );
            const startSample = this.sampleDockPath(path, Math.min(path.totalLength, 1.4));
            const startSpeed = ((2 * path.totalLength) / storm.maxAge) * storm.tuning.entrySpeed;

            letters.push({
                id: `${storm.id}-${letters.length}`,
                char: target.char,
                x: spawn.x,
                y: spawn.y,
                vx: startSample.tangent.x * startSpeed,
                vy: startSample.tangent.y * startSpeed,
                targetX: target.x,
                targetY: target.y,
                drag: 1,
                wobble: Math.random() * Math.PI * 2,
                landed: false,
                mode: 'advect',
                dockPath: path
            });
        });

        return letters;
    }

    private getCoherentSpawnPosition(
        storm: NewsStorm,
        index: number,
        total: number,
        target: Vec2,
        finalCenter: Vec2
    ) {
        const forward = this.normalize(storm.windDir);
        const safeForward = Math.hypot(forward.x, forward.y) < 0.0001 ? { x: 1, y: 0 } : forward;
        const perp = { x: -safeForward.y, y: safeForward.x };
        const t = total > 1 ? index / (total - 1) : 0.5;
        const lane = (t - 0.5) * (190 + storm.tuning.entryWind * 130);
        const targetOffset = { x: target.x - finalCenter.x, y: target.y - finalCenter.y };
        const targetPerp = targetOffset.x * perp.x + targetOffset.y * perp.y;
        const laneShift = targetPerp * 0.22;
        const behind = 230 + storm.tuning.entryWind * 140 + Math.abs(t - 0.5) * 70;

        return {
            x: storm.pathStart.x - safeForward.x * behind + perp.x * (lane + laneShift),
            y: storm.pathStart.y - safeForward.y * behind + perp.y * (lane + laneShift)
        };
    }

    private buildSwirlDockPath(
        storm: NewsStorm,
        spawn: Vec2,
        target: Vec2,
        finalCenter: Vec2,
        index: number,
        total: number
    ): DockPath {
        const points: Vec2[] = [];
        const forward = this.normalize(storm.windDir);
        const safeForward = Math.hypot(forward.x, forward.y) < 0.0001 ? { x: 1, y: 0 } : forward;
        const perp = { x: -safeForward.y * storm.spin, y: safeForward.x * storm.spin };
        const stormTravelDistance = Math.hypot(
            storm.dissipateCenter.x - storm.pathStart.x,
            storm.dissipateCenter.y - storm.pathStart.y
        );
        const screenSpan = Math.max(this.engine.width, this.engine.height);
        const travelNorm = this.clamp(
            (stormTravelDistance - screenSpan * 0.4) / Math.max(1, screenSpan * 1.25),
            0,
            1
        );
        const distanceSwirlScale = this.lerp(0.82, 1.28, travelNorm);
        const distanceRadiusScale = this.lerp(0.86, 1.24, travelNorm);
        const distancePhaseDelay = this.lerp(-0.04, 0.06, travelNorm);
        const targetOffset = {
            x: target.x - finalCenter.x,
            y: target.y - finalCenter.y
        };
        const targetDist = Math.hypot(targetOffset.x, targetOffset.y);
        const targetAngle = targetDist > 0.0001
            ? Math.atan2(targetOffset.y, targetOffset.x)
            : index * this.STORM_GOLDEN_ANGLE * storm.spin;
        const stormRadiusStart = (175 + storm.tuning.entryWind * 150) * distanceRadiusScale;
        const radiusSeed = (index * 0.6180339887498949) % 1;
        const bandScale = 0.72 + radiusSeed * 0.62;
        const ringThickness = (radiusSeed - 0.5) * (82 + storm.tuning.entryWind * 44);
        const radiusStart = stormRadiusStart * bandScale + ringThickness;
        const turns = (1.55 + storm.tuning.entrySwirl * 1.0) * distanceSwirlScale;
        const thetaStart = storm.spin * turns * Math.PI * 2;
        const captureEnd = this.clamp(0.25 + (1 - storm.tuning.entryWind) * 0.1, 0.2, 0.36);
        const alignStart = this.clamp(0.83 + (radiusSeed - 0.5) * 0.1 + distancePhaseDelay, 0.76, 0.92);
        const blendStart = this.clamp(alignStart + 0.01 + (radiusSeed - 0.5) * 0.06, 0.8, 0.93);
        const spinFadeStart = this.clamp(alignStart - (0.16 + radiusSeed * 0.04), 0.54, alignStart - 0.05);
        const crossStream = (targetOffset.x * perp.x + targetOffset.y * perp.y) * 0.22;
        const alongStream = (targetOffset.x * safeForward.x + targetOffset.y * safeForward.y) * 0.12;
        const lateralAmp = 1.8 + storm.tuning.entrySwirl * 3.2;
        const lateralPhase = targetAngle * 0.35;

        for (let i = 0; i <= this.STORM_PATH_SAMPLES; i++) {
            const u = i / this.STORM_PATH_SAMPLES;
            const travel = (2 * u) - (u * u);
            const decay = Math.pow(1 - u, 1.08);
            const alignMix = this.smoothstep((u - alignStart) / (1 - alignStart));
            const finalMix = this.smoothstep((u - blendStart) / (1 - blendStart));
            const preAlignMix = this.smoothstep(u / alignStart);
            const spinFade = this.smoothstep((u - spinFadeStart) / Math.max(0.01, alignStart - spinFadeStart));
            const spinMix = Math.pow(Math.max(0, 1 - spinFade), 1.45);
            const theta = targetAngle + thetaStart * Math.pow(1 - u, 1.05) * spinMix;
            const finalRadius = Math.max(1, targetDist);
            const preAlignRadiusTarget = Math.max(
                finalRadius + 3,
                finalRadius * 1.08 + ringThickness * 0.1
            );
            const radiusBeforeAlign = this.lerp(radiusStart, preAlignRadiusTarget, preAlignMix);
            const radius = this.lerp(radiusBeforeAlign, finalRadius, alignMix);
            const swirlOffset = {
                x: Math.cos(theta) * radius,
                y: Math.sin(theta) * radius * 0.86
            };
            const center = {
                x: this.lerp(storm.pathStart.x, finalCenter.x, travel),
                y: this.lerp(storm.pathStart.y, finalCenter.y, travel)
            };
            const orbit = {
                x: center.x + swirlOffset.x + perp.x * crossStream * (1 - finalMix) + safeForward.x * alongStream * (1 - finalMix),
                y: center.y + swirlOffset.y + perp.y * crossStream * (1 - finalMix) + safeForward.y * alongStream * (1 - finalMix)
            };
            const finalPoint = {
                x: center.x + targetOffset.x,
                y: center.y + targetOffset.y
            };
            const sideTheta = theta + storm.spin * Math.PI * 0.5 + lateralPhase;
            const sideOffset = {
                x: perp.x * Math.cos(sideTheta) * lateralAmp * decay,
                y: perp.y * Math.cos(sideTheta) * lateralAmp * decay
            };
            const residual = {
                x: orbit.x - finalPoint.x,
                y: orbit.y - finalPoint.y
            };
            const residualBlend = Math.pow(finalMix, 0.75 + radiusSeed * 0.7);
            const residualScale = 1 - residualBlend;
            const pathPoint = {
                x: finalPoint.x + residual.x * residualScale + sideOffset.x,
                y: finalPoint.y + residual.y * residualScale + sideOffset.y
            };
            const captureMix = this.smoothstep(u / captureEnd);

            points.push({
                x: this.lerp(spawn.x, pathPoint.x, captureMix),
                y: this.lerp(spawn.y, pathPoint.y, captureMix)
            });
        }

        points[0] = { ...spawn };
        points[points.length - 1] = { ...target };
        return this.buildPolylinePath(points);
    }

    private getOffscreenSpawnPosition(storm: NewsStorm) {
        const perp = { x: -storm.windDir.y, y: storm.windDir.x };
        const behind = 90 + Math.random() * 210;
        const across = (Math.random() - 0.5) * 220;

        return {
            x: storm.pathStart.x - storm.windDir.x * behind + perp.x * across,
            y: storm.pathStart.y - storm.windDir.y * behind + perp.y * across
        };
    }

    private getNearbySpawnPosition(storm: NewsStorm) {
        const perp = { x: -storm.windDir.y, y: storm.windDir.x };
        const alongT = 0.28 + Math.random() * 0.54;
        const base = {
            x: storm.pathStart.x + (storm.dissipateCenter.x - storm.pathStart.x) * alongT,
            y: storm.pathStart.y + (storm.dissipateCenter.y - storm.pathStart.y) * alongT
        };
        const alongJitter = (Math.random() - 0.5) * 90;
        const acrossJitter = (Math.random() - 0.5) * 170;

        return {
            x: base.x + storm.windDir.x * alongJitter + perp.x * acrossJitter,
            y: base.y + storm.windDir.y * alongJitter + perp.y * acrossJitter
        };
    }

    private generateSimulatedHeadline() {
        const subjects = [
            'Coastal Grid',
            'Midnight Transit',
            'Global Markets',
            'Northern Ports',
            'Satellite Network',
            'Climate Desk',
            'City Assembly',
            'Quantum Lab'
        ];

        const verbs = [
            'stabilizes',
            're-routes',
            'recalibrates',
            'absorbs shock from',
            'signals caution on',
            'maps recovery after',
            'surges past',
            'reopens after'
        ];

        const objects = [
            'winter freight backlog',
            'cross-border outage',
            'overnight policy shift',
            'river corridor storm',
            'ocean heat anomaly',
            'late-cycle inflation wave',
            'autonomous rail trial',
            'continental wind event'
        ];

        const tails = [
            'as crews monitor pressure front',
            'while analysts watch second-order impacts',
            'with emergency channels still active',
            'as regional systems settle into slower flow',
            'after dawn update confirms partial recovery',
            'as local networks absorb residual turbulence'
        ];

        const subject = subjects[Math.floor(Math.random() * subjects.length)];
        const verb = verbs[Math.floor(Math.random() * verbs.length)];
        const object = objects[Math.floor(Math.random() * objects.length)];
        const tail = tails[Math.floor(Math.random() * tails.length)];

        return `${subject} ${verb} ${object} ${tail}`;
    }

    private refreshNewsHeadlinePool = async () => {
        if (this.isRefreshingNewsPool) return;
        this.isRefreshingNewsPool = true;

        try {
            const response = await fetch(`/api/news/headlines?limit=${this.NEWS_FETCH_LIMIT}`);
            if (!response.ok) {
                throw new Error(`headline pool request failed: ${response.status}`);
            }

            const payload = await response.json();
            const rawItems: NewsHeadlineFeedItem[] = Array.isArray(payload?.headlines) ? payload.headlines : [];
            let added = 0;

            for (const item of rawItems) {
                const title = typeof item?.title === 'string' ? item.title.trim().replace(/\s+/g, ' ') : '';
                if (!title) continue;
                const key = title.toLowerCase();
                if (this.newsHeadlineSeen.has(key)) continue;
                this.newsHeadlineSeen.add(key);
                this.newsHeadlinePool.push(title);
                added++;
            }

            if (added > 0 && this.newsHeadlinePool.length === added) {
                this.newsHeadlineCursor = Math.floor(Math.random() * this.newsHeadlinePool.length);
            }

            console.log(
                `[NEWS] Storm pool refresh: added=${added}, total=${this.newsHeadlinePool.length}, source=${payload?.source || 'unknown'}`
            );
        } catch (err) {
            console.error('[NEWS] Storm pool refresh failed:', err);
        } finally {
            this.isRefreshingNewsPool = false;
        }
    };

    private pickStormHeadline() {
        if (this.newsHeadlinePool.length === 0) return null;
        const index = this.newsHeadlineCursor % this.newsHeadlinePool.length;
        this.newsHeadlineCursor = (this.newsHeadlineCursor + 1) % this.newsHeadlinePool.length;
        return this.newsHeadlinePool[index];
    }

    private applyAirflowDisplacement(storm: NewsStorm) {
        const flowRadius = 210;

        this.blocks.forEach(block => {
            block.tokens.forEach(token => {
                if (token.state !== 'present') return;

                const cx = token.x + token.width / 2;
                const cy = token.y + token.height / 2;

                const segment = this.distanceToSegment(
                    { x: cx, y: cy },
                    storm.pathStart,
                    storm.dissipateCenter
                );

                if (segment.distance >= flowRadius) return;

                const influence = 1 - segment.distance / flowRadius;
                const away = this.normalize({
                    x: cx - segment.nearest.x,
                    y: cy - segment.nearest.y
                });

                const push = (3 + 10 * influence) * (0.5 + Math.random() * 0.5);
                const dx = (storm.windDir.x * push * 0.72 + away.x * push * 0.56) * influence;
                const dy = (storm.windDir.y * push * 0.72 + away.y * push * 0.56) * influence;

                this.shiftToken(token, dx, dy);
            });
        });
    }

    private shiftToken(token: Token, dx: number, dy: number) {
        token.x += dx;
        token.y += dy;
        token.letters.forEach(letter => {
            letter.x += dx;
            letter.y += dy;
        });
    }

    private shiftBlock(block: TextBlock, dx: number, dy: number) {
        block.x += dx;
        block.y += dy;
        block.tokens.forEach(token => {
            this.shiftToken(token, dx, dy);
        });
    }

    private distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abLenSq = abx * abx + aby * aby;
        const safeLenSq = abLenSq > 0 ? abLenSq : 1;

        let t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / safeLenSq;
        t = this.clamp(t, 0, 1);

        const nearest = {
            x: a.x + abx * t,
            y: a.y + aby * t
        };

        const dx = point.x - nearest.x;
        const dy = point.y - nearest.y;

        return {
            distance: Math.hypot(dx, dy),
            nearest
        };
    }

    private handleInput = (pos: { x: number; y: number }) => {
        const { x, y } = pos;
        this.pendingToken = null;

        const INTERACTION_OPACITY_THRESHOLD = 0.02;

        for (const block of this.blocks) {
            if ((block.opacity ?? 0.15) < INTERACTION_OPACITY_THRESHOLD) continue;

            const token = block.tokens.find(t =>
                t.state === 'present' &&
                x >= t.x && x <= t.x + t.width &&
                y >= t.y && y <= t.y + t.height
            );

            if (token) {
                this.pendingToken = token;
                break;
            }
        }
    };

    private updateAgingAndDrift(dtSec: number) {
        const t = performance.now() * 0.001;

        // Anti-Overlap: Separation Pass
        const padding = 10;
        for (let i = 0; i < this.blocks.length; i++) {
            const a = this.blocks[i];
            if (!this.hasPresentTokens(a)) continue;

            for (let j = i + 1; j < this.blocks.length; j++) {
                const b = this.blocks[j];
                if (!this.hasPresentTokens(b)) continue;

                if (this.blocksOverlap(a, b, padding)) {
                    // Calculate repulsive force
                    const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
                    const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

                    const force = 0.5; // Pixels per frame
                    const shiftX = (dx / dist) * force;
                    const shiftY = (dy / dist) * force;

                    this.shiftBlock(a, shiftX, shiftY);
                    this.shiftBlock(b, -shiftX, -shiftY);
                }
            }
        }

        for (const block of this.blocks) {
            if (block.age === undefined) block.age = 0;
            block.age += dtSec;

            // Fade-In: 0 to 0.15 over 2 seconds
            const fadeInDuration = 2.0;
            const fadeInProgress = this.clamp(block.age / fadeInDuration, 0, 1);
            const baseOpacity = 0.15;

            // Fading: Decays from baseOpacity starting after 10s, gone at 40s
            const startFade = 10;
            const endFade = 40;
            const fadeProgress = this.clamp((block.age - startFade) / (endFade - startFade), 0, 1);
            block.opacity = this.lerp(baseOpacity * fadeInProgress, 0.0, fadeProgress);

            // Subtle Drift: Recedes as it ages
            if (block.age > startFade) {
                const driftScale = fadeProgress * 0.2; // Max 0.2px/frame drift
                const noiseX = this.valueNoise2D(block.x * 0.01, t * 0.1);
                const noiseY = this.valueNoise2D(block.y * 0.01 + 100, t * 0.1);

                const dx = noiseX * driftScale;
                const dy = noiseY * driftScale;

                block.x += dx;
                block.y += dy;
                block.tokens.forEach(token => {
                    token.x += dx;
                    token.y += dy;
                    token.letters.forEach(letter => {
                        letter.x += dx;
                        letter.y += dy;
                    });
                });
            }
        }

        // Culling: Remove blocks older than 45s (fully faded by 40s)
        const initialCount = this.blocks.length;
        this.blocks = this.blocks.filter(b => (b.age ?? 0) < 45);
        if (this.blocks.length < initialCount) {
            console.log(`[BACKGROUND] Culled ${initialCount - this.blocks.length} aged-out blocks.`);
        }
    }

    update(dt: number) {
        this.lockViewportStormToCanvas();
        const dtSec = dt / 1000;

        this.updateAgingAndDrift(dtSec);
        this.nearbyWordCheckTimer -= dtSec;
        this.regenerationCooldownTimer = Math.max(0, this.regenerationCooldownTimer - dtSec);
        this.startupRegenerationDelay = Math.max(0, this.startupRegenerationDelay - dtSec);

        const { x, y } = this.engine.mousePos;
        let anyHovered = false;

        const INTERACTION_OPACITY_THRESHOLD = 0.08;
        for (const block of this.blocks) {
            const isVisible = (block.opacity ?? 0.15) >= INTERACTION_OPACITY_THRESHOLD;
            for (const token of block.tokens) {
                if (token.state === 'present' && isVisible) {
                    const isOver = x >= token.x && x <= token.x + token.width &&
                        y >= token.y && y <= token.y + token.height;
                    token.isHovered = isOver;
                    if (isOver) anyHovered = true;
                } else {
                    token.isHovered = false;
                }
            }
        }

        // Other systems can also mark edible hover state in the same frame (e.g. stream words).
        this.engine.blobState.isHoveringEdible = this.engine.blobState.isHoveringEdible || anyHovered;

        if (this.pendingToken) {
            const core = this.engine.blobState.corePos;
            const tx = this.pendingToken.x + this.pendingToken.width / 2;
            const ty = this.pendingToken.y + this.pendingToken.height / 2;
            const dist = Math.sqrt((core.x - tx) ** 2 + (core.y - ty) ** 2);

            const INTERACTION_OPACITY_THRESHOLD = 0.08;
            // Find parent block to check opacity
            const parentBlock = this.blocks.find(b => b.tokens.includes(this.pendingToken!));
            const isVisible = (parentBlock?.opacity ?? 0.15) >= INTERACTION_OPACITY_THRESHOLD;

            if (dist < 70 && isVisible) {
                this.pendingToken.state = 'eaten';
                this.engine.events.emit(EVENTS.TOKEN_EATEN, {
                    id: this.pendingToken.id,
                    text: this.pendingToken.text,
                    pos: { x: tx, y: ty }
                });
                this.pendingToken = null;
            } else if (dist < 70 && !isVisible) {
                // Forget invisible pending tokens
                this.pendingToken = null;
            }
        }

        this.updateNewsStorm(dt);
        this.updateStormMode(dt);
        this.startQueuedStormIfIdle();
        if (this.nearbyWordCheckTimer <= 0) {
            this.nearbyWordCheckTimer += this.NEARBY_WORD_CHECK_INTERVAL;
            this.checkAndRegenerateWords();
        }
    }

    private lockViewportStormToCanvas() {
        const current = { x: this.engine.cameraPos.x, y: this.engine.cameraPos.y };
        if (!this.lastCameraPos) {
            this.lastCameraPos = current;
            return;
        }

        const dx = current.x - this.lastCameraPos.x;
        const dy = current.y - this.lastCameraPos.y;
        this.lastCameraPos = current;
        if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return;

        const storm = this.activeStorm;
        if (!storm || storm.placement !== 'viewport') return;
        this.shiftStormBy(storm, dx, dy);
    }

    private shiftStormBy(storm: NewsStorm, dx: number, dy: number) {
        storm.center.x += dx;
        storm.center.y += dy;
        storm.pathStart.x += dx;
        storm.pathStart.y += dy;
        storm.dissipateCenter.x += dx;
        storm.dissipateCenter.y += dy;

        storm.finalBlock.x += dx;
        storm.finalBlock.y += dy;
        storm.finalBlock.tokens.forEach(token => {
            token.x += dx;
            token.y += dy;
            token.letters.forEach(letter => {
                letter.x += dx;
                letter.y += dy;
            });
        });

        storm.letters.forEach(letter => {
            letter.x += dx;
            letter.y += dy;
            letter.targetX += dx;
            letter.targetY += dy;
            if (letter.dockPath) {
                letter.dockPath.points.forEach(point => {
                    point.x += dx;
                    point.y += dy;
                });
            }
        });
    }

    private updateStormMode(dt: number) {
        if (!this.stormModeEnabled) return;
        const worm = this.engine.activeWorm;
        if (!worm || !DiscoveryEngine.isFeatureEnabled(worm, 'NEWS_STORM')) return;

        this.updateWeatherPhase(dt);
        this.updatePrevailingWindField(dt);

        const step = dt / 16.66;
        this.stormModeSpawnTimer -= step;
        if (this.stormModeSpawnTimer > 0) return;

        if (this.queuedStorms.length < this.STORM_MODE_MAX_QUEUE) {
            const density = this.getOnScreenDensity();
            if (density.paragraphs <= 4 && density.standaloneWords <= 10) {
                this.enqueueStorm({
                    headline: this.pickStormHeadline() || this.generateSimulatedHeadline(),
                    placement: 'viewport',
                    immediate: false
                });
            }
        }
        this.stormModeSpawnTimer = this.nextStormModeDelayFrames(false);
    }

    private updateNewsStorm(dt: number) {
        const storm = this.activeStorm;
        if (!storm) return;

        const step = dt / 16.66;
        storm.phaseClock += step;
        storm.age += step;

        let landedCount = 0;
        const u = this.clamp(storm.age / storm.maxAge, 0, 1);
        const centerDragStep = Math.pow(storm.centerDrag, step);
        storm.center.x += storm.centerVel.x * step;
        storm.center.y += storm.centerVel.y * step;
        storm.centerVel.x *= centerDragStep;
        storm.centerVel.y *= centerDragStep;

        for (const letter of storm.letters) {
            if (letter.mode === 'settled' || letter.landed) {
                landedCount++;
                continue;
            }

            const path = letter.dockPath;
            if (!path) {
                letter.x = letter.targetX;
                letter.y = letter.targetY;
                letter.vx = 0;
                letter.vy = 0;
                letter.landed = true;
                letter.mode = 'settled';
                landedCount++;
                continue;
            }

            const dragExponent = this.clamp(storm.tuning.dragStrength, 0.2, 3.0);
            const normalizedBase = ((dragExponent + 1) * path.totalLength) / storm.maxAge;
            const baseSpeed = normalizedBase * this.clamp(storm.tuning.entrySpeed, 0.85, 1.15);
            const scheduledSpeed = Math.max(0, baseSpeed * Math.pow(1 - u, dragExponent));
            const progress = 1 - Math.pow(1 - u, dragExponent + 1);
            const desiredTravel = path.totalLength * progress;
            path.travel = Math.max(path.travel, Math.min(path.totalLength, desiredTravel));

            const sample = this.sampleDockPath(path, path.travel);
            const prevX = letter.x;
            const prevY = letter.y;
            const easeBlend = this.smoothstep((u - 0.9) / 0.1);
            const rawRemaining = Math.hypot(letter.targetX - sample.point.x, letter.targetY - sample.point.y);
            const distanceBlend = this.smoothstep((14 - rawRemaining) / 14);
            const settleBlend = this.clamp(Math.max(easeBlend * 0.68, distanceBlend * 0.82), 0, 0.95);
            let candidateX = this.lerp(sample.point.x, letter.targetX, settleBlend);
            let candidateY = this.lerp(sample.point.y, letter.targetY, settleBlend);
            let vx = (candidateX - prevX) / step;
            let vy = (candidateY - prevY) / step;
            const maxSpeed = Math.max(0.0001, scheduledSpeed * 1.05);
            const speed = Math.hypot(vx, vy);
            if (speed > maxSpeed) {
                const scale = maxSpeed / speed;
                vx *= scale;
                vy *= scale;
                candidateX = prevX + vx * step;
                candidateY = prevY + vy * step;
            }

            letter.mode = 'advect';
            letter.x = candidateX;
            letter.y = candidateY;
            letter.vx = vx;
            letter.vy = vy;

            const remaining = Math.hypot(letter.targetX - letter.x, letter.targetY - letter.y);
            if (u >= 0.9993 || path.travel >= path.totalLength - 0.06 || remaining <= 0.32) {
                letter.x = letter.targetX;
                letter.y = letter.targetY;
                letter.vx = 0;
                letter.vy = 0;
                letter.landed = true;
                letter.mode = 'settled';
                landedCount++;
            }
        }

        const phaseU = this.clamp(storm.age / storm.maxAge, 0, 1);
        if (phaseU < 0.45) {
            storm.phase = 'vortex';
        } else if (phaseU < 0.82) {
            storm.phase = 'alignment';
        } else {
            storm.phase = 'settling';
        }

        if (landedCount < storm.letters.length) {
            storm.settledFrames = 0;
            if (storm.age > storm.maxAge + 60) {
                this.forceCompleteStorm(storm);
            }
            return;
        }

        this.blocks.push(storm.finalBlock);
        this.activeStorm = null;
    }

    private buildPolylinePath(points: Vec2[]): DockPath {
        const cleaned: Vec2[] = [];
        for (const point of points) {
            const prev = cleaned[cleaned.length - 1];
            if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) > 0.0001) {
                cleaned.push({ x: point.x, y: point.y });
            }
        }

        if (cleaned.length === 0) {
            cleaned.push({ x: 0, y: 0 });
        }
        if (cleaned.length === 1) {
            cleaned.push({ x: cleaned[0].x + 0.0001, y: cleaned[0].y });
        }

        const arcS: number[] = [0];
        let totalLength = 0;

        for (let i = 1; i < cleaned.length; i++) {
            const prev = cleaned[i - 1];
            const next = cleaned[i];
            totalLength += Math.hypot(next.x - prev.x, next.y - prev.y);
            arcS.push(totalLength);
        }

        return {
            points: cleaned,
            arcS,
            totalLength: Math.max(totalLength, 0.0001),
            travel: 0
        };
    }

    private sampleDockPath(path: DockPath, travel: number) {
        const points = path.points;
        const safeTravel = this.clamp(travel, 0, path.totalLength);
        if (points.length < 2) {
            return {
                point: { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 },
                tangent: { x: 1, y: 0 }
            };
        }

        if (safeTravel <= 0) {
            const dx = points[1].x - points[0].x;
            const dy = points[1].y - points[0].y;
            const tangent = this.normalize({ x: dx, y: dy });
            return {
                point: { ...points[0] },
                tangent: Math.hypot(tangent.x, tangent.y) < 0.0001 ? { x: 1, y: 0 } : tangent
            };
        }

        for (let i = 1; i < path.arcS.length; i++) {
            const s1 = path.arcS[i];
            if (safeTravel <= s1) {
                const s0 = path.arcS[i - 1];
                const p0 = points[i - 1];
                const p1 = points[i];
                const span = Math.max(0.000001, s1 - s0);
                const t = (safeTravel - s0) / span;
                const tangent = this.normalize({ x: p1.x - p0.x, y: p1.y - p0.y });
                return {
                    point: {
                        x: this.lerp(p0.x, p1.x, t),
                        y: this.lerp(p0.y, p1.y, t)
                    },
                    tangent: Math.hypot(tangent.x, tangent.y) < 0.0001 ? { x: 1, y: 0 } : tangent
                };
            }
        }

        const last = points[points.length - 1];
        const prev = points[points.length - 2];
        const tangent = this.normalize({ x: last.x - prev.x, y: last.y - prev.y });
        return {
            point: { ...last },
            tangent: Math.hypot(tangent.x, tangent.y) < 0.0001 ? { x: 1, y: 0 } : tangent
        };
    }

    private getOnScreenDensity() {
        const cam = this.engine.cameraPos;
        const halfW = this.engine.width / 2;
        const halfH = this.engine.height / 2;
        const viewport = {
            minX: cam.x - halfW,
            maxX: cam.x + halfW,
            minY: cam.y - halfH,
            maxY: cam.y + halfH
        };

        let paragraphs = 0;
        let standaloneWords = 0;

        for (const block of this.blocks) {
            const isOnScreen = block.x + block.width > viewport.minX &&
                block.x < viewport.maxX &&
                block.y + block.height > viewport.minY &&
                block.y < viewport.maxY;

            if (isOnScreen) {
                const presentTokens = block.tokens.filter(t => t.state === 'present');
                if (presentTokens.length > 1) {
                    paragraphs++;
                } else if (presentTokens.length === 1) {
                    standaloneWords++;
                }
            }
        }

        return { paragraphs, standaloneWords };
    }

    private checkAndRegenerateWords() {
        const anchor = this.getSpawnAnchor();
        const radiusSq = this.SPAWN_MAX_DISTANCE * this.SPAWN_MAX_DISTANCE;
        let nearbyWordCount = 0;

        for (const block of this.blocks) {
            for (const token of block.tokens) {
                if (token.state === 'present') {
                    const cx = token.x + token.width / 2;
                    const cy = token.y + token.height / 2;
                    const dx = cx - anchor.x;
                    const dy = cy - anchor.y;
                    if ((dx * dx + dy * dy) <= radiusSq) {
                        nearbyWordCount++;
                    }
                }
            }
        }

        if (
            this.regenParagraphsEnabled &&
            this.startupRegenerationDelay <= 0 &&
            nearbyWordCount < this.MIN_WORD_THRESHOLD &&
            !this.isRegenerating &&
            this.regenerationCooldownTimer <= 0
        ) {
            console.log(`[BACKGROUND] Low nearby word count (${nearbyWordCount}), regenerating...`);
            this.lastWordCount = nearbyWordCount;
            this.regenerationCooldownTimer = this.REGENERATION_COOLDOWN;
            this.regenerateWords();
        } else {
            this.lastWordCount = nearbyWordCount;
        }
    }

    private async regenerateWords() {
        this.isRegenerating = true;

        try {
            this.blocks = this.blocks.filter(block => block.tokens.some(token => token.state === 'present'));
            console.log(`[BACKGROUND] Cleaned blocks, ${this.blocks.length} remaining`);

            const wormId = this.engine.wormState?.activeWormId;
            const response = await fetch('/api/generate-paragraphs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ count: 3, wormId })
            });

            const data = await response.json();
            const paragraphs = data.paragraphs || [];
            console.log(`[BACKGROUND] Generated ${paragraphs.length} new paragraphs`);

            const attempts = 50;
            const ctx = this.engine.ctx;

            for (let i = 0; i < paragraphs.length; i++) {
                const text = paragraphs[i];

                // Staggered appearance: delay each paragraph
                setTimeout(() => {
                    let placed = false;
                    for (let j = 0; j < attempts; j++) {
                        const spawn = this.getSpawnPosition();
                        const testBlock = tokenizeAndLayout(text, spawn.x, spawn.y, ctx);

                        if (this.canPlaceBlock(testBlock, 50, true)) {
                            testBlock.age = 0;
                            testBlock.opacity = 0; // Start invisible for fade-in
                            this.blocks.push(testBlock);
                            placed = true;
                            break;
                        }
                    }

                    if (!placed) {
                        console.log('[BACKGROUND] Could not place paragraph (no space)');
                    }
                }, i * 500); // 500ms stagger
            }
        } catch (err) {
            console.error('[BACKGROUND] Failed to regenerate words:', err);
        } finally {
            this.isRegenerating = false;
        }
    }

    private async regenerateWordsWithTheme(themeOverride?: string) {
        if (this.isRegenerating) return;
        this.isRegenerating = true;

        try {
            this.blocks = this.blocks.filter(block => block.tokens.some(token => token.state === 'present'));

            const wormId = this.engine.wormState?.activeWormId;
            const response = await fetch('/api/generate-paragraphs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ count: 3, wormId, themeOverride })
            });

            const data = await response.json();
            const paragraphs = data.paragraphs || [];
            console.log(`[BACKGROUND] Generated ${paragraphs.length} themed paragraphs (${themeOverride || 'default'})`);

            const attempts = 50;
            const ctx = this.engine.ctx;

            for (let i = 0; i < paragraphs.length; i++) {
                const text = paragraphs[i];
                setTimeout(() => {
                    let placed = false;
                    for (let j = 0; j < attempts; j++) {
                        const spawn = this.getSpawnPosition();
                        const testBlock = tokenizeAndLayout(text, spawn.x, spawn.y, ctx);
                        if (this.canPlaceBlock(testBlock, 50, true)) {
                            testBlock.age = 0;
                            testBlock.opacity = 0;
                            this.blocks.push(testBlock);
                            placed = true;
                            break;
                        }
                    }
                    if (!placed) {
                        console.log('[BACKGROUND] Could not place themed paragraph (no space)');
                    }
                }, i * 500);
            }
        } catch (err) {
            console.error('[BACKGROUND] Failed to regenerate themed words:', err);
        } finally {
            this.isRegenerating = false;
        }
    }

    draw(ctx: CanvasRenderingContext2D) {
        this.lockViewportStormToCanvas();

        ctx.font = `${LAYOUT_CONSTANTS.FONT_SIZE}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        this.drawStormWeather(ctx);

        const activeWorm = this.engine.activeWorm;
        const wormPos = activeWorm?.corePos || this.engine.cameraPos;

        this.blocks.forEach(block => {
            const blockOpacity = block.opacity ?? 0.15;

            // Distance-based culling: 50% nearby (<200px), 5% far (>1000px)
            const dx = (block.x + block.width / 2) - wormPos.x;
            const dy = (block.y + block.height / 2) - wormPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const distFactor = this.clamp(1 - (dist - 200) / (1000 - 200), 0.1, 1.0);
            const finalOpacity = blockOpacity * distFactor * 3.33; // Scale to 0.5 peak (0.15 * 3.33 = 0.5)

            block.tokens.forEach(token => {
                if (token.state === 'present') {
                    token.letters.forEach(letter => {
                        ctx.fillStyle = token.isHovered ? 'rgba(96, 165, 250, 0.8)' : `rgba(255, 255, 255, ${this.clamp(finalOpacity, 0, 1)})`;
                        ctx.fillText(letter.char, letter.x, letter.y);
                    });
                }
            });
        });

        this.drawActiveStorm(ctx);
    }

    private drawStormWeather(ctx: CanvasRenderingContext2D) {
        if (!this.stormModeEnabled) return;

        const left = this.engine.cameraPos.x - this.engine.width / 2;
        const top = this.engine.cameraPos.y - this.engine.height / 2;
        const center = {
            x: left + this.engine.width / 2,
            y: top + this.engine.height / 2
        };
        const t = performance.now() * 0.001;
        const activeWind = this.prevailingWind;
        const visualSpeed = this.clamp(this.stormWeather.baseWindSpeed * this.weatherPhase.speed, 0.5, 2.2);
        const speedNorm = this.clamp((visualSpeed - 0.5) / 1.7, 0, 1);
        const volatility = this.stormWeather.volatility;
        let wind = this.normalize(activeWind);
        if (Math.hypot(wind.x, wind.y) < 0.0001) {
            wind = { x: 1, y: 0 };
        }
        const perp = { x: -wind.y, y: wind.x };

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const fogAlpha = this.lerp(0.05, 0.11, speedNorm) * this.lerp(0.8, 1.0, volatility);
        ctx.fillStyle = `rgba(16, 24, 38, ${fogAlpha})`;
        ctx.fillRect(left, top, this.engine.width, this.engine.height);

        const alongSpan = this.engine.width * 2.1;
        const acrossSpan = this.engine.height * 2.2;
        const lineCap = 'round';
        ctx.lineCap = lineCap;

        const layerDefs = [
            { density: 0.84, speedMul: 1.15, lenMin: 8, lenMax: 20, alphaMin: 0.03, alphaMax: 0.06, sway: 1.6, lineWidth: 0.7 },
            { density: 1.18, speedMul: 1.65, lenMin: 12, lenMax: 30, alphaMin: 0.04, alphaMax: 0.085, sway: 2.2, lineWidth: 0.95 },
            { density: 0.98, speedMul: 2.3, lenMin: 18, lenMax: 46, alphaMin: 0.05, alphaMax: 0.11, sway: 3.0, lineWidth: 1.2 }
        ];
        const baseCount = Math.round(this.lerp(74, 168, speedNorm) * this.lerp(1.0, 1.34, volatility));

        layerDefs.forEach((layer, layerIndex) => {
            const count = Math.max(8, Math.round(baseCount * layer.density));
            ctx.lineWidth = layer.lineWidth;
            const driftBase = this.lerp(95, 240, speedNorm) * layer.speedMul;
            const swayAmount = layer.sway * this.lerp(0.8, 1.2, volatility);
            const alphaScale = this.lerp(1.6, 2.2, speedNorm);

            for (let i = 0; i < count; i++) {
                const seed = i * 97.41 + layerIndex * 733.19;
                const baseAlong = (seed * 13.71) % alongSpan;
                const baseAcross = (seed * 9.43) % acrossSpan;
                const drift = driftBase + (i % 7) * 7;
                const along = ((baseAlong + t * drift) % alongSpan) - alongSpan * 0.5;
                const gustWave = Math.sin(t * (0.38 + layerIndex * 0.1) + seed * 0.011);
                const across = (baseAcross - acrossSpan * 0.5) + gustWave * this.lerp(4, 14, speedNorm) * (0.5 + volatility);
                const sway = Math.sin(t * (0.85 + layer.speedMul * 0.28) + seed * 0.017) * swayAmount;
                const len = this.lerp(layer.lenMin, layer.lenMax, speedNorm) + (i % 4) * 2;
                const alpha = this.lerp(layer.alphaMin, layer.alphaMax, speedNorm) * alphaScale;
                const x1 = center.x + wind.x * along + perp.x * (across + sway);
                const y1 = center.y + wind.y * along + perp.y * (across + sway);
                const x2 = x1 + wind.x * len;
                const y2 = y1 + wind.y * len;

                ctx.strokeStyle = `rgba(208, 220, 232, ${alpha})`;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }
        });

        if (speedNorm > 0.35) {
            const gustCount = Math.round(this.lerp(6, 16, speedNorm));
            ctx.lineWidth = 1.5;
            for (let i = 0; i < gustCount; i++) {
                const seed = i * 211.17 + t * 14;
                const bandAcross = (((seed * 1.37) % acrossSpan) - acrossSpan * 0.5) + Math.sin(t * 0.22 + i) * 24;
                const bandAlong = (((seed * 1.93 + t * this.lerp(300, 520, speedNorm)) % alongSpan) - alongSpan * 0.5);
                const len = this.lerp(60, 140, speedNorm);
                const x1 = center.x + wind.x * bandAlong + perp.x * bandAcross;
                const y1 = center.y + wind.y * bandAlong + perp.y * bandAcross;
                const x2 = x1 + wind.x * len;
                const y2 = y1 + wind.y * len;
                ctx.strokeStyle = `rgba(208, 220, 232, ${this.lerp(0.09, 0.2, speedNorm)})`;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    private drawActiveStorm(ctx: CanvasRenderingContext2D) {
        const storm = this.activeStorm;
        if (!storm) return;

        const t = performance.now() * 0.001;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${LAYOUT_CONSTANTS.FONT_SIZE}px monospace`;

        storm.letters.forEach(letter => {
            if (letter.landed) {
                ctx.fillStyle = 'rgba(255,255,255,0.2)';
                ctx.fillText(letter.char, letter.x, letter.y);
                return;
            }

            const speed = Math.hypot(letter.vx, letter.vy);
            const settleDist = Math.hypot(letter.targetX - letter.x, letter.targetY - letter.y);
            const alpha = this.clamp(0.26 + speed * 0.045 + Math.min(0.3, settleDist / 600), 0.18, 0.92);

            ctx.save();
            ctx.translate(letter.x, letter.y);
            const wobble = Math.sin(t * 2.2 + letter.wobble) * Math.min(0.3, speed * 0.02);
            ctx.rotate(wobble);
            ctx.fillStyle = `rgba(226, 232, 240, ${alpha})`;
            ctx.fillText(letter.char, 0, 0);
            ctx.restore();
        });

        ctx.restore();
    }

    private forceCompleteStorm(storm: NewsStorm) {
        storm.letters.forEach(letter => {
            letter.x = letter.targetX;
            letter.y = letter.targetY;
            letter.vx = 0;
            letter.vy = 0;
            letter.landed = true;
            letter.mode = 'settled';
            letter.dockPath = null;
        });

        this.blocks.push(storm.finalBlock);
        if (this.activeStorm?.id === storm.id) {
            this.activeStorm = null;
        }
    }

    private smoothstep(t: number) {
        const x = this.clamp(t, 0, 1);
        return x * x * (3 - 2 * x);
    }

    private normalize(vec: { x: number; y: number }) {
        const len = Math.hypot(vec.x, vec.y);
        if (len < 0.000001) return { x: 0, y: 0 };
        return {
            x: vec.x / len,
            y: vec.y / len
        };
    }

    private rotateVector(vec: { x: number; y: number }, angle: number) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: vec.x * cos - vec.y * sin,
            y: vec.x * sin + vec.y * cos
        };
    }

    private rotateTowards(current: { x: number; y: number }, target: { x: number; y: number }, maxTurn: number) {
        const currentLen = Math.hypot(current.x, current.y);
        const targetLen = Math.hypot(target.x, target.y);

        if (currentLen < 0.000001) return targetLen < 0.000001 ? { x: 0, y: 0 } : this.normalize(target);
        if (targetLen < 0.000001) return this.normalize(current);

        const c = this.normalize(current);
        const t = this.normalize(target);

        const dot = this.clamp(c.x * t.x + c.y * t.y, -1, 1);
        const angle = Math.acos(dot);

        if (angle <= maxTurn) return t;

        const cross = c.x * t.y - c.y * t.x;
        const signedTurn = maxTurn * (cross >= 0 ? 1 : -1);
        return this.rotateVector(c, signedTurn);
    }

    private lerp(a: number, b: number, t: number) {
        return a + (b - a) * this.clamp(t, 0, 1);
    }

    private nextStormModeDelayFrames(initial: boolean) {
        const volatility = this.stormWeather.volatility;
        if (initial) {
            return this.randomRange(this.lerp(340, 220, volatility), this.lerp(700, 420, volatility));
        }

        const roll = Math.random();
        const activeChance = this.lerp(0.06, 0.18, volatility);
        const calmChance = this.lerp(0.56, 0.3, volatility);
        if (roll < activeChance) {
            // active pocket
            return this.randomRange(this.lerp(300, 190, volatility), this.lerp(520, 320, volatility));
        }
        if (roll < activeChance + calmChance) {
            // calm interval
            return this.randomRange(this.lerp(680, 480, volatility), this.lerp(1200, 860, volatility));
        }
        // normal cadence
        if (roll < 0.96) {
            // normal cadence
            return this.randomRange(this.lerp(460, 300, volatility), this.lerp(820, 600, volatility));
        }
        // rare long lull
        return this.randomRange(this.lerp(1100, 760, volatility), this.lerp(1700, 1160, volatility));
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

    private hash2D(x: number, y: number) {
        const s = Math.sin(x * 127.1 + y * 311.7 + 74.7) * 43758.5453123;
        return (s - Math.floor(s)) * 2 - 1;
    }

    private randomRange(min: number, max: number) {
        return min + Math.random() * (max - min);
    }

    private clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
    }

    cleanup() {
        if (this.newsRefreshTimer !== null) {
            window.clearInterval(this.newsRefreshTimer);
            this.newsRefreshTimer = null;
        }
        this.engine.events.off('INPUT_START', this.handleInput);
        this.engine.events.off(EVENTS.WORD_RELEASED, this.handleWordReleased);
        this.engine.events.off(EVENTS.NEWS_STORM_TRIGGERED, this.handleNewsStormTriggered);
        this.engine.events.off(EVENTS.NEWS_STORM_DEBUG_UPDATED, this.handleNewsStormDebugUpdated);
        this.engine.events.off(EVENTS.NEWS_STORM_MODE_UPDATED, this.handleNewsStormModeUpdated);
        this.engine.events.off(EVENTS.NEWS_STORM_WEATHER_UPDATED, this.handleNewsStormWeatherUpdated);
    }
}
