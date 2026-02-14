import { useRef, useEffect } from 'react';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';
import { GameConfig } from '../core/types';
import { PhysicsSystem } from '../systems/PhysicsSystem';
import { BackgroundSystem } from '../systems/BackgroundSystem';
import { DigestionSystem } from '../systems/DigestionSystem';
import { CursorSystem } from '../systems/CursorSystem';
import { WormLifecycleSystem } from '../systems/WormLifecycleSystem';
import { ConsciousnessStreamSystem } from '../systems/ConsciousnessStreamSystem';
import { BlackHoleSystem } from '../systems/BlackHoleSystem';
import { AudioService } from '../services/AudioService';
import { ThoughtService } from '../services/ThoughtService';
import { VoiceInputSystem } from '../systems/VoiceInputSystem';
import { VoiceVisualsSystem } from '../systems/VoiceVisualsSystem';
import { UIPredatorSystem } from '../systems/UIPredatorSystem';
import { GameDirector } from '../systems/GameDirector';

export const useEngine = (config: GameConfig, onWordSwallowed?: (word: string) => void) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<Engine | null>(null);

    // Initialize Engine
    useEffect(() => {
        if (!canvasRef.current) return;

        // Create Engine
        const engine = new Engine(canvasRef.current, config);
        engineRef.current = engine;

        // Add Systems (Order matters!)
        engine.addSystem(new GameDirector());
        engine.addSystem(new ConsciousnessStreamSystem());
        engine.addSystem(new BlackHoleSystem()); // Black holes and gravitational effects
        engine.addSystem(new PhysicsSystem());
        engine.addSystem(new BackgroundSystem());
        engine.addSystem(new DigestionSystem());
        engine.addSystem(new WormLifecycleSystem());
        engine.addSystem(new CursorSystem());
        engine.addSystem(new VoiceInputSystem());
        engine.addSystem(new VoiceVisualsSystem());
        engine.addSystem(new UIPredatorSystem());

        // Add Services (Side effects)
        new AudioService(engine.events);
        new ThoughtService(engine.events);

        // Story initialization: only LOADS existing stories, never generates.
        // Generation is handled exclusively by App.tsx (identity-based or skip flow).
        const initStoryForWorm = async (wormId: string, retries = 0) => {
            try {
                console.log(`[STORY] Checking story for worm ${wormId}...`);
                const storyRes = await fetch(`/api/story/${wormId}`);
                const storyData = await storyRes.json();

                if (!storyData.hasStory) {
                    // Story not ready yet — retry in case generation is still in progress
                    if (retries < 20) {
                        console.log(`[STORY] No story yet for ${wormId}, retrying in 3s... (${retries + 1}/20)`);
                        setTimeout(() => initStoryForWorm(wormId, retries + 1), 3000);
                    } else {
                        console.warn(`[STORY] No story found for ${wormId} after ${retries} retries.`);
                    }
                    return;
                }

                console.log(`[STORY] Story exists for ${wormId}, revealed: ${storyData.revealedCount}/${storyData.totalSegments}`);
                engine.events.emit(EVENTS.STORY_STATE_CHANGED, {
                    hasStory: true,
                    storyId: storyData.storyId,
                    title: storyData.title,
                    tagline: storyData.tagline || '',
                    totalSegments: storyData.totalSegments,
                    revealedCount: storyData.revealedCount,
                    isComplete: storyData.isComplete,
                    segments: storyData.segments || [],
                    streamFragments: storyData.streamFragments || [],
                });
            } catch (err) {
                console.error('[STORY] Failed to initialize story:', err);
            }
        };

        // Cache story state for late-mounting components & sync revealedCount onto worm
        engine.events.on(EVENTS.STORY_STATE_CHANGED, (data: any) => {
            engine.lastStoryState = data;
            if (data.revealedCount != null) {
                const worm = engine.wormState.worms.get(engine.wormState.activeWormId);
                if (worm) worm.storyRevealedCount = data.revealedCount;
            }
        });
        engine.events.on(EVENTS.STORY_FRAGMENT_REVEALED, (data: any) => {
            if (data.revealedCount != null) {
                const worm = engine.wormState.worms.get(engine.wormState.activeWormId);
                if (worm) worm.storyRevealedCount = data.revealedCount;
            }
        });

        // Initialize story after hydration — only loads existing story, never generates.
        // Identity-based generation is handled by App.tsx before the engine mounts.
        engine.events.on(EVENTS.WORMS_HYDRATED, () => {
            const wormId = engine.wormState.activeWormId;
            if (wormId) initStoryForWorm(wormId);
        });

        // GAME_RESET: don't reinitialize story here — the engine will unmount
        // and remount after identity input, at which point WORMS_HYDRATED handles it.

        // Bind UI callbacks
        const handleWordLog = (data: { id: string, text: string }) => {
            if (onWordSwallowed) onWordSwallowed(data as any);
        };
        engine.events.on('WORD_LOG', handleWordLog);

        engine.start();

        return () => {
            engine.events.off('WORD_LOG', handleWordLog);
            engine.cleanup();
            engineRef.current = null;
        };
    }, []); // Run once on mount

    // Sync Config Changes
    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.updateConfig(config);
        }
    }, [config]);

    return { canvasRef, engineRef };
};
