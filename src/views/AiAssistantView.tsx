import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Loader2,
  Mic,
  MicOff,
  Radio,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AssistantMessage,
  DataMode,
  FullAnalysisBundle,
  GeoRegion,
} from '../types/aethryx';

interface AiAssistantViewProps {
  activeRegion: GeoRegion;
  activeAnalysis: FullAnalysisBundle | null;
  dataMode: DataMode;
  geminiStatus: { configured: boolean; status: string; model: string };
  messages: AssistantMessage[];
  conversationId?: string;
  onUpdateMessages: (msgs: AssistantMessage[], convId?: string) => void;
  onSelectRegion: (region: GeoRegion) => void;
  onAnalysisComplete: (bundle: FullAnalysisBundle) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function pickDefaultMaleEnglishVoice(voices: SpeechSynthesisVoice[]): string {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const maleHints = ['daniel', 'david', 'guy', 'alex', 'male', 'ryan', 'george', 'arthur', 'oliver', 'mark'];
  const preferred = en.find((v) => maleHints.some((h) => v.name.toLowerCase().includes(h)));
  return preferred?.voiceURI || en[0]?.voiceURI || voices[0]?.voiceURI || '';
}

function parseVoiceAnalysisCommand(text: string): {
  isCommand: boolean;
  variable?: string;
  locationQuery?: string;
} {
  const cleaned = text.replace(/^(hey\s+)?aethryx[,:\s]*/i, '').trim();
  const match = cleaned.match(
    /^(?:analy[sz]e|investigate|check|show|get|run)\s+(.+?)\s+(?:trends?\s+)?(?:in|for|at|over)\s+(.+)$/i
  );
  if (!match) return { isCommand: false };

  const varPhrase = match[1].toLowerCase();
  const loc = match[2].replace(/[.?!]+$/, '').trim();
  let variable = 'T2M';
  if (varPhrase.includes('rain') || varPhrase.includes('precip')) variable = 'PRECTOTCORR';
  else if (varPhrase.includes('humid')) variable = 'RH2M';
  else if (varPhrase.includes('wind')) variable = 'WS2M';
  else if (varPhrase.includes('soil')) variable = 'GWETTOP';
  else if (varPhrase.includes('solar') || varPhrase.includes('irrad')) variable = 'ALLSKY_SFC_SW_DWN';
  else if (varPhrase.includes('skin')) variable = 'TS';
  else if (varPhrase.includes('press')) variable = 'PS';

  return { isCommand: true, variable, locationQuery: loc };
}

export function AiAssistantView({
  activeRegion,
  activeAnalysis,
  dataMode,
  geminiStatus,
  messages,
  conversationId,
  onUpdateMessages,
  onSelectRegion,
  onAnalysisComplete,
}: AiAssistantViewProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState('');
  const [autoSpeak, setAutoSpeak] = useState(true);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const speechSupported = Boolean(getSpeechCtor());
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    if (!ttsSupported) return;
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
      if (list.length > 0 && !selectedVoiceUri) {
        setSelectedVoiceUri(pickDefaultMaleEnglishVoice(list));
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [ttsSupported, selectedVoiceUri]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  function speakText(text: string) {
    if (!ttsSupported || !autoSpeak) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text.replace(/[*#`]/g, '').slice(0, 750));
    const chosen = voices.find((v) => v.voiceURI === selectedVoiceUri);
    if (chosen) utter.voice = chosen;
    utter.rate = 1.02;
    utter.pitch = 0.95;
    window.speechSynthesis.speak(utter);
  }

  async function submitPrompt(rawText: string) {
    const trimmed = rawText.trim();
    if (!trimmed || sending) return;

    const userMsg: AssistantMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    const nextHistory = [...messages, userMsg];
    onUpdateMessages(nextHistory, conversationId);
    setInput('');
    setSending(true);

    try {
      // Check if user issued a direct regional investigation voice/text command
      const cmd = parseVoiceAnalysisCommand(trimmed);
      let latestBundle = activeAnalysis;

      if (cmd.isCommand && cmd.locationQuery && cmd.variable) {
        const searchRes = await fetch(`/api/regions/search?q=${encodeURIComponent(cmd.locationQuery)}`);
        const searchData = await searchRes.json();
        const resolvedRegion: GeoRegion | undefined = searchData.regions?.[0];

        if (resolvedRegion) {
          onSelectRegion(resolvedRegion);
          const ackMsg: AssistantMessage = {
            id: `ack-${Date.now()}`,
            role: 'assistant',
            content: `Retrieving ${dataMode} NASA POWER observations (${cmd.variable}) for ${resolvedRegion.name} (${resolvedRegion.lat.toFixed(
              2
            )}°, ${resolvedRegion.lon.toFixed(2)}°) and computing Mann-Kendall and Sen's slope statistics...`,
            timestamp: new Date().toISOString(),
            actionTriggered: {
              type: 'RUN_ANALYSIS',
              summary: `Started ${cmd.variable} investigation for ${resolvedRegion.name}`,
            },
          };
          onUpdateMessages([...nextHistory, ackMsg], conversationId);

          const analysisRes = await fetch('/api/analysis/full', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              datasetId: 'NASA-POWER',
              variable: cmd.variable,
              region: resolvedRegion,
              startDate: '2001-01-01',
              endDate: new Date().toISOString().slice(0, 10),
              aggregation: 'monthly',
              dataMode,
              saveToHistory: true,
            }),
          });
          const analysisJson = await analysisRes.json();
          if (analysisRes.ok && analysisJson.analysis) {
            latestBundle = analysisJson.analysis;
            onAnalysisComplete(analysisJson.analysis);
          }
        }
      }

      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          history: nextHistory.map((m) => ({ role: m.role, content: m.content })),
          analysis: latestBundle,
          conversationId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Assistant error');

      const assistantMsg: AssistantMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: json.answer,
        timestamp: new Date().toISOString(),
        mode: json.mode,
        citedDataset: json.citedDataset,
      };
      onUpdateMessages([...nextHistory, assistantMsg], json.conversationId || conversationId);
      speakText(json.answer);
    } catch (err) {
      const errMsg: AssistantMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Unable to complete request: ${err instanceof Error ? err.message : 'Network error'}`,
        timestamp: new Date().toISOString(),
      };
      onUpdateMessages([...nextHistory, errMsg], conversationId);
    } finally {
      setSending(false);
    }
  }

  function startListening(continuousWake = false) {
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      setVoiceError('Web Speech API is not supported in this browser; use the text input fallback below.');
      return;
    }
    setVoiceError(null);
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = continuousWake;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let finalStr = '';
      let interimStr = '';
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalStr += res[0].transcript;
        else interimStr += res[0].transcript;
      }
      setInterimText(interimStr);
      if (finalStr.trim()) {
        setInterimText('');
        if (continuousWake) {
          if (/aethryx/i.test(finalStr)) {
            submitPrompt(finalStr);
          }
        } else {
          submitPrompt(finalStr);
          rec.stop();
        }
      }
    };

    rec.onerror = (e) => {
      setVoiceError(`Microphone error: ${e.error}`);
      setListening(false);
      setWakeWordEnabled(false);
    };

    rec.onend = () => {
      setListening(false);
      setInterimText('');
    };

    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
    setWakeWordEnabled(false);
    setInterimText('');
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    submitPrompt(input);
  }

  const starterPrompts = [
    `What is happening to ${activeAnalysis ? activeAnalysis.provenance.variableName : 'temperature'} in ${activeRegion.name.split(',')[0]}?`,
    'Explain the Mann-Kendall result and Sen’s slope.',
    'Which NASA dataset is suitable for soil moisture analysis?',
    `AETHRYX, analyse rainfall trends in ${activeRegion.name.split(',')[0]}`,
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-full">
      {/* Left Voice Control & Grounding Panel */}
      <div className="lg:col-span-4 space-y-4">
        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-mono text-cyan-400">VOICE-FIRST INTERFACE</div>
              <h2 className="text-sm font-semibold text-slate-100">AETHRYX Voice Console</h2>
            </div>
            <Sparkles className="w-4 h-4 text-cyan-400" />
          </div>

          {/* Push to Talk */}
          <div className="flex flex-col items-center justify-center py-4 bg-[#07090E] border border-slate-800 rounded space-y-3">
            <button
              type="button"
              onClick={() => (listening ? stopListening() : startListening(false))}
              className={`w-16 h-16 rounded-full flex items-center justify-center border transition-all ${
                listening
                  ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-[0_0_24px_rgba(6,182,212,0.45)]'
                  : 'bg-[#0D131F] text-cyan-400 border-cyan-500/40 hover:border-cyan-400'
              }`}
              aria-label={listening ? 'Stop listening' : 'Start voice command'}
            >
              {listening ? <Mic className="w-7 h-7 animate-pulse" /> : <MicOff className="w-7 h-7" />}
            </button>

            <div className="text-xs font-mono text-slate-300">
              {listening
                ? wakeWordEnabled
                  ? 'Listening for wake phrase "AETHRYX"...'
                  : 'Listening — speak your Earth science query'
                : speechSupported
                  ? 'Push to talk ready'
                  : 'SpeechRecognition unsupported in this browser'}
            </div>

            {interimText && (
              <div className="text-[11px] text-cyan-300 px-3 text-center italic">"{interimText}"</div>
            )}
          </div>

          {speechSupported && (
            <button
              type="button"
              onClick={() => {
                if (wakeWordEnabled) {
                  stopListening();
                } else {
                  setWakeWordEnabled(true);
                  startListening(true);
                }
              }}
              className={`w-full py-2 px-3 rounded border text-xs font-medium inline-flex items-center justify-center gap-2 transition-colors ${
                wakeWordEnabled
                  ? 'bg-cyan-500/20 border-cyan-500 text-cyan-200'
                  : 'bg-[#07090E] border-slate-700 text-slate-300 hover:border-slate-600'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>{wakeWordEnabled ? 'Disable "AETHRYX" Wake Listener' : 'Enable "AETHRYX" Wake Phrase'}</span>
            </button>
          )}

          {voiceError && (
            <div className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-500/40 rounded p-2.5">
              {voiceError}
            </div>
          )}

          {/* TTS Voice Selection */}
          <div className="pt-2 border-t border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Voice Response Playback</span>
              <button
                type="button"
                onClick={() => {
                  if (ttsSupported) window.speechSynthesis.cancel();
                  setAutoSpeak((v) => !v);
                }}
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
              >
                {autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span>{autoSpeak ? 'Enabled' : 'Muted'}</span>
              </button>
            </div>

            {ttsSupported && voices.length > 0 && (
              <select
                value={selectedVoiceUri}
                onChange={(e) => setSelectedVoiceUri(e.target.value)}
                aria-label="Select TTS Voice"
                className="w-full bg-[#07090E] border border-slate-700 rounded px-2.5 py-1.5 text-[11px] text-slate-200"
              >
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div>
              AI Engine:{' '}
              <span className="font-mono text-slate-200">
                {geminiStatus.configured ? `${geminiStatus.model} (Live)` : 'Grounded Scientific Fallback'}
              </span>
            </div>
            <div>
              Grounded Context:{' '}
              <span className="text-slate-200">
                {activeAnalysis
                  ? `${activeAnalysis.region.name} · ${activeAnalysis.provenance.variable} (${activeAnalysis.provenance.dataMode})`
                  : 'No regional analysis loaded'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Chat Stream */}
      <div className="lg:col-span-8 bg-[#0D131F] border border-slate-800 rounded flex flex-col min-h-[540px] max-h-[700px]">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-100">
              AETHRYX JARVIS — Your Earth Intelligence Assistant
            </div>
            <div className="text-[11px] text-slate-400">
              Evidence-grounded answers citing actual NASA observations, statistics, and limitations
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-4 py-6">
              <div className="text-xs text-slate-300 bg-[#07090E] border border-slate-800 rounded p-4">
                Ask about regional climate trends, Mann-Kendall significance, NASA dataset selection, or speak a
                command such as <span className="font-mono text-cyan-300">"AETHRYX, analyse rainfall trends in Shivamogga"</span>.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {starterPrompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => submitPrompt(p)}
                    className="text-left text-xs text-slate-300 bg-[#07090E] border border-slate-800 hover:border-cyan-500/50 rounded p-3 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-cyan-500/15 border border-cyan-500/40 text-slate-100'
                      : 'bg-[#07090E] border border-slate-800 text-slate-200'
                  }`}
                >
                  {m.content}
                  {m.citedDataset && (
                    <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-cyan-400">
                      Source Grounding: {m.citedDataset} · {m.mode}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Evaluating scientific telemetry...</span>
            </div>
          )}
        </div>

        <form onSubmit={handleFormSubmit} className="p-3 border-t border-slate-800 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask AETHRYX about trends, statistics, datasets, or issue a regional analysis command..."
            className="flex-1 bg-[#07090E] border border-slate-700 rounded px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="px-4 py-2 bg-cyan-500 text-slate-950 font-semibold text-xs rounded hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
}
