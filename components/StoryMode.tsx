/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { X, Sparkles, User, FileText, Play, Download, Loader2, Square, Wand2, ChevronRight, Check, Volume2, Pause, ChevronDown, AlertTriangle, Bug, Zap, ShieldCheck, Timer, Lock, Unlock } from 'lucide-react';
import { Voice, StoryAnalysis, ScriptSegment, CharacterProfile } from '../types';
import { decodeBase64, decodeAudioData, concatenateAudioBuffers, bufferToWav } from '../utils/audioUtils';
import AudioVisualizer from './AudioVisualizer';
import { SessionLogger } from '../utils/logger';
import { keyManager, KeyState } from '../utils/keyManager';

interface StoryModeProps {
  voices: Voice[];
  onClose: () => void;
}

type Step = 'input' | 'analyzing' | 'casting' | 'generating' | 'complete';

const StoryMode: React.FC<StoryModeProps> = ({ voices, onClose }) => {
  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [analysis, setAnalysis] = useState<StoryAnalysis | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({}); 
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Initializing...");
  const [isLowQuotaMode, setIsLowQuotaMode] = useState(false);
  const [generatedAudioBlob, setGeneratedAudioBlob] = useState<Blob | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Debug State
  const [keyStates, setKeyStates] = useState<KeyState[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  // Audio Playback State for Previews
  const [playingSample, setPlayingSample] = useState<string | null>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const loggerRef = useRef<SessionLogger | null>(null);
  
  const modalRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);

  // Lifecycle: Mount / Unmount Only
  useEffect(() => {
    modalRef.current?.focus();
    isMountedRef.current = true;
    loggerRef.current = new SessionLogger();
    
    // Initial Key State Load
    setKeyStates(keyManager.getKeyStates());

    return () => {
      isMountedRef.current = false;
      
      // Safe cleanup of audio resources
      if (sourceNodeRef.current) {
          try { sourceNodeRef.current.stop(); } catch(e) {}
      }
      
      const ctx = audioContextRef.current;
      if (ctx && ctx.state !== 'closed') {
          ctx.close().catch(e => console.warn("Error closing AudioContext:", e));
      }
      
      if (sampleAudioRef.current) {
        sampleAudioRef.current.pause();
        sampleAudioRef.current = null;
      }
    };
  }, []);

  // Lifecycle: Debug Polling (Runs when dependency changes)
  useEffect(() => {
    const interval = setInterval(() => {
       if (showDebug || step === 'generating') {
           setKeyStates(keyManager.getKeyStates());
       }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [showDebug, step]);

  // Smart Casting Logic
  const performSmartCasting = (analysisData: StoryAnalysis) => {
    if (!loggerRef.current) loggerRef.current = new SessionLogger();
    const logger = loggerRef.current;
    
    logger.startTimer('smart-casting');
    const newAssignments: Record<string, string> = {};
    const scoringDetails: any[] = [];
    
    // 1. Cast Narrator (Fixed role)
    const narratorVoice = voices.find(v => v.name === 'Puck') || voices[0];
    newAssignments['Narrator'] = narratorVoice.name;

    // 2. Cast Characters
    const usedVoices = new Set<string>();
    usedVoices.add(narratorVoice.name);

    analysisData.characters.forEach(char => {
       if (char.name === 'Narrator') return;

       const scoredVoices = voices.map(voice => {
          let score = 0;
          const logFactors: string[] = [];

          // Gender Match
          const charGender = char.gender?.toLowerCase() || 'unknown';
          const voiceGender = voice.analysis.gender.toLowerCase();
          
          if (charGender !== 'unknown' && charGender !== 'n/a') {
             if (charGender.includes('female') && voiceGender === 'male') { score -= 100; }
             else if (charGender.includes('male') && voiceGender === 'female') { score -= 100; }
             else if (charGender === voiceGender) { score += 20; }
          }

          // Description Match
          const desc = (char.description || "").toLowerCase();
          const characteristics = voice.analysis.characteristics.map(c => c.toLowerCase());
          const pitch = voice.analysis.pitch.toLowerCase();

          if (desc.includes('old') || desc.includes('elderly')) {
             if (characteristics.includes('mature') || characteristics.includes('deep')) score += 10;
          } else if (desc.includes('young') || desc.includes('child')) {
             if (characteristics.includes('youthful')) score += 10;
             if (pitch.includes('high')) score += 5;
          }

          if (usedVoices.has(voice.name)) score -= 5;
          score += Math.random();

          return { voice, score, logFactors };
       });

       scoredVoices.sort((a, b) => b.score - a.score);
       const bestMatch = scoredVoices[0].voice;
       
       newAssignments[char.name] = bestMatch.name;
       usedVoices.add(bestMatch.name);
    });

    setAssignments(newAssignments);
    logger.endTimer('smart-casting', 'CASTING');
  };

  const handlePlaySample = (voiceName: string) => {
    const voice = voices.find(v => v.name === voiceName);
    if (!voice) return;

    if (playingSample === voiceName) {
      sampleAudioRef.current?.pause();
      setPlayingSample(null);
    } else {
      if (sampleAudioRef.current) sampleAudioRef.current.pause();
      const audio = new Audio(voice.audioSampleUrl);
      sampleAudioRef.current = audio;
      audio.onended = () => setPlayingSample(null);
      audio.play().catch(console.error);
      setPlayingSample(voiceName);
    }
  };

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setStep('analyzing');
    
    if (!loggerRef.current) loggerRef.current = new SessionLogger();
    const logger = loggerRef.current;
    
    // For analysis, just grab a working key.
    const apiKey = keyManager.getWorkingKey();

    logger.log('ANALYSIS', 'INFO', 'Starting text analysis', { textLength: text.length });

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `
        You are a casting director for an audio drama.
        Analyze the following novel chapter.
        
        Tasks:
        1. Identify the 'Narrator' and all distinct characters who speak.
        2. Create a character profile for each.
        3. Break the text down into a sequential script.
        
        Rules:
        - "Narrator" must be included.
        - CRITICAL: Always use the exact English name "Narrator" for the narration role.
        - For Narrator lines, text should include descriptions and actions.
        - For Character lines, text should be ONLY the spoken dialogue.
        
        Input Text:
        """
        ${text.substring(0, 25000)} 
        """
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              characters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    gender: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ['name', 'gender', 'description']
                }
              },
              script: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                  required: ['speaker', 'text']
                }
              }
            }
          }
        }
      });
      
      const result = JSON.parse(response.text || '{}') as StoryAnalysis;
      
      const NARRATOR_ALIASES = ['narrator', 'рассказчик', 'narrateur', 'erzähler', 'narrador'];
      
      result.script.forEach(segment => {
         if (NARRATOR_ALIASES.includes(segment.speaker.toLowerCase())) {
            segment.speaker = 'Narrator';
         }
      });

      const activeSpeakers = new Set(result.script.map(s => s.speaker));
      
      let characters = result.characters || [];
      characters = characters.filter(c => {
         if (c.name === 'Narrator') return activeSpeakers.has('Narrator'); 
         return activeSpeakers.has(c.name);
      });

      activeSpeakers.forEach(speaker => {
          if (!characters.find(c => c.name === speaker)) {
              characters.push({ 
                  name: speaker, 
                  gender: 'Neutral', 
                  description: 'Identified speaker' 
              });
          }
      });
      
      if (activeSpeakers.has('Narrator') && !characters.find(c => c.name === 'Narrator')) {
         characters.unshift({ name: 'Narrator', gender: 'Neutral', description: 'Story narrator' });
      }

      result.characters = characters;

      logger.log('ANALYSIS', 'INFO', 'Analysis result parsed', { 
        characterCount: result.characters.length, 
        scriptSegments: result.script.length 
      });

      setAnalysis(result);
      performSmartCasting(result);
      setStep('casting');

    } catch (e: any) {
      logger.log('ANALYSIS', 'ERROR', 'Analysis failed', { error: e.message });
      console.error(e);
      setStep('input'); 
      alert("Failed to analyze text. Please try again.");
    }
  };

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const optimizeScript = (script: ScriptSegment[]) => {
    const optimized: ScriptSegment[] = [];
    if (script.length === 0) return optimized;

    let current = { ...script[0] };
    const MAX_CHAR_LIMIT = 800; 

    for (let i = 1; i < script.length; i++) {
      const next = script[i];
      if (next.speaker === current.speaker && (current.text.length + next.text.length) < MAX_CHAR_LIMIT) {
        current.text += " " + next.text;
      } else {
        optimized.push(current);
        current = { ...next };
      }
    }
    optimized.push(current);
    return optimized;
  };

  const handleGenerate = async () => {
    if (!analysis) return;
    setStep('generating');
    setProgress(0);
    setIsLowQuotaMode(false);
    setStatusMessage("Optimizing script...");
    setShowDebug(true); // Auto-show debug on generation

    const logger = loggerRef.current!;

    // Clean up previous context if it exists (for regenerations)
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try { await audioContextRef.current.close(); } catch(e) {}
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    audioContextRef.current = audioContext;

    const optimizedScript = optimizeScript(analysis.script);
    const orderedBuffers: AudioBuffer[] = new Array(optimizedScript.length).fill(null);
    
    const MAX_RETRIES = 5;
    
    logger.startTimer('total-generation');

    try {
      let completedCount = 0;
      


      // Queue-based Generation Loop
      const queue = optimizedScript.map((segment, index) => ({ segment, index }));
      let completedCount = 0;
      let activeWorkers = 0;
      
      // Dynamic concurrency based on key availability
      const MAX_CONCURRENCY = Math.min(3, keyManager.activeKeyCount * 2); 

      const processQueue = async () => {
          if (!isMountedRef.current) return;
          
          while (queue.length > 0) {
              // 1. Check if we can start a new worker
              if (activeWorkers >= MAX_CONCURRENCY) {
                  await delay(200);
                  continue;
              }

              // 2. Try to reserve a key
              const key = keyManager.reserveKey();
              if (!key) {
                  setStatusMessage("Rate limit reached. Waiting for available key...");
                  await delay(2000); // Wait for cooldown
                  continue;
              }

              // 3. Take job
              const job = queue.shift();
              if (!job) break;

              activeWorkers++;
              
              // Process in background (don't await here to allow concurrency)
              processItem(job, key).finally(() => {
                  activeWorkers--;
              });
          }

          // Wait for stragglers
          while (activeWorkers > 0) {
              await delay(500);
          }
      };

      const processItem = async (job: { segment: ScriptSegment, index: number }, apiKey: string) => {
          if (!isMountedRef.current) return;
          const { segment, index } = job;
          const assignedVoice = assignments[segment.speaker] || assignments['Narrator'] || voices[0].name;
          const segmentTimerKey = `segment-${index}`;

          try {
             const localAi = new GoogleGenAI({ apiKey });
             logger.startTimer(segmentTimerKey);

             const response = await localAi.models.generateContent({
                model: "gemini-2.0-flash-exp", // Updated to latest flash model for speed
                contents: { parts: [{ text: segment.text }] },
                config: {
                  responseModalities: [Modality.AUDIO],
                  speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: assignedVoice } },
                  },
                },
             });

             const latency = logger.endTimer(segmentTimerKey, 'API_LATENCY');
             const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
             
             if (audioData) {
                const rawBytes = decodeBase64(audioData);
                const buffer = await decodeAudioData(rawBytes, audioContext, 24000);
                const pauseBuffer = audioContext.createBuffer(1, 24000 * 0.25, 24000);
                const combined = concatenateAudioBuffers(audioContext, [buffer, pauseBuffer]);
                
                orderedBuffers[index] = combined;
                completedCount++;
                setProgress(Math.round((completedCount / optimizedScript.length) * 100));
                setStatusMessage(`Processing segment ${completedCount}/${optimizedScript.length}`);
             } else {
                throw new Error("No audio data returned");
             }

          } catch (err: any) {
             const isRateLimit = err.status === 429 || err.message?.includes('429');
             
             if (isRateLimit) {
                 logger.log('GENERATION', 'WARN', `429 Hit on key ending ...${apiKey.slice(-4)}`);
                 keyManager.jailCurrentKey(60000); // Jail the specific key if possible, currently jails current
                 // Re-queue the job
                 queue.unshift(job);
             } else {
                 console.error(`Failed segment ${index}`, err);
                 // Don't re-queue fatal errors, just skip
             }
          }
      };

      await processQueue();

      if (!isMountedRef.current) return;

      const totalTime = logger.endTimer('total-generation', 'PERF');
      setStatusMessage("Stitching final audio track...");
      
      const validBuffers = orderedBuffers.filter(b => b !== null) as AudioBuffer[];
      
      if (validBuffers.length === 0) {
          throw new Error("No audio generated");
      }

      const finalBuffer = concatenateAudioBuffers(audioContext, validBuffers);
      audioBufferRef.current = finalBuffer;

      const wavBlob = bufferToWav(finalBuffer);
      setGeneratedAudioBlob(wavBlob);
      
      logger.log('COMPLETION', 'METRIC', 'Generation Summary', {
          totalDurationMs: totalTime.toFixed(0),
          finalAudioDuration: finalBuffer.duration.toFixed(2),
          keyCount: keyManager.activeKeyCount
      });

      setStep('complete');

    } catch (e: any) {
      console.error(e);
      if (isMountedRef.current) {
         alert(`Generation failed: ${e.message}`);
         setStep('casting');
      }
    }
  };

  const togglePlayback = () => {
    if (!audioContextRef.current || !audioBufferRef.current) return;

    if (isPlaying) {
      sourceNodeRef.current?.stop();
      setIsPlaying(false);
    } else {
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBufferRef.current;
      source.connect(audioContextRef.current.destination);
      source.onended = () => setIsPlaying(false);
      sourceNodeRef.current = source;
      source.start();
      setIsPlaying(true);
    }
  };

  const downloadAudio = () => {
    if (!generatedAudioBlob) return;
    const url = URL.createObjectURL(generatedAudioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'story-audio.wav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div 
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
    >
      <div className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}></div>
      
      <div className="relative w-full max-w-4xl bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden animate-slide-up flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-white dark:bg-zinc-900 z-10">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                <FileText size={20} className="text-indigo-600 dark:text-indigo-400" />
             </div>
             <div>
               <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Story to Speech</h2>
               <div className="flex items-center gap-2">
                 <p className="text-xs text-zinc-500 dark:text-zinc-400">Convert novel chapters into an audio drama</p>
                 {keyStates.length > 0 && (
                     <button 
                        onClick={() => setShowDebug(!showDebug)}
                        className="flex items-center gap-1 text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded hover:bg-zinc-200"
                     >
                         <Bug size={10} /> {showDebug ? 'Hide Debug' : 'Debug Keys'}
                     </button>
                 )}
               </div>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} className="text-zinc-500" />
          </button>
        </div>

        {/* Debug Panel */}
        {showDebug && (
            <div className="bg-zinc-100 dark:bg-black p-2 border-b border-zinc-200 dark:border-zinc-800 flex gap-2 overflow-x-auto text-[10px] font-mono">
                {keyStates.map((k, i) => (
                    <div key={i} className={`flex items-center gap-1 px-2 py-1 rounded border ${k.isJailed ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400' : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-600 dark:text-green-400'}`}>
                        {k.isJailed ? <Lock size={8} /> : <Unlock size={8} />}
                        <span>{k.key}</span>
                        {k.isJailed && <span className="font-bold">({k.remainingCooldown}s)</span>}
                    </div>
                ))}
            </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-zinc-50/50 dark:bg-zinc-900/50">
          
          {step === 'input' && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Paste your story chapter below. Gemini will analyze the text, identify characters, and automatically recommend the best voices for each role.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste your story text here... (Narrator lines and dialogues will be separated automatically)"
                className="w-full h-96 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-indigo-500 outline-none text-zinc-900 dark:text-zinc-100 resize-none font-serif leading-relaxed"
              />
              <div className="flex justify-end">
                <button
                  onClick={handleAnalyze}
                  disabled={!text.trim()}
                  className="bg-zinc-900 dark:bg-indigo-600 text-white px-6 py-2.5 rounded-full font-medium text-sm flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transform active:scale-95 duration-200"
                >
                  <Sparkles size={16} />
                  Analyze & Auto-Cast
                </button>
              </div>
            </div>
          )}

          {step === 'analyzing' && (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <Loader2 size={40} className="animate-spin text-indigo-600 dark:text-indigo-400" />
              <div className="text-center">
                <h3 className="font-medium text-zinc-900 dark:text-white">Analyzing Story Structure...</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Identifying characters, gender, and context for voice matching</p>
              </div>
            </div>
          )}

          {step === 'casting' && analysis && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Character List */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                     <h3 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                        <User size={18} /> Cast Your Characters
                     </h3>
                     <button 
                        onClick={() => performSmartCasting(analysis)}
                        className="text-xs flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-medium"
                     >
                        <Sparkles size={12} /> Recalculate Matches
                     </button>
                  </div>
                  
                  <div className="space-y-3">
                    {analysis.characters.map((char) => (
                      <div key={char.name} className={`p-4 rounded-xl border shadow-sm flex flex-col gap-3 transition-colors ${char.name === 'Narrator' ? 'bg-indigo-50/50 dark:bg-indigo-900/10 border-indigo-100 dark:border-indigo-800/30' : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700'}`}>
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <div className="font-bold text-zinc-900 dark:text-white truncate">{char.name}</div>
                                    {char.name === 'Narrator' && <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-100 text-indigo-700 font-bold uppercase tracking-wider">Host</span>}
                                </div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-1 italic">{char.description}</div>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-2 w-full">
                            <div className="flex-1 relative">
                                <select
                                    value={assignments[char.name] || ''}
                                    onChange={(e) => setAssignments({ ...assignments, [char.name]: e.target.value })}
                                    className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm pl-3 pr-8 py-2 focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
                                >
                                    {voices.map(v => (
                                    <option key={v.name} value={v.name}>{v.name} — {v.analysis.gender}, {v.analysis.pitch}</option>
                                    ))}
                                </select>
                                <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-zinc-400">
                                    <ChevronDown size={14} />
                                </div>
                            </div>
                            
                            {/* Preview Button */}
                            {assignments[char.name] && (
                                <button
                                    onClick={() => handlePlaySample(assignments[char.name])}
                                    className={`p-2 rounded-lg border transition-all shrink-0 ${
                                        playingSample === assignments[char.name] 
                                        ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400' 
                                        : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                                    }`}
                                    title="Preview Voice"
                                >
                                    {playingSample === assignments[char.name] ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                                </button>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Script Preview */}
                <div className="space-y-4 h-full flex flex-col">
                  <h3 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                    <FileText size={18} /> Script Preview
                  </h3>
                  <div className="flex-1 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 overflow-y-auto max-h-[500px] text-sm space-y-4 custom-scrollbar">
                     {analysis.script.slice(0, 30).map((line, idx) => (
                        <div key={idx} className="flex gap-4 group">
                           <div className="shrink-0 w-24 pt-1">
                                <div className={`text-xs font-bold uppercase tracking-wider truncate ${line.speaker === 'Narrator' ? 'text-zinc-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
                                    {line.speaker}
                                </div>
                                <div className="text-[10px] text-zinc-400 dark:text-zinc-600 truncate">
                                    {assignments[line.speaker]}
                                </div>
                           </div>
                           <div className={`flex-1 font-serif leading-relaxed ${line.speaker === 'Narrator' ? 'text-zinc-500 dark:text-zinc-400 italic' : 'text-zinc-800 dark:text-zinc-200'}`}>
                              {line.text}
                           </div>
                        </div>
                     ))}
                     {analysis.script.length > 30 && (
                        <div className="text-center text-xs text-zinc-400 italic pt-2">
                           ...and {analysis.script.length - 30} more lines
                        </div>
                     )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  onClick={handleGenerate}
                  className="bg-zinc-900 dark:bg-indigo-600 text-white px-8 py-3 rounded-full font-medium text-sm flex items-center gap-2 hover:shadow-lg hover:scale-105 active:scale-95 transition-all"
                >
                  <Wand2 size={18} />
                  Generate Audio Drama
                </button>
              </div>
            </div>
          )}

          {step === 'generating' && (
            <div className="flex flex-col items-center justify-center h-64 space-y-6 max-w-md mx-auto">
              <div className="relative w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                <div 
                  className="absolute inset-y-0 left-0 bg-indigo-600 dark:bg-indigo-500 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <div className="text-center space-y-1">
                <h3 className="font-bold text-2xl text-zinc-900 dark:text-white">{progress}%</h3>
                <p className="text-zinc-500 dark:text-zinc-400 animate-pulse">{statusMessage}</p>
                <div className="flex flex-col items-center justify-center gap-2 pt-2">
                    {statusMessage.includes("Rate limit") && (
                        <span className="flex items-center gap-1 text-xs text-yellow-500 font-medium">
                            <AlertTriangle size={12} /> API Limit Reached - Switching Keys
                        </span>
                    )}
                    {isLowQuotaMode && (
                        <span className="flex items-center gap-1 text-xs text-indigo-500 font-medium bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded-full">
                            <Zap size={10} /> Safe Mode Active (Reduced Speed)
                        </span>
                    )}
                </div>
              </div>
            </div>
          )}

          {step === 'complete' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-8 animate-fade-in">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mb-2">
                 <Check size={40} />
              </div>
              
              <div className="text-center">
                 <h3 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">Your Story is Ready!</h3>
                 <p className="text-zinc-500 dark:text-zinc-400">Successfully compiled audio drama.</p>
              </div>

              {/* Player */}
              <div 
                  className="w-full max-w-md h-32 bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden relative group cursor-pointer"
                  onClick={togglePlayback}
              >
                 <div className="absolute inset-0 flex items-center justify-center opacity-10">
                     <AudioVisualizer isPlaying={isPlaying} color={document.documentElement.classList.contains('dark') ? '#a5b4fc' : '#18181b'} />
                 </div>
                 <div className="absolute inset-0 flex items-center justify-center z-10">
                    {isPlaying ? <Square size={32} className="fill-zinc-900 dark:fill-white" /> : <Play size={32} className="fill-zinc-900 dark:fill-white" />}
                 </div>
              </div>

              <div className="flex gap-4 items-center">
                 <button 
                    onClick={() => setStep('casting')}
                    className="px-6 py-2.5 rounded-full border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors font-medium text-sm"
                 >
                    Adjust Voices
                 </button>
                 <button 
                    onClick={downloadAudio}
                    className="bg-zinc-900 dark:bg-indigo-600 text-white px-6 py-2.5 rounded-full font-medium text-sm flex items-center gap-2 hover:shadow-lg transition-all"
                 >
                    <Download size={18} />
                    Download WAV
                 </button>
                 
                 {/* Debug Log Download */}
                 <button 
                    onClick={() => loggerRef.current?.download()}
                    className="p-2.5 rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    title="Download Diagnostic Logs"
                 >
                     <Bug size={18} />
                 </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StoryMode;