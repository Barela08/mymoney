import { useState, useRef, useCallback, useEffect } from 'react';

export type VoiceLanguage = 'hi-IN' | 'en-IN';

export interface UseVoiceInputOptions {
  lang?: VoiceLanguage;
  onResult?: (transcript: string) => void;
  onError?: (error: string) => void;
}

export interface UseVoiceInputReturn {
  isListening: boolean;
  transcript: string;
  error: string | null;
  isPermissionDenied: boolean;
  isSupported: boolean;
  language: VoiceLanguage;
  setLanguage: (lang: VoiceLanguage) => void;
  startListening: () => Promise<void>;
  stopListening: () => void;
  resetTranscript: () => void;
  clearError: () => void;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);
  const [language, setLanguage] = useState<VoiceLanguage>(options.lang || 'hi-IN');

  const recognitionRef = useRef<any>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const isSupported =
    typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    setIsPermissionDenied(false);

    if (!isSupported) {
      const msg = 'Voice recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.';
      setError(msg);
      optionsRef.current.onError?.(msg);
      return;
    }

    // Step 1: Explicitly request microphone access via getUserMedia
    // This prompts the browser's native permission bar on user click if unprompted
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately release hardware tracks so SpeechRecognition has full access
        stream.getTracks().forEach((track) => track.stop());
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setIsPermissionDenied(true);
          const msg = 'Microphone permission was denied. Please allow microphone in browser settings.';
          setError(msg);
          optionsRef.current.onError?.(msg);
          return;
        }
      }
    }

    try {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      recognition.lang = language;
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const currentTranscript = Array.from(event.results)
          .map((result: any) => result[0]?.transcript || '')
          .join('');
        if (currentTranscript) {
          setTranscript(currentTranscript);
          optionsRef.current.onResult?.(currentTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('SpeechRecognition error:', event?.error);
        setIsListening(false);
        if (event?.error === 'not-allowed') {
          setIsPermissionDenied(true);
          setError('Microphone permission denied.');
        } else if (event?.error !== 'no-speech') {
          setError(`Speech error: ${event?.error || 'Unknown error'}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (err: any) {
      setIsListening(false);
      if (err?.name === 'NotAllowedError') {
        setIsPermissionDenied(true);
        setError('Microphone permission denied.');
      } else {
        setError(err?.message || 'Could not start microphone.');
      }
    }
  }, [isSupported, language]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setIsPermissionDenied(false);
  }, []);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isListening,
    transcript,
    error,
    isPermissionDenied,
    isSupported,
    language,
    setLanguage,
    startListening,
    stopListening,
    resetTranscript,
    clearError,
  };
}
