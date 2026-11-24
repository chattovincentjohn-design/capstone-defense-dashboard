"use client";
import * as React from "react";
import { Mic, MicOff, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
export { appendDictation } from "@/lib/dictation";

/* Minimal typings for the browser Web Speech API (Chrome/Edge expose it as webkitSpeechRecognition). */
interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const DICTATION_LANGUAGES = [
  { code: "en-PH", label: "English" },
  { code: "fil-PH", label: "Filipino" },
] as const;

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow the microphone for this site (lock icon in the address bar) and try again.",
  "service-not-allowed": "Microphone access was blocked. Allow the microphone for this site and try again.",
  "no-speech": "No speech was heard. Click the microphone and speak again.",
  "audio-capture": "No microphone was found. Check that one is connected.",
  network: "Voice input needs an internet connection. Check your connection and try again.",
  "language-not-supported": "This browser cannot recognise the chosen language yet. Choose Filipino or English, or type the comment.",
};


/**
 * Microphone button that dictates into a text field: finished phrases are added to the
 * text through `onText`; what is still being heard is shown live under the button.
 */
export function DictationButton({ onText, disabled = false }: { onText: (spoken: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = React.useState<boolean | null>(null);
  const [listening, setListening] = React.useState(false);
  const [interim, setInterim] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [lang, setLang] = React.useState<string>(() => {
    try {
      const saved = localStorage.getItem("cdems-dictation-lang");
      return DICTATION_LANGUAGES.some((l) => l.code === saved) ? saved! : "en-PH";
    } catch { return "en-PH"; }
  });
  const rec = React.useRef<Recognition | null>(null);
  const onTextRef = React.useRef(onText);
  onTextRef.current = onText;

  React.useEffect(() => { setSupported(!!recognitionCtor()); }, []);
  React.useEffect(() => () => rec.current?.abort(), []);

  const stop = () => rec.current?.stop();
  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) onTextRef.current(res[0].transcript);
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => { if (e.error !== "aborted") setError(ERRORS[e.error] ?? `Voice input stopped (${e.error}).`); };
    r.onend = () => { setListening(false); setInterim(""); rec.current = null; };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("Voice input could not start. Try again.");
    }
  };

  if (supported === null) return null;
  if (!supported) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MicOff className="size-3.5" /> Voice input works in Google Chrome or Microsoft Edge.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {listening ? (
          <Button type="button" size="sm" variant="destructive" onClick={stop} aria-label="Stop voice input">
            <Square /> Stop
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={start} aria-label="Speak your comment">
            <Mic /> Speak
          </Button>
        )}
        <NativeSelect aria-label="Voice input language" className="h-8 w-32 text-xs" value={lang} disabled={listening}
          onChange={(e) => { setLang(e.target.value); try { localStorage.setItem("cdems-dictation-lang", e.target.value); } catch { /* ignore */ } }}>
          {DICTATION_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </NativeSelect>
        {listening && (
          <span className="flex items-center gap-1.5 text-xs text-destructive">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
            </span>
            Listening… speak now
          </span>
        )}
      </div>
      {listening && interim && <p className={cn("rounded-md border border-dashed px-2 py-1 text-xs italic text-muted-foreground")}>{interim}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
