import React, { useState, useEffect, useRef } from 'react';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';

interface KeywordProgress {
    keyword: string;   // partially revealed: "sh___"
    inVocab: boolean;
    spoken: boolean;
}

interface SegmentDisplay {
    index: number;
    hint: string;
    narrative: string | null;
    revealed: boolean;
    keywordProgress: KeywordProgress[];
}

interface SystemEntry {
    id: string;
    text: string;
    timestamp: number;
}

const TypewriterText: React.FC<{ text: string }> = ({ text }) => {
    const [displayedText, setDisplayedText] = useState('');
    const [isComplete, setIsComplete] = useState(false);

    useEffect(() => {
        let currentIndex = 0;
        const interval = setInterval(() => {
            if (currentIndex < text.length) {
                setDisplayedText(text.substring(0, currentIndex + 1));
                currentIndex++;
            } else {
                setIsComplete(true);
                clearInterval(interval);
            }
        }, 30);

        return () => clearInterval(interval);
    }, [text]);

    return (
        <span className={`inline-block transition-opacity duration-1000 ${isComplete ? 'opacity-100' : 'opacity-90'}`}>
            {displayedText}
            {!isComplete && <span className="animate-pulse ml-0.5 border-r border-white/50">&nbsp;</span>}
        </span>
    );
};

interface LabyrinthJournalProps {
    engine: Engine | null;
    isSidebarOpen?: boolean;
}

export const LabyrinthJournal: React.FC<LabyrinthJournalProps> = ({ engine, isSidebarOpen = false }) => {
    const [segments, setSegments] = useState<SegmentDisplay[]>([]);
    const [systemEntries, setSystemEntries] = useState<SystemEntry[]>([]);
    const [totalSegments, setTotalSegments] = useState(10);
    const [revealedCount, setRevealedCount] = useState(0);
    const [newestSegmentIndex, setNewestSegmentIndex] = useState<number | null>(null);
    const [storyTitle, setStoryTitle] = useState('');
    const [isCollapsed, setIsCollapsed] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!engine) return;

        console.log("[JOURNAL] Component mounted, engine ready. Listening for entries...");

        // Handle story state hydration (from initial load or keyword progress updates)
        const handleStoryState = (data: any) => {
            console.log("[JOURNAL] STORY_STATE_CHANGED received:", data);
            if (data.hasStory) {
                if (data.title) setStoryTitle(data.title);
                if (data.totalSegments) setTotalSegments(data.totalSegments);
                if (data.revealedCount !== undefined) setRevealedCount(data.revealedCount);

                // Full segment data from initial load
                if (data.segments && data.segments.length > 0) {
                    setSegments(data.segments.map((seg: any) => ({
                        index: seg.index,
                        hint: seg.hint,
                        narrative: seg.narrative || null,
                        revealed: seg.revealed || false,
                        keywordProgress: seg.keywordProgress || [],
                    })));
                }

                // Keyword progress update (from ThoughtService check-unlock)
                if (data.keywordProgress && !data.segments) {
                    setSegments(prev => {
                        const updated = [...prev];
                        for (const kp of data.keywordProgress) {
                            const idx = updated.findIndex(s => s.index === kp.index);
                            if (idx >= 0) {
                                updated[idx] = {
                                    ...updated[idx],
                                    revealed: kp.revealed,
                                    keywordProgress: kp.keywords || updated[idx].keywordProgress,
                                };
                            }
                        }
                        return updated;
                    });
                }
            }
        };

        // Handle new story fragment revealed
        const handleFragmentRevealed = (data: any) => {
            console.log("[JOURNAL] STORY_FRAGMENT_REVEALED:", data);
            setSegments(prev => {
                const updated = [...prev];
                const idx = updated.findIndex(s => s.index === data.segmentIndex);
                if (idx >= 0) {
                    updated[idx] = {
                        ...updated[idx],
                        narrative: data.text,
                        revealed: true,
                    };
                }
                // Also update keyword progress if provided
                if (data.keywordProgress) {
                    for (const kp of data.keywordProgress) {
                        const kpIdx = updated.findIndex(s => s.index === kp.index);
                        if (kpIdx >= 0) {
                            updated[kpIdx] = {
                                ...updated[kpIdx],
                                revealed: kp.revealed,
                                keywordProgress: kp.keywords || updated[kpIdx].keywordProgress,
                            };
                        }
                    }
                }
                return updated;
            });
            setRevealedCount(data.revealedCount);
            setTotalSegments(data.totalSegments);
            setNewestSegmentIndex(data.segmentIndex);
        };

        // Handle system alerts (sentience proof, ascension, etc.)
        const handleSystemEntry = (text: string) => {
            const newEntry: SystemEntry = {
                id: Math.random().toString(36).substring(7),
                text,
                timestamp: Date.now(),
            };
            setSystemEntries(prev => [newEntry, ...prev].slice(0, 5));
        };

        engine.events.on(EVENTS.STORY_STATE_CHANGED, handleStoryState);
        engine.events.on(EVENTS.STORY_FRAGMENT_REVEALED, handleFragmentRevealed);
        engine.events.on(EVENTS.JOURNAL_ENTRY, handleSystemEntry);

        // Fetch story data directly from server on mount (reliable, no race conditions)
        const wormId = engine.wormState?.activeWormId;
        if (wormId) {
            fetch(`/api/story/${wormId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.hasStory) handleStoryState(data);
                })
                .catch(err => console.error('[JOURNAL] Failed to fetch story:', err));
        }

        return () => {
            engine.events.off(EVENTS.STORY_STATE_CHANGED, handleStoryState);
            engine.events.off(EVENTS.STORY_FRAGMENT_REVEALED, handleFragmentRevealed);
            engine.events.off(EVENTS.JOURNAL_ENTRY, handleSystemEntry);
        };
    }, [engine]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = 0;
        }
    }, [segments, systemEntries]);

    const hasContent = segments.length > 0 || systemEntries.length > 0;

    return (
        <div className={`absolute bottom-0 z-40 w-80 pointer-events-auto flex flex-col transition-all duration-300 ease-in-out ${isSidebarOpen ? 'left-[280px]' : 'left-0'}`}>
            {/* Collapse/Expand Toggle */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="self-start ml-4 mb-0 px-3 py-1 bg-black/50 backdrop-blur-sm border border-white/10 border-b-0 rounded-t-md text-[9px] text-white/50 uppercase tracking-widest font-mono-custom hover:text-white/80 hover:bg-black/60 transition-colors"
            >
                {isCollapsed ? 'Story' : 'Hide'} {isCollapsed ? `(${revealedCount}/${totalSegments})` : ''}
            </button>

            {/* Panel Body */}
            <div className={`bg-black/40 backdrop-blur-md border-t border-r border-white/10 rounded-tr-xl p-4 flex flex-col gap-3 transition-all duration-300 ease-in-out overflow-hidden ${isCollapsed ? 'max-h-0 p-0 border-0' : 'max-h-[60vh]'}`}>
                {/* Header */}
                <div className="pl-2 border-l border-white/40">
                    <div className="text-[13px] text-blue-200/90 uppercase tracking-[0.15em] font-mono-custom font-bold">
                        Log of the Labyrinth
                    </div>
                </div>

                {/* Story Progress Bar */}
                <div className="pl-2">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] text-white/50 uppercase tracking-widest font-mono-custom">
                            Story Progress
                        </span>
                        <span className="text-[9px] text-blue-300/80 font-mono-custom">
                            {revealedCount}/{totalSegments}
                        </span>
                    </div>
                    <div className="h-1 w-full bg-white/15 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-blue-400/60 transition-all duration-1000 ease-out"
                            style={{ width: `${(revealedCount / totalSegments) * 100}%` }}
                        />
                    </div>
                </div>

                {/* Segments */}
                {hasContent && (
                    <div
                        ref={scrollRef}
                        className="overflow-y-auto custom-scrollbar flex flex-col gap-4 pr-1"
                    >
                        {/* All Segments (in order) — revealed or locked */}
                        {segments.map((segment) => (
                            <div
                                key={`seg-${segment.index}`}
                                className={`transition-opacity duration-1000 ${
                                    segment.revealed
                                        ? (segment.index === newestSegmentIndex ? 'opacity-100' : 'opacity-80 hover:opacity-100')
                                        : 'opacity-70 hover:opacity-90'
                                }`}
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-[9px] font-mono-custom uppercase tracking-wider ${
                                        segment.revealed ? 'text-blue-400/80' : 'text-white/50'
                                    }`}>
                                        {segment.revealed ? `Fragment ${segment.index + 1}` : `??? ${segment.index + 1}`}
                                    </span>
                                </div>

                                {segment.revealed ? (
                                    /* Revealed: Full narrative with typewriter on newest */
                                    <div className="font-['Cormorant_Garamond',serif] text-lg text-blue-100 leading-relaxed italic select-none">
                                        {segment.index === newestSegmentIndex ? (
                                            <TypewriterText text={segment.narrative || ''} />
                                        ) : (
                                            segment.narrative
                                        )}
                                    </div>
                                ) : (
                                    /* Locked: Hint + keyword indicators */
                                    <>
                                        <div className="font-mono-custom text-[13px] text-white/50 italic leading-relaxed select-none">
                                            {segment.hint}
                                        </div>
                                        {/* Keyword indicators */}
                                        {segment.keywordProgress.length > 0 && (
                                            <div className="flex gap-2 mt-1.5 flex-wrap">
                                                {segment.keywordProgress.map((kp, ki) => (
                                                    <div
                                                        key={ki}
                                                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono-custom border ${
                                                            kp.inVocab && kp.spoken
                                                                ? 'border-green-500/50 text-green-400/90 bg-green-500/15'
                                                                : kp.inVocab
                                                                    ? 'border-amber-500/40 text-amber-400/70 bg-amber-500/10'
                                                                    : 'border-white/20 text-white/40 bg-white/5'
                                                        }`}
                                                        title={
                                                            kp.inVocab && kp.spoken
                                                                ? 'In vocab & spoken!'
                                                                : kp.inVocab
                                                                    ? 'In vocab, not yet spoken'
                                                                    : 'Not yet eaten'
                                                        }
                                                    >
                                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                                            kp.inVocab && kp.spoken
                                                                ? 'bg-green-400'
                                                                : kp.inVocab
                                                                    ? 'bg-amber-400'
                                                                    : 'bg-white/30'
                                                        }`} />
                                                        {kp.keyword}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        ))}

                        {/* System Entries (dimmed, below story) */}
                        {systemEntries.map((entry) => (
                            <div
                                key={entry.id}
                                className="opacity-30 hover:opacity-60 transition-opacity duration-500"
                            >
                                <div className="font-mono-custom text-[11px] text-amber-200/70 leading-relaxed select-none">
                                    {entry.text}
                                </div>
                                <div className="mt-1 text-[8px] text-white/15 font-mono-custom tracking-widest uppercase">
                                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!hasContent && (
                    <div className="pl-2 text-[11px] text-white/20 italic font-mono-custom">
                        Awaiting fragments...
                    </div>
                )}
            </div>
        </div>
    );
};
