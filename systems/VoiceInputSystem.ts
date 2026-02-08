import { System } from '../core/types';
import { Engine } from '../core/Engine';
import { EVENTS } from '../core/events';

// Types for Web Speech API (as it's experimental and not in all TS libs)
interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

interface SpeechRecognitionResultList {
    [index: number]: SpeechRecognitionResult;
    length: number;
}

interface SpeechRecognitionResult {
    [index: number]: SpeechRecognitionAlternative;
    isFinal: boolean;
    length: number;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: (event: SpeechRecognitionEvent) => void;
    onerror: (event: any) => void;
    onend: () => void;
}

interface SpeechRecognitionConstructor {
    new(): SpeechRecognition;
}

declare global {
    interface Window {
        SpeechRecognition: SpeechRecognitionConstructor;
        webkitSpeechRecognition: SpeechRecognitionConstructor;
    }
}

export class VoiceInputSystem implements System {
    private engine!: Engine;
    private recognition: SpeechRecognition | null = null;
    private isListening: boolean = false;
    private restartTimeout: number | null = null;

    // Audio Analysis
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private microphone: MediaStreamAudioSourceNode | null = null;
    private dataArray: Uint8Array | null = null;
    private sourceStream: MediaStream | null = null;
    private lastPitch: number = 0;
    private lastVolume: number = 0;

    init(engine: Engine) {
        this.engine = engine;
        // Ideally, we wait for user interaction to start audio. 
        // We'll expose methods to start/stop from UI.

        // Listen for external start/stop commands via events if needed, 
        // or just rely on direct method calls if we export the system instance (which we don't usually).
        // Let's add an event listener for toggling voice.
        this.engine.events.on('TOGGLE_VOICE_INPUT', this.handleToggleVoice);
    }

    cleanup() {
        this.stopListening();
        this.engine.events.off('TOGGLE_VOICE_INPUT', this.handleToggleVoice);
    }

    update(dt: number) {
        if (!this.isListening || !this.analyser || !this.dataArray) return;

        // Get Audio Data
        this.analyser.getByteFrequencyData(this.dataArray as any);

        // Calculate Volume (RMS)
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i] * this.dataArray[i];
        }
        const rms = Math.sqrt(sum / this.dataArray.length);
        const volume = rms / 255; // Normalize 0-1

        // Calculate Pitch (Simple approximation finding max frequency bin)
        let maxVal = -1;
        let maxIndex = -1;
        for (let i = 0; i < this.dataArray.length; i++) {
            if (this.dataArray[i] > maxVal) {
                maxVal = this.dataArray[i];
                maxIndex = i;
            }
        }
        // Frequency = index * sampleRate / fftSize
        const nyquist = this.audioContext!.sampleRate / 2;
        const binSize = nyquist / this.analyser.frequencyBinCount;
        const pitch = maxIndex * binSize;

        // Emit updates if significant
        this.lastVolume = volume;
        this.lastPitch = pitch;

        if (volume > 0.01) {
            this.engine.events.emit(EVENTS.VOICE_VOLUME_UPDATE, { volume, pitch });

            // Also emit particle stream event for visuals
            this.engine.events.emit(EVENTS.VOICE_PARTICLE_STREAM, {
                volume,
                pitch,
                timestamp: performance.now()
            });
        }
    }

    draw(ctx: CanvasRenderingContext2D) {
        // Debug visualizer (optional)
        /*
        if (this.isListening && this.dataArray) {
            ctx.save();
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.fillRect(10, 10, 20, this.dataArray[0]);
            ctx.restore();
        }
        */
    }

    private handleToggleVoice = async (enabled: boolean) => {
        if (enabled) {
            await this.startListening();
        } else {
            this.stopListening();
        }
    };

    private async startListening() {
        if (this.isListening) return;

        try {
            // 1. Audio Context Setup
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.sourceStream = stream;

            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048; // Higher resolution for pitch
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            // 2. Speech Recognition Setup
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                this.recognition = new SpeechRecognition();
                this.recognition.continuous = true;
                this.recognition.interimResults = true;
                // No lang set - browser will use default or auto-detect if supported.
                // this.recognition.lang = 'en-US'; 

                this.recognition.onresult = (event: SpeechRecognitionEvent) => {
                    let interimTranscript = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            const transcript = event.results[i][0].transcript.trim();
                            if (transcript.length > 0) {
                                this.handleFinalResult(transcript);
                            }
                        } else {
                            interimTranscript += event.results[i][0].transcript;
                        }
                    }

                    if (interimTranscript.length > 0) {
                        this.engine.events.emit(EVENTS.VOICE_INTERIM_RESULT, { text: interimTranscript });
                    }
                };

                this.recognition.onend = () => {
                    if (this.isListening) {
                        // Auto-restart if it stops unexpectedly while supposed to be running
                        this.restartTimeout = window.setTimeout(() => {
                            if (this.recognition && this.isListening) this.recognition.start();
                        }, 100);
                    } else {
                        this.engine.events.emit(EVENTS.VOICE_INPUT_END, {});
                    }
                };

                this.recognition.onerror = (event: any) => {
                    console.error("Speech Recognition Error", event.error);
                };

                this.recognition.start();
            } else {
                console.warn("Speech Recognition API not supported in this browser.");
            }

            this.isListening = true;
            this.engine.events.emit(EVENTS.VOICE_INPUT_START, {});
            console.log("[VoiceSystem] Started listening");

        } catch (err) {
            console.error("[VoiceSystem] Failed to start audio", err);
            this.isListening = false;
        }
    }

    private stopListening() {
        if (!this.isListening) return;

        // Stop Audio Context
        if (this.sourceStream) {
            this.sourceStream.getTracks().forEach(track => track.stop());
            this.sourceStream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        // Stop Recognition
        if (this.recognition) {
            this.recognition.stop();
            this.recognition = null;
        }

        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
            this.restartTimeout = null;
        }

        this.isListening = false;
        this.engine.events.emit(EVENTS.VOICE_INPUT_END, {});
        console.log("[VoiceSystem] Stopped listening");
    }

    private handleFinalResult(text: string) {
        console.log(`[VoiceSystem] Recognized: "${text}"`);

        // Analyze recent volume for "shout" vs "whisper"
        // We can use the current RMS volume as a proxy, or maybe we track peak volume during the word?
        // For simplicity, we'll use the current volume at the moment of completion, 
        // though strictly speaking the word was spoken in the past few seconds.
        // A better approach might be to average volume over the last second. 
        // But let's start simple.

        let volume = 0.5; // Default
        if (this.dataArray) {
            let sum = 0;
            for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i] * this.dataArray[i];
            volume = Math.sqrt(sum / this.dataArray.length) / 255;
        }

        // Split text into words if it's a phrase
        const words = text.split(/\s+/);

        words.forEach((word, index) => {
            // Add a small delay for each word to create a "streaming" effect if it's a long sentence
            setTimeout(() => {
                this.engine.events.emit(EVENTS.VOICE_WORD_SPAWNED, {
                    text: word,
                    volume: this.lastVolume, // Use latest measured
                    pitch: this.lastPitch,
                    timestamp: Date.now()
                });
            }, index * 150);
        });

        // echo / journal logic
        fetch('/api/echo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        })
            .then(res => res.json())
            .then(data => {
                if (data.text) {
                    this.engine.events.emit(EVENTS.JOURNAL_ENTRY, data.text);
                }
            })
            .catch(err => console.error("[VoiceSystem] Echo failed:", err));
    }
}
