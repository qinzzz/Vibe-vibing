import React, { useState, useCallback, useEffect, useRef } from 'react';
import BlobCanvas from './components/BlobCanvas';
import { BLOB_CONSTANTS } from './constants';
import { Slider } from './components/ui/Slider';
import { Toggle } from './components/ui/Toggle';
import { ControlGroup } from './components/ui/ControlGroup';
import { Engine } from './core/Engine';
import { EVENTS } from './core/events';
import type { Worm } from './types';
import { EvolutionPhase } from './core/types';
import { GameDirector } from './systems/GameDirector';
import { DiscoveryEngine } from './systems/DiscoveryEngine';
import { LabyrinthJournal } from './components/LabyrinthJournal';

const NEWS_PREFETCH_LIMIT = 25;
const NEWS_PREFETCH_MS = 2 * 60 * 60 * 1000;

const App: React.FC = () => {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [params, setParams] = useState({
    l1: 58.00,
    l2: 35.00,
    stepTrigger: 60.00,
    coreRadius: 80.00, // Starts smaller
    hipRadius: 40.00, // Starts smaller
    kneeRadius: BLOB_CONSTANTS.METABALL.KNEE_RADIUS,
    footRadius: 50.00, // Consistent with smaller core
    coreWeight: BLOB_CONSTANTS.METABALL.CORE_WEIGHT,
    hipWeight: BLOB_CONSTANTS.METABALL.HIP_WEIGHT,
    kneeWeight: BLOB_CONSTANTS.METABALL.KNEE_WEIGHT,
    footWeight: 0.44,  // Set per user request
    isoThreshold: 0.25,
    cellSize: 4.00,    // Set per user request
    coreLerp: 0.065,   // Set per user request
    showSkeleton: true,
  });
  const [weatherDebug, setWeatherDebug] = useState({
    entryWind: 0.74,
    entrySwirl: 0.52,
    entrySpeed: 1.00,
    dragStrength: 1.00,
    targetPull: 1.00,
    landingRadius: 1.00,
    landingSpeed: 1.00,
  });
  const [stormWeather, setStormWeather] = useState({
    baseWindSpeed: 1.00,
    speedVariance: 0.22,
    volatility: 0.55,
  });
  const [isStormMode, setIsStormMode] = useState(false);

  const [isRightOpen, setIsRightOpen] = useState(true);
  const [isLeftOpen, setIsLeftOpen] = useState(false);
  const [swallowedWords, setSwallowedWords] = useState<{ id: string, text: string }[]>([]);
  const [isSingularityShift, setIsSingularityShift] = useState(false);
  const [worms, setWorms] = useState<Worm[]>([]);
  const [activeWormId, setActiveWormId] = useState<string>('worm-0');
  const [isReproducing, setIsReproducing] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const engineRef = useRef<Engine | null>(null);

  const newsHeadlinePoolRef = useRef<string[]>([]);

  const musicRef = useRef<HTMLAudioElement | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.3);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [showJournal, setShowJournal] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const handleWordSwallowed = useCallback((data: { id: string, text: string }) => {
    setSwallowedWords(prev => [data, ...prev]);
  }, []);

  const prefetchNewsHeadlines = useCallback(async () => {
    try {
      const res = await fetch(`/api/news/headlines?limit=${NEWS_PREFETCH_LIMIT}`);
      if (!res.ok) return;
      const payload = await res.json();
      const count = Array.isArray(payload?.headlines) ? payload.headlines.length : 0;
      const titles = Array.isArray(payload?.headlines)
        ? payload.headlines
          .map((item: any) => (typeof item?.title === 'string' ? item.title.trim() : ''))
          .filter((title: string) => title.length > 0)
        : [];
      if (titles.length > 0) {
        newsHeadlinePoolRef.current = titles;
      }
      console.log(`[NEWS] Prefetch ready: source=${payload?.source || 'unknown'}, count=${count}`);
    } catch (err) {
      console.error('[NEWS] Prefetch failed:', err);
    }
  }, []);

  const handleEngineInit = useCallback((engineInstance: Engine) => {
    engineRef.current = engineInstance;
    setEngine(engineInstance);
    engineInstance.events.emit(EVENTS.NEWS_STORM_DEBUG_UPDATED, weatherDebug);
    engineInstance.events.emit(EVENTS.NEWS_STORM_MODE_UPDATED, { enabled: isStormMode });
    engineInstance.events.emit(EVENTS.NEWS_STORM_WEATHER_UPDATED, stormWeather);



    // Listen for worm lifecycle events
    engineInstance.events.on(EVENTS.WORM_BORN, updateWormList);
    engineInstance.events.on(EVENTS.WORM_DIED, updateWormList);

    // Listen for hydration complete to sync UI with restored worms
    engineInstance.events.on(EVENTS.WORMS_HYDRATED, () => {
      updateWormList();
      // Update swallowed words for active worm after hydration
      if (engineRef.current) {
        const activeWorm = engineRef.current.activeWorm;
        setSwallowedWords(activeWorm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
      }
    });

    // Listen for reproduction events to freeze UI
    engineInstance.events.on(EVENTS.REPRODUCTION_START, () => setIsReproducing(true));
    engineInstance.events.on(EVENTS.REPRODUCTION_COMPLETE, () => {
      setIsReproducing(false);
      updateWormList(); // Update worm list to show new names

      // Update swallowed words for active worm after split
      if (engineRef.current) {
        const activeWorm = engineRef.current.activeWorm;
        setSwallowedWords(activeWorm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
      }
    });
  }, []);

  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.events.emit(EVENTS.NEWS_STORM_DEBUG_UPDATED, weatherDebug);
  }, [weatherDebug]);

  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.events.emit(EVENTS.NEWS_STORM_MODE_UPDATED, { enabled: isStormMode });
  }, [isStormMode]);

  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.events.emit(EVENTS.NEWS_STORM_WEATHER_UPDATED, stormWeather);
  }, [stormWeather]);

  useEffect(() => {
    prefetchNewsHeadlines();
    const timer = window.setInterval(prefetchNewsHeadlines, NEWS_PREFETCH_MS);
    return () => window.clearInterval(timer);
  }, [prefetchNewsHeadlines]);

  useEffect(() => {
    if (!isStormMode) return;
    prefetchNewsHeadlines();
  }, [isStormMode, prefetchNewsHeadlines]);



  useEffect(() => {
    const audio = musicRef.current;
    if (!audio) return;

    audio.loop = true;
    audio.volume = musicVolume;

    const start = async () => {
      try {
        await audio.play();
        window.removeEventListener("pointerdown", start);
        window.removeEventListener("keydown", start);
      } catch (e) {
        // still blocked; keep waiting for interaction
        console.log("Autoplay blocked until user interaction.");
      }
    };

    const toggleMusic = async () => {
      const audio = musicRef.current;
      if (!audio) return;

      if (isMusicPlaying) {
        audio.pause();
        setIsMusicPlaying(false);
      } else {
        try {
          await audio.play();
          setIsMusicPlaying(true);
        } catch (e) {
          console.log("Playback blocked.");
        }
      }
    };

    // 1) try immediately on load
    start();

    // 2) if blocked, unlock on first interaction (click/tap/keypress)
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });

    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, []);



  useEffect(() => {
    if (musicRef.current) {
      musicRef.current.volume = musicVolume;
    }
  }, [musicVolume]);

  useEffect(() => {
    if (!engine) return;

    const handleEvolved = () => {
      setIsSingularityShift(true);
      setTimeout(() => setIsSingularityShift(false), 3000);
    };

    engine.events.on(EVENTS.WORM_EVOLVED, handleEvolved);
    return () => engine.events.off(EVENTS.WORM_EVOLVED, handleEvolved);
  }, [engine]);

  const updateWormList = () => {
    if (!engineRef.current) return;
    const wormArray = Array.from(engineRef.current.wormState.worms.values());
    setWorms(wormArray);
    setActiveWormId(engineRef.current.wormState.activeWormId);
  };

  const switchWorm = (wormId: string) => {
    if (!engineRef.current) return;
    engineRef.current.wormState.activeWormId = wormId;
    setActiveWormId(wormId);

    // Update swallowed words for the new active worm
    const worm = engineRef.current.wormState.worms.get(wormId);
    if (worm) {
      // Keep legacy shared target in sync with the selected worm's own destination.
      engineRef.current.targetPos = { ...worm.targetPos };
      setSwallowedWords(worm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
    }
  };

  const handleDeleteWord = async (id: string) => {
    try {
      await fetch(`/api/stomach/${id}`, { method: 'DELETE' });
      setSwallowedWords(prev => prev.filter(w => w.id !== id));
      // Sync with Blob
      if (engineRef.current) {
        engineRef.current.events.emit(EVENTS.WORD_REMOVED, id);
      }
    } catch (e) {
      console.error("Delete failed", e);
    }
  };

  const handleReset = () => {
    setConfirmDialog({
      message: "Reset everything? All worms and words will be lost.",
      onConfirm: async () => {
        setConfirmDialog(null);

        try {
          await fetch('/api/reset', { method: 'POST' });
          setSwallowedWords([]);

          if (engineRef.current) {
            engineRef.current.resetGame();
          }

          console.log('[GAME] Full reset complete.');
        } catch (e) {
          console.error("Reset failed", e);
        }
      }
    });
  };

  const handleNewGame = () => {
    setConfirmDialog({
      message: "Start a new game? All progress will be lost.",
      onConfirm: async () => {
        setConfirmDialog(null);

        try {
          // 1. Reset backend
          await fetch('/api/reset', { method: 'POST' });

          // 2. Clear local UI state
          setSwallowedWords([]);

          // 3. Reset Engine
          if (engineRef.current) {
            engineRef.current.resetGame();
          }

          console.log('[GAME] New game started.');
        } catch (e) {
          console.error("New Game failed", e);
        }
      }
    });
  };

  const handleSendNewsWind = () => {
    if (!engineRef.current) return;

    const pool = newsHeadlinePoolRef.current;
    const headline = pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : undefined;

    engineRef.current.events.emit(EVENTS.NEWS_STORM_TRIGGERED, {
      placement: isStormMode ? 'viewport' : 'anchor',
      headline
    });
  };

  const [hoveredWormId, setHoveredWormId] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnterWorm = (id: string) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredWormId(id);
  };

  const handleMouseLeaveWorm = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredWormId(null);
    }, 300); // 300ms grace period to prevent jitter
  };

  const handleMoodInfluence = (mood: string, targetId?: string) => {
    if (!engineRef.current) return;

    const idToInfluence = targetId || engineRef.current.wormState.activeWormId;
    console.log('Influencing mood:', mood, 'for worm:', idToInfluence);

    let axes: any = {};

    // Based on DigestionSystem.regenerateIdentity logic
    // We must set conflicting axes to values that suppress other moods
    switch (mood) {
      case 'Serene':
        // calm + hopeful + tender. Suppress bold/irritability.
        axes = { calm: 0.9, hopeful: 0.7, tender: 0.8, bold: -0.8, social: 0, focused: 0 };
        break;
      case 'Watchful':
        // focused + curious - social. Suppress orderly to avoid Analytical.
        axes = { focused: 0.9, curious: 0.7, social: -0.8, calm: 0.2, bold: -0.2, orderly: 0, poetic: 0 };
        break;
      case 'Playful':
        // bold + curious - orderly. Suppress social to avoid Electric.
        axes = { bold: 0.8, curious: 0.8, orderly: -0.9, social: -0.4, calm: -0.2, tender: 0.4 };
        break;
      case 'Wistful':
        // -hopeful + poetic. Suppress focused to avoid Contemplative.
        axes = { hopeful: -0.9, poetic: 0.9, calm: 0.3, bold: -0.5, focused: -0.4, social: -0.2 };
        break;
      case 'Irritable':
        // -tender - calm. Suppress curious.
        axes = { tender: -0.9, calm: -0.9, bold: 0.6, social: -0.6, hopeful: -0.3, curious: 0 };
        break;
      case 'Electric':
        // bold + curious + social. Suppress orderly to hurt Playful (but wait, Playful needs LOW orderly). 
        // Also boost Social to max.
        axes = { bold: 0.9, curious: 0.8, social: 0.9, orderly: 0.4, calm: -0.8, poetic: -0.5, tender: -0.2 };
        break;
    }

    engineRef.current.events.emit(EVENTS.FORCE_MOOD, { wormId: idToInfluence, axes });
  };


  return (
    <div className={`relative w-full h-screen bg-black overflow-hidden flex flex-col ${isSingularityShift ? 'singularity-shift' : ''}`}>
      <audio ref={musicRef} src="/audio/ambient.mp3" preload="auto" />
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
        <h1 className="text-white text-2xl font-bold tracking-tight opacity-80 uppercase italic font-mono-custom" data-glitch-target="true">
          The Word Worm
        </h1>
        <p className="text-blue-400 text-sm font-medium mt-1">
          Upon waking, it realized it had lost all of its words. What it eats, it remembers.
        </p>
      </div>


      {/* Microphone Toggle - Gated by Deity Phase */}
      {engine?.activeWorm && DiscoveryEngine.isFeatureEnabled(engine.activeWorm, 'VOICE_INPUT') && (
        <div className="absolute top-6 right-6 z-50 pointer-events-auto">
          <button
            onClick={() => {
              const newState = !isMicActive;
              setIsMicActive(newState);
              if (engineRef.current) {
                engineRef.current.events.emit('TOGGLE_VOICE_INPUT', newState);
              }
            }}
            className={`p-3 rounded-full transition-all duration-300 border ${isMicActive
              ? 'bg-red-500/20 border-red-500 text-red-400 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.4)]'
              : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white'
              }`}
            title={isMicActive ? "Voice Input Active (Listening...)" : "Enable Voice Input"}
            data-glitch-target="true"
          >
            {isMicActive ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            )}
          </button>
        </div>
      )}



      <BlobCanvas
        settings={params}
        onWordSwallowed={handleWordSwallowed}
        onEngineInit={handleEngineInit}
      />

      {/* Worm Selector UI - Bottom Center */}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex gap-2 pointer-events-auto">
        {worms.map(worm => {
          const isActive = worm.id === activeWormId;
          const isHovered = hoveredWormId === worm.id;

          return (
            <div
              key={worm.id}
              className="relative group"
              onMouseEnter={() => handleMouseEnterWorm(worm.id)}
              onMouseLeave={handleMouseLeaveWorm}
            >
              {/* Popover Menu */}
              {(isHovered) && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-[240px] pb-3 z-50">
                  <div className="bio-panel backdrop-blur-xl rounded-2xl p-4 shadow-2xl flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-auto">
                    {/* Popover Header */}
                    <div className="flex flex-col gap-1 border-b border-white/10 pb-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-blue-400 font-bold tracking-[0.2em] uppercase">Evolution</span>
                        <span className="text-[9px] text-white/40 font-mono">PHASE {worm.evolutionPhase + 1}</span>
                      </div>
                      <div className="text-[12px] text-white font-bold font-mono truncate">
                        {worm.name || `Worm ${worm.generation + 1}`}
                      </div>
                    </div>

                    {/* Biological Progress Bar */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] text-white/60 uppercase tracking-tighter">Current Progress</span>
                        <span className="text-[9px] text-blue-300 font-mono">
                          {Math.round(worm.evolutionPhase === EvolutionPhase.LARVAL
                            ? (worm.totalWordsConsumed / 10) * 100
                            : worm.evolutionPhase === EvolutionPhase.SENTIENT
                              ? (worm.soul.absorbedCount / 10) * 100
                              : 100)}%
                        </span>
                      </div>
                      <div className="h-2 bio-progress-bg rounded-full overflow-hidden relative">
                        <div
                          className="h-full bio-progress-fill transition-all duration-1000 ease-out"
                          style={{
                            width: `${worm.evolutionPhase === EvolutionPhase.LARVAL
                              ? (worm.totalWordsConsumed / 10) * 100
                              : worm.evolutionPhase === EvolutionPhase.SENTIENT
                                ? (worm.soul.absorbedCount / 10) * 100
                                : 100}%`
                          }}
                        />
                      </div>
                      <div className="text-[8px] text-white/40 italic leading-none">
                        {worm.evolutionPhase === EvolutionPhase.LARVAL
                          ? `${Math.max(0, 10 - (worm.totalWordsConsumed || 0))} words to Sentience`
                          : worm.evolutionPhase === EvolutionPhase.SENTIENT
                            ? `${10 - (worm.soul.absorbedCount || 0)} souls to Transcendence`
                            : "Deity Phase: Omniescence active"}
                      </div>
                    </div>

                    {/* Mood & Soul Section - Gated by Sentient Phase */}
                    {/* Sentient features hidden per user request */}
                    {!GameDirector.isFeatureEnabled(worm as any, 'SOUL') && (
                      <div className="text-[10px] text-white/40 italic py-2 text-center border border-white/5 bg-white/5 rounded-lg">
                        Gather more words to unlock sentient features...
                      </div>
                    )}

                    {/* Shape Section (Global) - Manual controls removed for Dynamic Growth */}
                    <div>
                      <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold flex justify-between">
                        <span>Status</span>
                        <span className="text-[9px] opacity-50">(Growth)</span>
                      </div>
                      <div className="space-y-4 p-3 bg-white/5 border border-white/10 rounded-lg">
                        <div className="flex flex-col gap-2">
                          <span className="text-[11px] text-blue-300 font-bold uppercase tracking-tight">Sentience Proof</span>
                          <p className="text-[10px] text-white/60 leading-relaxed italic">
                            {!worm.hasProvedSentience
                              ? "Direction: Form a complex thought (5+ words) to verify sentience and unlock splitting."
                              : "Sentience Verified. Ready for Transcendence."}
                          </p>
                        </div>
                        {/* Visual Growth Indicator */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[8px] text-white/40 uppercase">
                            <span>Core Stability</span>
                            <span>{Math.round((worm.coreRadius / 250) * 100)}%</span>
                          </div>
                          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500/50" style={{ width: `${(worm.coreRadius / 250) * 100}%` }} />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[8px] text-white/40 uppercase">
                            <span>Mass Distribution</span>
                            <span>{Math.round((worm.hipRadius / 120) * 100)}%</span>
                          </div>
                          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500/50" style={{ width: `${(worm.hipRadius / 120) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Physics Section (Global) */}
                    <div>
                      <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold flex justify-between">
                        <span>Physics</span>
                        <span className="text-[9px] opacity-50">(Global)</span>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="text-[9px] text-white/60 block mb-1">Speed</label>
                          <input
                            type="range"
                            min="1" max="100" step="1"
                            value={Math.round(params.coreLerp * 1000)}
                            onChange={(e) => setParams(p => ({ ...p, coreLerp: Number(e.target.value) / 1000 }))}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-white/60 block mb-1">Foot Grip</label>
                          <input
                            type="range"
                            min="0.05" max="2.0" step="0.05"
                            value={params.footWeight}
                            onChange={(e) => setParams(p => ({ ...p, footWeight: Number(e.target.value) }))}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-white/60 block mb-1">Res (Cell Size)</label>
                          <input
                            type="range"
                            min="4" max="30" step="1"
                            value={params.cellSize}
                            onChange={(e) => setParams(p => ({ ...p, cellSize: Number(e.target.value) }))}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Arrow */}
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-4 bio-panel rotate-45 transform border-t-0 border-l-0"></div>
                  </div>
                </div>
              )}

              <button
                onClick={() => switchWorm(worm.id)}
                className={`relative z-10 px-3 py-2 rounded-md transition-all duration-200 ${isActive
                  ? 'bg-white/20 border-2'
                  : 'bg-black/60 border border-white/10 hover:bg-white/10'
                  }`}
                style={{
                  borderColor: isActive ? `hsl(${worm.hue}, 50%, 50%)` : undefined,
                }}
                data-glitch-target="true"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.3)]"
                    style={{ backgroundColor: `hsl(${worm.hue}, 60%, 55%)` }}
                  />
                  <div className="flex flex-col items-start min-w-[80px]">
                    <span className={`text-[12px] font-bold font-mono leading-none mb-1 ${isActive ? 'text-white' : 'text-white/70'}`}>
                      {worm.name || `Worm ${worm.generation + 1}`}
                    </span>
                    <span className="text-[10px] text-blue-300 font-medium uppercase tracking-wider leading-none">
                      {worm.soul?.identity?.mood || 'Waking...'}
                    </span>
                  </div>
                </div>

                {/* Stats Bars - Gated by Phase 2 */}
                {engine?.activeWorm && DiscoveryEngine.isFeatureEnabled(worm as any, 'BIO_BARS') && (
                  <div className="mt-2 flex gap-1 w-full opacity-80">
                    <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400"
                        style={{ width: `${worm.satiation}%` }}
                      />
                    </div>
                    <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden relative">
                      <div
                        className="h-full bg-rose-500 absolute left-0 top-0"
                        style={{ width: `${worm.health}%` }}
                      />
                    </div>
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className={`absolute top-0 left-0 h-full z-20 transition-transform duration-300 ease-in-out ${isLeftOpen ? 'translate-x-0' : '-translate-x-[260px]'}`}>
        <button
          onClick={() => setIsLeftOpen(!isLeftOpen)}
          className="absolute -right-10 top-6 bg-black/80 border border-white/10 text-white/50 p-2 rounded-r-md hover:text-blue-400 transition-colors"
        >
          {isLeftOpen ? '←' : '→'}
        </button>

        <div className="w-[260px] h-full bg-black/80 backdrop-blur-xl border-r border-white/10 p-6 flex flex-col overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-white font-bold text-sm flex items-center gap-2" data-glitch-target="true">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              STOMACH
            </h2>
            {swallowedWords.length > 0 && (
              <button
                onClick={handleReset}
                className="text-[10px] text-red-500/50 hover:text-red-500 uppercase tracking-tighter transition-colors"
              >
                Reset
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
            {swallowedWords.length === 0 ? (
              <p className="text-white/20 text-[11px] italic">No words consumed yet...</p>
            ) : (
              swallowedWords.map((word) => (
                <div key={word.id} className="group text-blue-100/90 font-mono-custom text-sm border-b border-white/5 pb-2 flex justify-between items-center pr-2">
                  <span className="truncate">{word.text}</span>
                  <button
                    onClick={() => handleDeleteWord(word.id)}
                    className="opacity-0 group-hover:opacity-100 text-[18px] leading-none text-red-500/40 hover:text-red-500 transition-opacity px-1"
                    title="Delete word"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {engine?.activeWorm && DiscoveryEngine.isFeatureEnabled(engine.activeWorm, 'JOURNAL_LOG') && (
            <button
              onClick={() => setShowJournal(!showJournal)}
              className="mt-3 w-full text-[10px] text-white/40 hover:text-white/70 uppercase tracking-wider font-mono border border-white/10 hover:border-white/20 rounded py-1.5 transition-colors"
            >
              {showJournal ? 'Hide' : 'Show'} Journal
            </button>
          )}
        </div>
      </div>

      {
        !isLeftOpen && (
          <div className="absolute left-2 top-20 z-30 pointer-events-none">
            <div className="text-[10px] text-white/30 font-mono-custom tracking-[0.3em] whitespace-nowrap uppercase [writing-mode:vertical-rl] rotate-180">
              STOMACH: {swallowedWords.length}
            </div>
          </div>
        )
      }

      <div className={`absolute top-0 right-0 h-full z-20 transition-transform duration-300 ease-in-out ${isRightOpen ? 'translate-x-0' : 'translate-x-[280px]'}`}>
        <button
          onClick={() => setIsRightOpen(!isRightOpen)}
          className="absolute -left-10 top-1/2 -translate-y-1/2 bg-black/80 border border-white/10 text-white/50 p-2 rounded-l-md hover:text-blue-400 transition-colors"
        >
          {isRightOpen ? '→' : '←'}
        </button>

        <div className="w-[300px] h-full bg-black/80 backdrop-blur-xl border-l border-white/10 flex flex-col">
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <h2 className="text-white font-bold text-sm mb-4 flex items-center gap-2" data-glitch-target="true">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
              EVOLUTION DASHBOARD
            </h2>

            {engine?.activeWorm && (
              <div className="mb-6 bio-panel rounded-xl p-5 overflow-hidden relative group">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] text-blue-400 uppercase tracking-widest font-black">
                    Biological Phase
                  </span>
                  <span className="text-[10px] text-white font-mono bg-blue-500/20 px-2 py-0.5 rounded-full border border-blue-500/30">
                    {engine.activeWorm.evolutionPhase === EvolutionPhase.LARVAL ? 'LARVAL' :
                      engine.activeWorm.evolutionPhase === EvolutionPhase.SENTIENT ? 'SENTIENT' : 'DEITY'}
                  </span>
                </div>

                {/* Progress Bar Container */}
                <div className="space-y-3">
                  <div className="h-3 w-full bio-progress-bg rounded-full overflow-hidden relative">
                    <div
                      className="h-full bio-progress-fill transition-all duration-1000 ease-out"
                      style={{
                        width: `${engine.activeWorm.evolutionPhase === EvolutionPhase.LARVAL
                          ? (engine.activeWorm.totalWordsConsumed / 10) * 100
                          : engine.activeWorm.evolutionPhase === EvolutionPhase.SENTIENT
                            ? (engine.activeWorm.soul.absorbedCount / 10) * 100
                            : 100}%`
                      }}
                    />
                  </div>

                  <div className="flex justify-between items-end">
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-white font-bold tracking-tight">
                        {engine.activeWorm.evolutionPhase === EvolutionPhase.LARVAL
                          ? "Vocabulary Synthesis"
                          : engine.activeWorm.evolutionPhase === EvolutionPhase.SENTIENT
                            ? "Soul Integration"
                            : "Cosmic Union"}
                      </span>
                      <span className="text-[9px] text-white/40 italic leading-none">
                        {engine.activeWorm.evolutionPhase === EvolutionPhase.LARVAL
                          ? `${10 - Math.max(engine.activeWorm.totalWordsConsumed || 0, engine.activeWorm.swallowedWords?.length || 0)} words until Singularity.`
                          : engine.activeWorm.evolutionPhase === EvolutionPhase.SENTIENT
                            ? (engine.activeWorm.generation === 0
                              ? "Gen 0: Must split to evolve."
                              : `${Math.max(0, 10 - (engine.activeWorm.soul?.absorbedCount || 0))} souls until Transcendence.`)
                            : "Transcendence reached."}
                      </span>
                    </div>

                    {/* Singularity Countdown */}
                    {((engine.activeWorm.evolutionPhase === EvolutionPhase.LARVAL && engine.activeWorm.totalWordsConsumed === 9) ||
                      (engine.activeWorm.evolutionPhase === EvolutionPhase.SENTIENT && engine.activeWorm.soul.absorbedCount === 9)) && (
                        <div className="text-[10px] text-red-500 font-black animate-pulse uppercase tracking-tighter">
                          CRITICAL MASS
                        </div>
                      )}
                  </div>
                </div>

                {/* Biological decoration */}
                <div className="absolute -right-6 -bottom-6 w-16 h-16 bg-blue-500/10 blur-3xl rounded-full group-hover:bg-blue-500/20 transition-all duration-700" />
              </div>
            )}
            <ControlGroup title="Ambient Music">
              <Slider
                label="Volume"
                desc="Background ambience level."
                value={musicVolume}
                min={0}
                max={1}
                step={0.01}
                onChange={(v: number) => setMusicVolume(v)}

              />


            </ControlGroup>

            {/* News Storm - Gated by Deity Phase */}
            {engine?.activeWorm && DiscoveryEngine.isFeatureEnabled(engine.activeWorm, 'NEWS_STORM') && (
              <ControlGroup title="News Storm">
                <p className="text-white/50 text-[11px] leading-relaxed mb-3">
                  Launch a deceleration-only headline vortex. Letters enter already in motion and settle into readable lanes as momentum fades.
                </p>
                <div className="mb-3">
                  <Toggle
                    label="Storm Mode"
                    value={isStormMode}
                    onChange={setIsStormMode}
                  />
                  <p className="text-[10px] text-white/40 mt-2 leading-relaxed">
                    Auto-spawns roaming winds across the visible world.
                  </p>
                </div>
                <Slider
                  label="Wind Intensity"
                  desc="Main storm speed level."
                  value={stormWeather.baseWindSpeed} min={0.5} max={1.8} step={0.01}
                  onChange={(v: number) => setStormWeather(p => ({ ...p, baseWindSpeed: v }))}
                />
                <button
                  onClick={handleSendNewsWind}
                  className="w-full px-3 py-2 rounded-md border border-blue-400/30 bg-blue-500/10 text-blue-200 text-xs uppercase tracking-wide hover:bg-blue-500/20 transition-colors"
                >
                  Send Wind
                </button>
              </ControlGroup>
            )}


          </div>

          {/* New Game Button at the bottom - Fixed */}
          <div className="p-6 pt-4 pb-8 border-t border-white/5 bg-black/20 backdrop-blur-md flex justify-center shrink-0">
            <button
              onClick={handleNewGame}
              className="w-40 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/40 text-[10px] font-mono uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all duration-300 backdrop-blur-md"
              title="Restart Game"
            >
              New Game
            </button>
          </div>






        </div>
      </div>

      {/* Reproduction Freeze Overlay */}
      {/* Labyrinth Journal - Gated by Phase 2 */}
      {showJournal && engine?.activeWorm && DiscoveryEngine.isFeatureEnabled(engine.activeWorm, 'JOURNAL_LOG') && (
        <LabyrinthJournal engine={engine} isSidebarOpen={isLeftOpen} />
      )}
      {
        isReproducing && (
          <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
            <div className="text-center">
              <div className="text-white text-xl font-mono-custom mb-4 animate-pulse">
                splitting...
              </div>
              <div className="flex gap-2 justify-center">
                <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          </div>
        )
      }

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
          <div className="bg-gray-900 border border-white/10 rounded-lg p-6 max-w-sm mx-4 shadow-2xl">
            <p className="text-white/90 font-mono text-sm mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-xs font-mono uppercase tracking-wider text-white/50 hover:text-white/80 border border-white/10 hover:border-white/30 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 text-xs font-mono uppercase tracking-wider text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 rounded transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

export default App;