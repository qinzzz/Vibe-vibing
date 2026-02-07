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
      if (engineRef.current) {
        engineRef.current.events.emit(EVENTS.STOMACH_CLEAR, {});
      }
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

      {/* Worm Selector UI - Moved to Bottom */}
      {worms.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex gap-2 pointer-events-auto">
          <div className="bg-black/80 backdrop-blur-md px-3 py-2 rounded-lg border border-white/10">
            <div className="text-white/50 text-[10px] uppercase tracking-widest mb-2">
              Worms ({worms.length})
            </div>
            <div className="flex gap-2">
              {worms.map(worm => {
                const isActive = worm.id === activeWormId;
                return (
                  <button
                    key={worm.id}
                    onClick={() => switchWorm(worm.id)}
                    className={`px-3 py-2 rounded-md transition-all duration-200 ${isActive
                        ? 'bg-white/20 border-2'
                        : 'bg-black/60 border border-white/10 hover:bg-white/10'
                      }`}
                    style={{
                      borderColor: isActive ? `hsl(${worm.hue}, 50%, 50%)` : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: `hsl(${worm.hue}, 50%, 50%)` }}
                      />
                      <span className="text-white/80 text-xs font-mono">
                        {worm.name || `Cycle ${1 + worm.generation}`}
                      </span>
                      <span className="text-white/60 text-[10px]">
                        {worm.vocabulary.size}w
                      </span>
                    </div>
                    <div className="mt-1 flex gap-1">
                      <div className="w-12 h-1 bg-black/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-yellow-500"
                          style={{ width: `${worm.satiation}%` }}
                        />
                      </div>
                      <div className="w-12 h-1 bg-black/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-500"
                          style={{ width: `${worm.health}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

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

      {!isLeftOpen && (
        <div className="absolute left-6 top-1/2 -translate-y-28 -rotate-90 origin-left z-30 pointer-events-none">
          <div className="text-[10px] text-white/30 font-mono-custom tracking-[0.3em] whitespace-nowrap uppercase">
            STOMACH: {swallowedWords.length}
          </div>
        </div>
      )}

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

          <ControlGroup title="Visibility">
            <Toggle
              label="Show Skeleton"
              value={params.showSkeleton}
              onChange={(v: boolean) => setParams(p => ({ ...p, showSkeleton: v }))}
            />
          </ControlGroup>

          <ControlGroup title="Locomotion & IK">
            <Slider
              label="Upper Leg (L1)"
              value={params.l1} min={20} max={100} step={1}
              onChange={(v: number) => setParams(p => ({ ...p, l1: v }))}
            />
            <Slider
              label="Lower Leg (L2)"
              value={params.l2} min={20} max={100} step={1}
              onChange={(v: number) => setParams(p => ({ ...p, l2: v }))}
            />
            <Slider
              label="Step Trigger"
              value={params.stepTrigger} min={30} max={150} step={5}
              onChange={(v: number) => setParams(p => ({ ...p, stepTrigger: v }))}
            />
          </ControlGroup>

          <ControlGroup title="Metaball Radius">
            <Slider
              label="Core Radius"
              value={params.coreRadius} min={50} max={300} step={5}
              onChange={(v: number) => setParams(p => ({ ...p, coreRadius: v }))}
            />
            <Slider
              label="Hip Radius"
              value={params.hipRadius} min={30} max={150} step={5}
              onChange={(v: number) => setParams(p => ({ ...p, hipRadius: v }))}
            />
            <Slider
              label="Foot Radius"
              value={params.footRadius} min={10} max={150} step={2}
              onChange={(v: number) => setParams(p => ({ ...p, footRadius: v }))}
            />
          </ControlGroup>

          <ControlGroup title="Field Weights">
            <Slider
              label="Movement Speed"
              value={Math.round(params.coreLerp * 1000)} min={1} max={100} step={1}
              onChange={(v: number) => setParams(p => ({ ...p, coreLerp: v / 1000 }))}
            />
            <Slider
              label="Skin Thickness (ISO)"
              value={params.isoThreshold} min={0.05} max={0.9} step={0.01}
              onChange={(v: number) => setParams(p => ({ ...p, isoThreshold: v }))}
            />
            <Slider
              label="Foot Strength"
              value={params.footWeight} min={0.05} max={2.0} step={0.05}
              onChange={(v: number) => setParams(p => ({ ...p, footWeight: v }))}
            />
          </ControlGroup>

          <ControlGroup title="Resolution">
            <Slider
              label="Cell Size"
              value={params.cellSize} min={4} max={30} step={1}
              onChange={(v: number) => setParams(p => ({ ...p, cellSize: v }))}
            />
          </ControlGroup>
        </div>
      </div>

      {/* Reproduction Freeze Overlay */}
      {isReproducing && (
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
      )}
    </div>
  );
};

export default App;
