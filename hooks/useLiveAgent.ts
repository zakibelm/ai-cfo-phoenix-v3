import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob } from '@google/genai';

// Initialize the GoogleGenAI client once, as per guidelines.
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || '' });

// Base64 encoding/decoding and audio processing functions from Gemini API guidelines.
function encode(bytes: Uint8Array): string {
  // PERF: Use array join instead of string concat to avoid O(n²) memory allocations
  const chars: string[] = new Array(bytes.byteLength);
  for (let i = 0; i < bytes.byteLength; i++) {
    chars[i] = String.fromCharCode(bytes[i]);
  }
  return btoa(chars.join(''));
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  // PERF: Deinterleave channels in single pass O(n) instead of O(n²)
  const channelDataArrays = Array.from({ length: numChannels }, (_, i) => buffer.getChannelData(i));
  
  for (let i = 0; i < frameCount; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      channelDataArrays[channel][i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createBlob(data: Float32Array): Blob {
  // PERF: Pre-allocate typed array with correct size
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768)); // ROBUSTNESS: Clamp values
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

export interface LiveAgentTranscript {
  userInput: string;
  modelOutput: string;
  isTurnComplete: boolean;
}

export const useLiveAgent = (
    onTranscriptUpdate: (transcript: LiveAgentTranscript) => void
) => {
    const [isLive, setIsLive] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    
    // Refs to hold the latest state and props for stable callbacks
    const stateRef = useRef({ isLive, isConnecting });
    useEffect(() => {
        stateRef.current = { isLive, isConnecting };
    }, [isLive, isConnecting]);

    const onTranscriptUpdateRef = useRef(onTranscriptUpdate);
    useEffect(() => {
        onTranscriptUpdateRef.current = onTranscriptUpdate;
    }, [onTranscriptUpdate]);

    const sessionPromise = useRef<Promise<LiveSession> | null>(null);
    const inputAudioContext = useRef<AudioContext | null>(null);
    const outputAudioContext = useRef<AudioContext | null>(null);
    const outputNode = useRef<GainNode | null>(null);
    const sources = useRef(new Set<AudioBufferSourceNode>());
    const mediaStream = useRef<MediaStream | null>(null);
    const scriptProcessor = useRef<ScriptProcessorNode | null>(null);
    
    const nextStartTime = useRef(0);
    const currentInputTranscription = useRef('');
    const currentOutputTranscription = useRef('');

    const closeSession = useCallback(() => {
        if (!stateRef.current.isLive && !stateRef.current.isConnecting) return;
        
        sessionPromise.current?.then(session => session.close());
        sessionPromise.current = null;

        mediaStream.current?.getTracks().forEach(track => track.stop());
        mediaStream.current = null;

        scriptProcessor.current?.disconnect();
        scriptProcessor.current = null;
        
        inputAudioContext.current?.close().catch(console.error);
        outputAudioContext.current?.close().catch(console.error);

        setIsLive(false);
        setIsConnecting(false);
        nextStartTime.current = 0;
        currentInputTranscription.current = '';
        currentOutputTranscription.current = '';

    }, []); // Stable: empty dependency array


    const startSession = useCallback(async () => {
        if (stateRef.current.isLive || stateRef.current.isConnecting) return;
        setIsConnecting(true);

        try {
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContext) {
                console.error("Browser does not support Web Audio API. Live session cannot start.");
                setIsConnecting(false);
                return;
            }

            inputAudioContext.current = new AudioContext({ sampleRate: 16000 });
            outputAudioContext.current = new AudioContext({ sampleRate: 24000 });
            outputNode.current = outputAudioContext.current.createGain();
            outputNode.current.connect(outputAudioContext.current.destination);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStream.current = stream;

            sessionPromise.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        const source = inputAudioContext.current!.createMediaStreamSource(stream);
                        scriptProcessor.current = inputAudioContext.current!.createScriptProcessor(4096, 1, 1);
                        
                        scriptProcessor.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromise.current?.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        
                        source.connect(scriptProcessor.current);
                        scriptProcessor.current.connect(inputAudioContext.current!.destination);
                        
                        setIsLive(true);
                        setIsConnecting(false);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.outputTranscription) {
                            currentOutputTranscription.current += message.serverContent.outputTranscription.text;
                        } else if (message.serverContent?.inputTranscription) {
                            currentInputTranscription.current += message.serverContent.inputTranscription.text;
                        }

                        onTranscriptUpdateRef.current({
                            userInput: currentInputTranscription.current,
                            modelOutput: currentOutputTranscription.current,
                            isTurnComplete: false,
                        });

                        if (message.serverContent?.turnComplete) {
                            onTranscriptUpdateRef.current({
                                userInput: currentInputTranscription.current,
                                modelOutput: currentOutputTranscription.current,
                                isTurnComplete: true,
                            });
                            currentInputTranscription.current = '';
                            currentOutputTranscription.current = '';
                        }
                        
                        // ROBUSTNESS: Safe navigation with explicit checks
                        const parts = message.serverContent?.modelTurn?.parts;
                        const base64EncodedAudioString = parts?.[0]?.inlineData?.data;
                        if (base64EncodedAudioString && outputAudioContext.current) {
                            nextStartTime.current = Math.max(nextStartTime.current, outputAudioContext.current.currentTime);
                            const audioBuffer = await decodeAudioData(
                                decode(base64EncodedAudioString),
                                outputAudioContext.current,
                                24000, 1
                            );
                            const sourceNode = outputAudioContext.current.createBufferSource();
                            sourceNode.buffer = audioBuffer;
                            sourceNode.connect(outputNode.current!);
                            sourceNode.addEventListener('ended', () => {
                                sources.current.delete(sourceNode);
                            });

                            sourceNode.start(nextStartTime.current);
                            nextStartTime.current += audioBuffer.duration;
                            sources.current.add(sourceNode);
                        }

                        if (message.serverContent?.interrupted) {
                            for (const sourceNode of sources.current.values()) {
                                sourceNode.stop();
                                sources.current.delete(sourceNode);
                            }
                            nextStartTime.current = 0;
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Live session error:', e);
                        closeSession();
                    },
                    onclose: (e: CloseEvent) => {
                        closeSession();
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
                    },
                    systemInstruction: 'You are Oracle, a friendly and helpful AI orchestrator for the AI CFO Suite.',
                },
            });
        } catch (error) {
            console.error("Failed to start live session:", error);
            setIsConnecting(false);
        }
    }, [closeSession]); // Stable: depends only on stable `closeSession`

    return { startSession, closeSession, isLive, isConnecting };
};
