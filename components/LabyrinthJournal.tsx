import React, { useState, useEffect, useRef } from 'react';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';

interface JournalEntry {
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
        }, 30); // Speed of typewriter

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
    const [entries, setEntries] = useState<JournalEntry[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!engine) return;

        console.log("[JOURNAL] Component mounted, engine ready. Listening for entries...");

        const handleNewEntry = (text: string) => {
            console.log("[JOURNAL] New entry event received:", text);
            const newEntry: JournalEntry = {
                id: Math.random().toString(36).substring(7),
                text,
                timestamp: Date.now(),
            };
            setEntries(prev => [newEntry, ...prev].slice(0, 10)); // Keep last 10
        };

        engine.events.on(EVENTS.JOURNAL_ENTRY, handleNewEntry);

        // Initial entry to show it's working
        setEntries([{
            id: 'init-entry',
            text: "The Labyrinth is vast and silent. Every consumed word is a memory carved into the Void.",
            timestamp: Date.now()
        }]);

        return () => engine.events.off(EVENTS.JOURNAL_ENTRY, handleNewEntry);
    }, [engine]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = 0;
        }
    }, [entries]);

    if (entries.length === 0) return null;

    return (
        <div className={`absolute bottom-32 z-40 w-80 max-h-[30vh] pointer-events-none flex flex-col gap-4 transition-all duration-300 ease-in-out ${isSidebarOpen ? 'left-[280px]' : 'left-6'}`}>
            <div className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-mono-custom pl-2 border-l border-white/20">
                Log of the Labyrinth
            </div>

            <div
                ref={scrollRef}
                className="overflow-y-auto custom-scrollbar flex flex-col gap-6 pr-4 pointer-events-auto"
                style={{ direction: 'rtl' }} // Scrollbar on the left if preferred, but standard is fine
            >
                <div style={{ direction: 'ltr' }}>
                    {entries.map((entry, idx) => (
                        <div
                            key={entry.id}
                            className={`mb-6 last:mb-0 transition-opacity duration-1000 ${idx === 0 ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}
                        >
                            <div className="font-['Cormorant_Garamond',serif] text-lg text-blue-100/90 leading-relaxed italic select-none">
                                {idx === 0 ? (
                                    <TypewriterText text={entry.text} />
                                ) : (
                                    entry.text
                                )}
                            </div>
                            <div className="mt-1 text-[9px] text-white/20 font-mono-custom tracking-widest uppercase">
                                Obs. {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
