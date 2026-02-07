import React, { useState, useCallback, useEffect, useRef } from 'react';
import BlobCanvas from './components/BlobCanvas';
import { BLOB_CONSTANTS } from './constants';
import { Slider } from './components/ui/Slider';
import { Toggle } from './components/ui/Toggle';
import { ControlGroup } from './components/ui/ControlGroup';
import { Engine } from './core/Engine';
import { EVENTS } from './core/events';
import type { Worm } from './types';

const NEWS_PREFETCH_LIMIT = 25;
const NEWS_PREFETCH_MS = 2 * 60 * 60 * 1000;

const App: React.FC = () => {
  const [params, setParams] = useState({
    l1: 58.00,
    l2: 35.00,
    stepTrigger: 60.00,
    coreRadius: 190.00,
    hipRadius: 85.00,
    kneeRadius: BLOB_CONSTANTS.METABALL.KNEE_RADIUS,
    footRadius: 74.00,
    coreWeight: BLOB_CONSTANTS.METABALL.CORE_WEIGHT,
    hipWeight: BLOB_CONSTANTS.METABALL.HIP_WEIGHT,
    kneeWeight: BLOB_CONSTANTS.METABALL.KNEE_WEIGHT,
    footWeight: 0.20,
    isoThreshold: 0.25,
    cellSize: 12.00,
    coreLerp: BLOB_CONSTANTS.CORE_LERP,
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

  const [isRightOpen, setIsRightOpen] = useState(false);
  const [isLeftOpen, setIsLeftOpen] = useState(false);
  const [swallowedWords, setSwallowedWords] = useState<{ id: string, text: string }[]>([]);
  const [worms, setWorms] = useState<Worm[]>([]);
  const [activeWormId, setActiveWormId] = useState<string>('worm-0');
  const [isReproducing, setIsReproducing] = useState(false);
  const engineRef = useRef<Engine | null>(null);
  const newsHeadlinePoolRef = useRef<string[]>([]);

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

  const handleEngineInit = useCallback((engine: Engine) => {
    engineRef.current = engine;
    engine.events.emit(EVENTS.NEWS_STORM_DEBUG_UPDATED, weatherDebug);
    engine.events.emit(EVENTS.NEWS_STORM_MODE_UPDATED, { enabled: isStormMode });
    engine.events.emit(EVENTS.NEWS_STORM_WEATHER_UPDATED, stormWeather);

    // Listen for worm lifecycle events
    engine.events.on(EVENTS.WORM_BORN, updateWormList);
    engine.events.on(EVENTS.WORM_DIED, updateWormList);

    // Listen for hydration complete to sync UI with restored worms
    engine.events.on(EVENTS.WORMS_HYDRATED, () => {
      updateWormList();
      // Update swallowed words for active worm after hydration
      if (engineRef.current) {
        const activeWorm = engineRef.current.activeWorm;
        setSwallowedWords(activeWorm.swallowedWords.map(w => ({ id: w.id, text: w.text })));
      }
    });

    // Listen for reproduction events to freeze UI
    engine.events.on(EVENTS.REPRODUCTION_START, () => setIsReproducing(true));
    engine.events.on(EVENTS.REPRODUCTION_COMPLETE, () => {
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

  const handleClearAll = async () => {
    if (!window.confirm("Purge all memories?")) return;
    try {
      await fetch('/api/stomach', { method: 'DELETE' });
      setSwallowedWords([]);
    } catch (e) {
      console.error("Clear failed", e);
    }
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
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col">
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
        <h1 className="text-white text-2xl font-bold tracking-tight opacity-80 uppercase italic font-mono-custom">
          The Word Worm
        </h1>
        <p className="text-blue-400 text-sm font-medium mt-1">
          Upon waking, it realized it had lost all of its words. What it eats, it remembers.
        </p>
      </div>

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
              onMouseEnter={() => setHoveredWormId(worm.id)}
              onMouseLeave={() => setHoveredWormId(null)}
            >
              {/* Popover Menu */}
              {(isHovered || (isActive && hoveredWormId === worm.id)) && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-[220px] bg-black/90 backdrop-blur-xl border border-white/20 rounded-xl p-3 shadow-2xl z-50 flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-200">

                  {/* Mood Section */}
                  <div>
                    <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold">Mood</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {['Serene', 'Watchful', 'Playful', 'Wistful', 'Irritable', 'Electric'].map(m => (
                        <button
                          key={m}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoodInfluence(m, worm.id);
                          }}
                          className="px-2 py-1.5 bg-white/5 border border-white/10 rounded text-[10px] text-white/70 hover:bg-white/20 hover:text-blue-300 transition-colors text-center"
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Soul Section */}
                  <div>
                    <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold flex justify-between">
                      <span>Soul</span>
                      <span className="text-[9px] opacity-50">(Personality)</span>
                    </div>
                    <div className="space-y-1.5 max-h-[120px] overflow-y-auto custom-scrollbar pr-1">
                      {Object.entries(worm.soul?.axes || {}).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between text-[9px] text-white/60">
                          <span className="capitalize w-16">{key}</span>
                          <div className="flex-1 h-1.5 bg-white/10 rounded-full mx-2 relative">
                            {/* Center line */}
                            <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/20"></div>
                            {/* Bar */}
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${Number(value) > 0 ? 'bg-blue-400' : 'bg-amber-400'}`}
                              style={{
                                width: `${Math.min(50, Math.abs(Number(value)) * 50)}%`,
                                left: Number(value) > 0 ? '50%' : undefined,
                                right: Number(value) <= 0 ? '50%' : undefined
                              }}
                            />
                          </div>
                          <span className="w-6 text-right font-mono">{(Number(value)).toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Shape Section (Global) */}
                  <div>
                    <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 font-bold flex justify-between">
                      <span>Shape</span>
                      <span className="text-[9px] opacity-50">(Global)</span>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-[9px] text-white/60 block mb-1">Core Size</label>
                        <input
                          type="range"
                          min="50" max="300" step="5"
                          value={params.coreRadius}
                          onChange={(e) => setParams(p => ({ ...p, coreRadius: Number(e.target.value) }))}
                          className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-white/60 block mb-1">Hip Size</label>
                        <input
                          type="range"
                          min="30" max="150" step="5"
                          value={params.hipRadius}
                          onChange={(e) => setParams(p => ({ ...p, hipRadius: Number(e.target.value) }))}
                          className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-white/60 block mb-1">Foot Size</label>
                        <input
                          type="range"
                          min="10" max="150" step="2"
                          value={params.footRadius}
                          onChange={(e) => setParams(p => ({ ...p, footRadius: Number(e.target.value) }))}
                          className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-white/60 block mb-1">Thickness</label>
                        <input
                          type="range"
                          min="0.05" max="0.9" step="0.01"
                          value={params.isoThreshold}
                          onChange={(e) => setParams(p => ({ ...p, isoThreshold: Number(e.target.value) }))}
                          className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20"
                        />
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
                  <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-black/90 border-r border-b border-white/20 rotate-45 transform"></div>
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

                {/* Stats Bars */}
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
              </button>
            </div>
          );
        })}
      </div>

      <div className={`absolute top-0 left-0 h-full z-20 transition-transform duration-300 ease-in-out ${isLeftOpen ? 'translate-x-0' : '-translate-x-[260px]'}`}>
        <button
          onClick={() => setIsLeftOpen(!isLeftOpen)}
          className="absolute -right-10 top-1/2 -translate-y-1/2 bg-black/80 border border-white/10 text-white/50 p-2 rounded-r-md hover:text-blue-400 transition-colors"
        >
          {isLeftOpen ? '←' : '→'}
        </button>

        <div className="w-[260px] h-full bg-black/80 backdrop-blur-xl border-r border-white/10 p-6 flex flex-col overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-white font-bold text-sm flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              STOMACH
            </h2>
            {swallowedWords.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-[10px] text-red-500/50 hover:text-red-500 uppercase tracking-tighter transition-colors"
              >
                Clear All
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
        </div>
      </div>

      {
        !isLeftOpen && (
          <div className="absolute left-6 top-1/2 -translate-y-28 -rotate-90 origin-left z-30 pointer-events-none">
            <div className="text-[10px] text-white/30 font-mono-custom tracking-[0.3em] whitespace-nowrap uppercase">
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

        <div className="w-[300px] h-full bg-black/80 backdrop-blur-xl border-l border-white/10 p-6 overflow-y-auto custom-scrollbar">
          <h2 className="text-white font-bold text-sm mb-6 flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
            GLUTTON CONFIG
          </h2>

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
              label="Base Wind Speed"
              desc="Main storm speed level for auto weather."
              value={stormWeather.baseWindSpeed} min={0.5} max={1.8} step={0.01}
              onChange={(v: number) => setStormWeather(p => ({ ...p, baseWindSpeed: v }))}
            />
            <Slider
              label="Speed Variance"
              desc="How far each gust can deviate from base."
              value={stormWeather.speedVariance} min={0.0} max={0.8} step={0.01}
              onChange={(v: number) => setStormWeather(p => ({ ...p, speedVariance: v }))}
            />
            <Slider
              label="Weather Volatility"
              desc="How aggressively weather patterns change."
              value={stormWeather.volatility} min={0.1} max={1.0} step={0.01}
              onChange={(v: number) => setStormWeather(p => ({ ...p, volatility: v }))}
            />
            <button
              onClick={handleSendNewsWind}
              className="w-full px-3 py-2 rounded-md border border-blue-400/30 bg-blue-500/10 text-blue-200 text-xs uppercase tracking-wide hover:bg-blue-500/20 transition-colors"
            >
              Send Wind
            </button>
          </ControlGroup>

          <ControlGroup title="Weather Debug">
            <Slider
              label="Entry Wind"
              desc="Higher = cleaner directional inflow."
              value={weatherDebug.entryWind} min={0.1} max={1.8} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, entryWind: v }))}
            />
            <Slider
              label="Entry Swirl"
              desc="Higher = stronger incoming vortex curl."
              value={weatherDebug.entrySwirl} min={0.1} max={1.8} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, entrySwirl: v }))}
            />
            <Slider
              label="Entry Speed"
              desc="Initial momentum of letters."
              value={weatherDebug.entrySpeed} min={0.4} max={2.4} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, entrySpeed: v }))}
            />
            <Slider
              label="Drag Strength"
              desc="Higher = faster momentum loss."
              value={weatherDebug.dragStrength} min={0.2} max={2.5} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, dragStrength: v }))}
            />
            <Slider
              label="Target Pull"
              desc="How strongly letters commit to target orbit."
              value={weatherDebug.targetPull} min={0.2} max={2.2} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, targetPull: v }))}
            />
            <Slider
              label="Landing Radius"
              desc="Distance threshold for final lock."
              value={weatherDebug.landingRadius} min={0.3} max={2.2} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, landingRadius: v }))}
            />
            <Slider
              label="Landing Speed"
              desc="Speed threshold for final lock."
              value={weatherDebug.landingSpeed} min={0.3} max={2.2} step={0.01}
              onChange={(v: number) => setWeatherDebug(p => ({ ...p, landingSpeed: v }))}
            />
          </ControlGroup>




        </div>
      </div>

      {/* Reproduction Freeze Overlay */}
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
    </div >
  );
};

export default App;
