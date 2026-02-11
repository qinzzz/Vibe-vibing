import { System, Leg, Worm, WormState, EvolutionPhase } from './types';
import { EventBus, EVENTS } from './events';
import { GameConfig } from './types';
import { GameDirector } from '../systems/GameDirector';
import { DiscoveryEngine, FeatureKey } from '../systems/DiscoveryEngine';

export class Engine {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    config: GameConfig;
    events: EventBus;

    private systems: System[] = [];
    private animationId: number | null = null;
    private lastTime: number = 0;

    get width() { return window.innerWidth; }
    get height() { return window.innerHeight; }

    // Shared World State (Accessible by Systems)
    cameraPos: { x: number, y: number } = { x: 0, y: 0 };
    mouseScreenPos: { x: number, y: number } = { x: 0, y: 0 };
    mousePos: { x: number, y: number } = { x: 0, y: 0 };
    targetPos: { x: number, y: number } = { x: 0, y: 0 };
    private readonly cameraFollowLerp = 0.12;

    // Multi-Worm State
    wormState: WormState = {
        worms: new Map(),
        activeWormId: 'worm-0',
        nextWormId: 1
    };

    // Backward compatibility getter
    get blobState() {
        return this.activeWorm;
    }

    get activeWorm(): Worm {
        const worm = this.wormState.worms.get(this.wormState.activeWormId);
        if (!worm) throw new Error(`Active worm ${this.wormState.activeWormId} not found`);
        return worm;
    }

    constructor(canvas: HTMLCanvasElement, config: GameConfig) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error("Could not get 2D context");
        this.ctx = ctx;
        this.config = config;
        this.events = new EventBus();

        this.handleResize();
        window.addEventListener('resize', this.handleResize);

        // Bind Input
        this.canvas.addEventListener('mousedown', this.handleInput);
        this.canvas.addEventListener('touchstart', this.handleInput);
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('touchmove', this.handleMouseMove);
        this.canvas.addEventListener('contextmenu', e => e.preventDefault()); // Prevent default menu
        window.addEventListener('keydown', this.handleKeyDown);

        // Create initial worm
        const initialPos = {
            x: this.width / 2,
            y: this.height / 2
        };
        this.createWorm('worm-0', null, 0, initialPos);
        this.cameraPos = { ...initialPos };
        this.targetPos = { ...initialPos };
        this.mouseScreenPos = { x: this.width / 2, y: this.height / 2 };
        this.mousePos = this.screenToWorld(this.mouseScreenPos);
    }

    addSystem(system: System) {
        system.init(this);
        this.systems.push(system);
    }

    start() {
        if (this.animationId) return;
        this.lastTime = performance.now();
        this.loop(this.lastTime);
    }

    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    updateConfig(newConfig: GameConfig) {
        this.config = newConfig;
    }

    resetGame() {
        this.stop();

        // 1. Reset Camera and World state
        this.cameraPos = { x: this.width / 2, y: this.height / 2 };
        this.targetPos = { ...this.cameraPos };
        this.mouseScreenPos = { ...this.cameraPos };
        this.mousePos = this.screenToWorld(this.mouseScreenPos);

        // 2. Clear Worms
        this.wormState.worms.clear();
        this.wormState.nextWormId = 1;
        this.wormState.activeWormId = 'worm-0';

        // 3. Re-create initial worm
        this.createWorm('worm-0', null, 0, this.cameraPos);

        // 4. Notify Systems
        this.events.emit(EVENTS.GAME_RESET, {});

        // 5. Restart Loop
        this.start();
    }

    private loop = (timestamp: number) => {
        // const dt = (timestamp - this.lastTime) / 1000; // Delta time in seconds
        const dt = 16.66; // Fixed timestep for stability for now, matching original logic implicitly
        this.lastTime = timestamp;

        this.update(dt);
        this.draw();

        this.animationId = requestAnimationFrame(this.loop);
    };

    private update(dt: number) {
        this.updateCamera();
        this.mousePos = this.screenToWorld(this.mouseScreenPos);

        for (const system of this.systems) {
            // Check for system-level gating
            const activeWorm = this.wormState.worms.get(this.wormState.activeWormId);
            if (activeWorm) {
                // Map system names to DiscoveryEngine features
                let feature: FeatureKey | null = null;
                if (system.constructor.name === 'BlackHoleSystem') feature = 'BLACK_HOLE';
                if (system.constructor.name === 'UIPredatorSystem') feature = 'NEWS_STORM'; // Deity system
                if (system.constructor.name === 'VoiceInputSystem') feature = 'VOICE_INPUT';
                if (system.constructor.name === 'ConsciousnessStreamSystem') feature = 'STREAM_OF_CONSCIOUSNESS';

                if (feature && !DiscoveryEngine.isFeatureEnabled(activeWorm, feature)) continue;

                if (system.constructor.name === 'WormLifecycleSystem') {
                    // Splitting is checked inside the system, but we keep it here for clarity
                }
            }
            system.update(dt);
        }

        this.updateCamera();
        this.mousePos = this.screenToWorld(this.mouseScreenPos);
    }

    private draw() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.width, this.height);

        this.ctx.save();
        this.ctx.translate(this.width / 2 - this.cameraPos.x, this.height / 2 - this.cameraPos.y);

        for (const system of this.systems) {
            const activeWorm = this.wormState.worms.get(this.wormState.activeWormId);
            if (activeWorm) {
                let feature: FeatureKey | null = null;
                if (system.constructor.name === 'BlackHoleSystem') feature = 'BLACK_HOLE';
                if (system.constructor.name === 'UIPredatorSystem') feature = 'NEWS_STORM';
                if (system.constructor.name === 'ConsciousnessStreamSystem') feature = 'STREAM_OF_CONSCIOUSNESS';

                if (feature && !DiscoveryEngine.isFeatureEnabled(activeWorm, feature)) continue;
            }
            system.draw(this.ctx);
        }

        this.ctx.restore();
    }

    private updateCamera() {
        const activeWorm = this.wormState.worms.get(this.wormState.activeWormId);
        if (!activeWorm) return;
        this.cameraPos.x += (activeWorm.corePos.x - this.cameraPos.x) * this.cameraFollowLerp;
        this.cameraPos.y += (activeWorm.corePos.y - this.cameraPos.y) * this.cameraFollowLerp;
    }

    screenToWorld(screen: { x: number, y: number }) {
        return {
            x: screen.x + this.cameraPos.x - this.width / 2,
            y: screen.y + this.cameraPos.y - this.height / 2
        };
    }

    worldToScreen(world: { x: number, y: number }) {
        return {
            x: world.x - this.cameraPos.x + this.width / 2,
            y: world.y - this.cameraPos.y + this.height / 2
        };
    }

    private getScreenCoords(e: MouseEvent | TouchEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const point = e instanceof TouchEvent ? e.touches[0] : e;
        return {
            x: point.clientX - rect.left,
            y: point.clientY - rect.top
        };
    }

    private handleResize = () => {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    private handleInput = (e: MouseEvent | TouchEvent) => {
        const screenPos = this.getScreenCoords(e);
        this.mouseScreenPos = screenPos;
        const worldPos = this.screenToWorld(screenPos);

        // Check for Right Click (button 2) or Shift+Click
        let isSecondary = false;
        if (e instanceof MouseEvent) {
            if (e.button === 2 || e.shiftKey) {
                isSecondary = true;
            }
        }

        if (isSecondary) {
            this.events.emit('INPUT_RELEASE', worldPos);
        } else {
            this.activeWorm.targetPos = worldPos;
            this.targetPos = worldPos;
            this.events.emit('INPUT_START', worldPos);
        }
    };

    private handleMouseMove = (e: MouseEvent | TouchEvent) => {
        const screenPos = this.getScreenCoords(e);
        this.mouseScreenPos = screenPos;
        this.mousePos = this.screenToWorld(screenPos);
    };

    private handleKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
            e.preventDefault(); // Prevent page scrolling
            this.events.emit(EVENTS.REPRODUCE_TRIGGERED, {});
        }
    };

    createWorm(id: string, parentId: string | null, generation: number, pos: { x: number, y: number }): Worm {
        const parent = parentId ? this.wormState.worms.get(parentId) : null;

        const worm: Worm = {
            id,
            generation,
            parentId,
            birthTime: Date.now(),

            // Inherit with mutations
            hue: parent ? (parent.hue + (Math.random() - 0.5) * 30) % 360 : 200, // Start blue
            sizeMultiplier: parent ? this.clamp(parent.sizeMultiplier * (0.95 + Math.random() * 0.1), 0.6, 1.8) : 1.0,
            thickness: parent ? this.clamp(parent.thickness * (0.95 + Math.random() * 0.1), 0.15, 0.5) : 0.25,
            speedMultiplier: parent ? parent.speedMultiplier * (0.95 + Math.random() * 0.1) : 1.0,

            // Lifecycle
            satiation: parent ? 50 : 100, // Children start half-full
            health: 100,
            lastMeal: Date.now(),

            // State
            corePos: { ...pos },
            coreVel: { x: 0, y: 0 },
            legs: [],
            targetPos: { ...pos },
            isHoveringEdible: false,

            // Vocabulary
            vocabulary: new Set(parent ? this.inheritVocabulary(parent) : []),
            swallowedWords: [],
            digestionQueue: [],
            soul: this.createInitialSoul(parent),
            particles: [],
            evolutionPhase: EvolutionPhase.LARVAL,
            totalWordsConsumed: 0,
            hasProvedSentience: false,
            coreRadius: parent ? parent.coreRadius * 0.8 : this.config.coreRadius, // Children start slightly smaller than current parent
            hipRadius: parent ? parent.hipRadius * 0.8 : this.config.hipRadius
        };

        this.wormState.worms.set(id, worm);
        this.events.emit(EVENTS.WORM_BORN, worm);
        return worm;
    }

    private inheritVocabulary(parent: Worm): string[] {
        const parentWords = Array.from(parent.vocabulary);
        const inheritCount = Math.floor(parentWords.length * 0.6); // 60% inheritance

        // Random selection
        const shuffled = parentWords.sort(() => Math.random() - 0.5);
        return shuffled.slice(0, inheritCount);
    }

    private createInitialSoul(parent: Worm | null) {
        const baseAxes = parent?.soul?.axes
            ? { ...parent.soul.axes }
            : {
                calm: 0,
                tender: 0,
                poetic: 0,
                curious: 0,
                bold: 0,
                orderly: 0,
                hopeful: 0,
                social: 0,
                focused: 0,
                stubborn: 0
            };

        if (parent?.soul?.axes) {
            for (const key of Object.keys(baseAxes) as Array<keyof typeof baseAxes>) {
                baseAxes[key] = this.clamp(baseAxes[key] + (Math.random() * 0.16 - 0.08), -1, 1);
            }
        }

        const identity = this.deriveIdentityFromAxes(baseAxes);
        return {
            axes: baseAxes,
            identity,
            motto: this.buildMotto(baseAxes, identity.mood),
            absorbedCount: parent?.soul?.absorbedCount ? Math.floor(parent.soul.absorbedCount * 0.25) : 0
        };
    }

    private deriveIdentityFromAxes(axes: {
        calm: number;
        tender: number;
        poetic: number;
        curious: number;
        bold: number;
        orderly: number;
        hopeful: number;
        social: number;
        focused: number;
        stubborn: number;
    }) {
        let mood = 'watchful';
        if (axes.calm > 0.35 && axes.hopeful > 0.2) mood = 'serene';
        else if (axes.poetic > 0.3 && axes.focused > 0.2) mood = 'contemplative';
        else if (axes.bold > 0.2 && axes.curious > 0.3) mood = 'playful';
        else if (axes.calm < -0.2) mood = 'impatient';
        else if (axes.hopeful < -0.25) mood = 'wistful';

        let temperament = 'wandering';
        if (axes.focused > 0.35 && axes.orderly > 0.2) temperament = 'disciplined';
        else if (axes.poetic > 0.3 && axes.tender > 0.15) temperament = 'romantic';
        else if (axes.bold > 0.25 && axes.orderly < -0.2) temperament = 'mischievous';
        else if (axes.orderly > 0.25 && axes.bold < 0) temperament = 'stoic';
        else if (axes.curious > 0.3 && axes.focused > 0.1) temperament = 'analytical';

        const preferences = [
            axes.curious >= 0 ? 'novelty' : 'certainty',
            axes.poetic >= 0 ? 'beauty' : 'clarity',
            axes.social >= 0 ? 'connection' : 'silence'
        ];
        const aversions = [
            axes.orderly >= 0 ? 'noise' : 'sameness',
            axes.tender >= 0 ? 'cruelty' : 'small talk'
        ];
        const fears = [axes.hopeful >= 0 ? 'being forgotten' : 'endlessness'];
        const values = [
            axes.tender >= 0 ? 'tenderness' : 'precision',
            axes.calm >= 0 ? 'patience' : 'courage',
            axes.poetic >= 0 ? 'wonder' : 'honesty'
        ];
        const cravings = [axes.curious >= 0 ? 'meaning' : 'stability'];

        return {
            mood,
            temperament,
            preferences,
            aversions,
            fears,
            values,
            cravings
        };
    }

    private buildMotto(axes: { calm: number; hopeful: number; poetic: number }, mood: string) {
        if (axes.hopeful > 0.35) return 'I grow by what I can keep.';
        if (axes.calm < -0.25) return 'I chase storms but live on calm.';
        if (axes.poetic > 0.25) return 'Feed me gently; I am learning.';
        if (mood === 'contemplative') return 'What I eat, I become.';
        return 'I remember what survives the current.';
    }

    private clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
    }

    cleanup() {
        this.stop();
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('keydown', this.handleKeyDown);
        this.canvas.removeEventListener('mousedown', this.handleInput);
        this.canvas.removeEventListener('touchstart', this.handleInput);
        this.canvas.removeEventListener('mousemove', this.handleMouseMove);
        this.canvas.removeEventListener('touchmove', this.handleMouseMove);

        this.systems.forEach(s => s.cleanup());
    }
}
