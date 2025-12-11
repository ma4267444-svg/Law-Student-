import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { ConnectionState, LawSubject, ChatMessage, ViewState, SubjectSource } from './types';
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from './utils/audio';
import { extractTextFromPDF } from './utils/pdf';
import { extractTextFromImage } from './utils/ocr';
import Visualizer from './components/Visualizer';

// --- Configuration ---
// Connected to Project: Law Student (zganlzrrxpijvipggiei)
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnYW5senJyeHBpanZpcGdnaWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0ODcwNjMsImV4cCI6MjA4MTA2MzA2M30.0hmUg6FgYPI62oR2y9avE0s1eqIX2fDxmdsUB9EzlNk'; 
const SUPABASE_URL = 'https://zganlzrrxpijvipggiei.supabase.co';

// Initialize Supabase Client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Data ---
const SUBJECTS: LawSubject[] = [
  { id: 'intl_private', name: 'قانون دولي خاص', description: 'تنازع القوانين، الجنسية، ومركز الأجانب.', icon: '🌍' },
  { id: 'sharia', name: 'شريعة إسلامية', description: 'أحكام المواريث وتوزيع التركات.', icon: '⚖️' },
  { id: 'commercial', name: 'قانون تجاري', description: 'الأعمال التجارية والشركات.', icon: '💼' },
  { id: 'admin_judiciary', name: 'قضاء إداري', description: 'مجلس الدولة ودعوى الإلغاء.', icon: '🏛️' },
  { id: 'public_finance', name: 'مالية عامة', description: 'الموازنة العامة والضرائب.', icon: '💰' },
];

export default function App() {
  // Navigation State
  const [view, setView] = useState<ViewState>('DASHBOARD');
  const [selectedSubject, setSelectedSubject] = useState<LawSubject | null>(null);
  
  // Data State
  const [sources, setSources] = useState<SubjectSource[]>([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');

  // Connection State
  const [apiKey, setApiKey] = useState<string>(process.env.API_KEY || '');
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [volume, setVolume] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentOutput, setCurrentOutput] = useState('');
  
  // Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null); // For Chat Image Upload
  const pdfInputRef = useRef<HTMLInputElement>(null); // For Knowledge Base PDF
  const imageKbInputRef = useRef<HTMLInputElement>(null); // For Knowledge Base Image OCR

  // --- Supabase Logic ---

  const fetchSources = async (subjectId: string) => {
    try {
        setProcessingStatus('جاري تحميل المصادر...');
        const { data, error } = await supabase
            .from('resources')
            .select('*')
            .eq('subject_id', subjectId)
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        // Map Database snake_case to App camelCase
        const mappedSources: SubjectSource[] = (data || []).map((item: any) => ({
            id: item.id,
            subjectId: item.subject_id,
            title: item.title,
            content: item.content,
            type: item.type,
            createdAt: new Date(item.created_at).getTime()
        }));

        setSources(mappedSources);
    } catch (err: any) {
        console.error("Supabase Fetch Error:", err.message || err);
        
        // Check for "Relation does not exist" error (Table missing)
        if (err.code === '42P01') {
            const sqlMsg = `
IMPORTANT: The 'resources' table does not exist in your Supabase project.
Run this SQL in the Supabase SQL Editor:

create table resources (
  id uuid default gen_random_uuid() primary key,
  subject_id text not null,
  title text not null,
  content text,
  type text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table resources enable row level security;
create policy "Public Access" on resources for all using (true);
            `;
            console.warn(sqlMsg);
            alert("جدول البيانات غير موجود. يرجى مراجعة الـ Console (F12) للحصول على كود إنشاء الجدول.");
        }

        // Fallback for demo/offline
        setSources(prev => prev.filter(s => s.subjectId === subjectId)); 
    } finally {
        setProcessingStatus('');
    }
  };

  const saveSourceToDB = async (source: Omit<SubjectSource, 'id' | 'createdAt'>) => {
      try {
          const { data, error } = await supabase.from('resources').insert([
              {
                  subject_id: source.subjectId,
                  title: source.title,
                  content: source.content,
                  type: source.type,
                  created_at: new Date().toISOString()
              }
          ]).select();

          if (error) throw error;
          
          if (data && data[0]) {
              // Map response back to app format
              const newSource: SubjectSource = {
                  id: data[0].id,
                  subjectId: data[0].subject_id,
                  title: data[0].title,
                  content: data[0].content,
                  type: data[0].type,
                  createdAt: new Date(data[0].created_at).getTime()
              };
              setSources(prev => [newSource, ...prev]);
          }
      } catch (err: any) {
          console.error("Supabase Save Error:", err.message || err);
          alert(`حدث خطأ أثناء الحفظ: ${err.message || "تأكد من إعدادات قاعدة البيانات"}`);
          
          // Fallback to local state
          const localSource = { ...source, id: Date.now().toString(), createdAt: Date.now() };
          setSources(prev => [localSource, ...prev]);
      }
  };

  const deleteSourceFromDB = async (id: string) => {
      try {
          const { error } = await supabase.from('resources').delete().eq('id', id);
          if (error) throw error;
          setSources(prev => prev.filter(s => s.id !== id));
      } catch (err: any) {
          console.error("Delete Error:", err.message || err);
          alert("فشل الحذف من قاعدة البيانات");
      }
  };

  // --- Handlers ---

  const handleSubjectSelect = (subject: LawSubject) => {
    setSelectedSubject(subject);
    fetchSources(subject.id);
    setView('DETAILS');
  };

  const handleStartSession = () => {
    setView('CHAT');
  };

  const handleAddTextNote = async () => {
    if (!selectedSubject) return;
    const text = prompt("أدخل النص أو الملاحظة:");
    if (text) {
        await saveSourceToDB({
            subjectId: selectedSubject.id,
            title: 'ملاحظة نصية',
            content: text,
            type: 'text'
        });
    }
  };

  const handlePDFUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSubject) return;

    setIsProcessingFile(true);
    setProcessingStatus('جاري استخراج النص من PDF...');
    try {
        const text = await extractTextFromPDF(file);
        await saveSourceToDB({
            subjectId: selectedSubject.id,
            title: file.name,
            content: text,
            type: 'pdf'
        });
    } catch (err) {
        console.error("PDF Parsing Error", err);
        alert("فشل قراءة ملف الـ PDF.");
    } finally {
        setIsProcessingFile(false);
        setProcessingStatus('');
        if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const handleImageKbUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSubject) return;
    if (!apiKey) {
        alert("يجب إدخال مفتاح API أولاً لاستخدام ميزة تحليل الصور.");
        return;
    }

    setIsProcessingFile(true);
    setProcessingStatus('جاري تحليل الصورة واستخراج النصوص (OCR)...');
    try {
        const text = await extractTextFromImage(file, apiKey);
        await saveSourceToDB({
            subjectId: selectedSubject.id,
            title: `[صورة] ${file.name}`,
            content: text,
            type: 'image'
        });
    } catch (err) {
        console.error("Image OCR Error", err);
        alert("فشل تحليل الصورة.");
    } finally {
        setIsProcessingFile(false);
        setProcessingStatus('');
        if (imageKbInputRef.current) imageKbInputRef.current.value = '';
    }
  };

  // --- Audio & AI Logic ---
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, currentInput, currentOutput]);

  const initAudioContexts = () => {
    if (!inputAudioContextRef.current) {
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    }
    if (!outputAudioContextRef.current) {
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  };

  const disconnect = useCallback(async () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    sourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    if (sessionRef.current) {
      const session = await sessionRef.current;
      try { session.close(); } catch(e) {}
      sessionRef.current = null;
    }
    setConnectionState(ConnectionState.DISCONNECTED);
    setVolume(0);
    nextStartTimeRef.current = 0;
    setCurrentInput('');
    setCurrentOutput('');
  }, []);

  const connect = async () => {
    if (!apiKey) {
      setErrorMsg("الرجاء إدخال مفتاح API");
      return;
    }
    setErrorMsg(null);
    initAudioContexts();
    setConnectionState(ConnectionState.CONNECTING);

    try {
      const ai = new GoogleGenAI({ apiKey });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Construct Knowledge Base from Supabase sources
      // We truncate massive texts to avoid hitting initial context limits if necessary, 
      // but Gemini Flash has a large context window (1M), so usually fine.
      const subjectDocs = sources.map(s => 
        `=== المصدر: ${s.title} (${s.type}) ===\nالمحتوى:\n${s.content}`
      ).join('\n\n');
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            const ctx = inputAudioContextRef.current!;
            const source = ctx.createMediaStreamSource(stream);
            sourceNodeRef.current = source;
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for(let i=0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(Math.min(rms * 5, 1));
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(processor);
            processor.connect(ctx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const serverContent = message.serverContent;
            if (serverContent?.interrupted) {
              sourcesRef.current.forEach(src => { try { src.stop(); } catch(e){} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setCurrentOutput('');
              return;
            }
            if (serverContent?.modelTurn?.parts?.[0]?.text) {
                setCurrentOutput(prev => prev + serverContent.modelTurn.parts[0].text);
            }
            if (message.serverContent?.outputTranscription?.text) {
                setCurrentOutput(prev => prev + message.serverContent.outputTranscription.text);
            }
            if (message.serverContent?.inputTranscription?.text) {
                setCurrentInput(prev => prev + message.serverContent.inputTranscription.text);
            }
            if (serverContent?.turnComplete) {
                if (currentInput.trim()) {
                    setMessages(prev => [...prev, { id: Date.now() + 'u', role: 'user', text: currentInput, isFinal: true, timestamp: new Date() }]);
                    setCurrentInput('');
                }
                if (currentOutput.trim()) {
                     setMessages(prev => [...prev, { id: Date.now() + 'm', role: 'model', text: currentOutput, isFinal: true, timestamp: new Date() }]);
                    setCurrentOutput('');
                }
            }
            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const audioData = base64ToUint8Array(base64Audio);
              const audioBuffer = await decodeAudioData(audioData, ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.addEventListener('ended', () => sourcesRef.current.delete(source));
              source.start(nextStartTimeRef.current);
              sourcesRef.current.add(source);
              nextStartTimeRef.current += audioBuffer.duration;
            }
          },
          onclose: () => setConnectionState(ConnectionState.DISCONNECTED),
          onerror: (err) => {
            console.error('Connection error:', err);
            setErrorMsg("حدث خطأ في الاتصال.");
            disconnect();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
          systemInstruction: `
            أنت "Mohami" (محامي)، معلم قانوني ذكي.
            شخصية: TUL8TE (غامض، هادئ، صوت عميق، لهجة مصرية شبابية راقية).
            المادة الحالية: ${selectedSubject?.name}.
            
            قاعدة البيانات المعرفية (مصادر المادة التي رفعها الطالب):
            ${subjectDocs}
            
            التعليمات:
            1. استخدم المعلومات الموجودة في قاعدة البيانات المعرفية أعلاه للإجابة على الأسئلة بدقة قانونية.
            2. إذا سأل الطالب عن شيء موجود في صورة أو ملف رفعه، ابحث عنه في "المحتوى" أعلاه.
            3. إذا لم تجد المعلومة في المصادر، استخدم معرفتك العامة ولكن أشر إلى أن المعلومة ليست من المصادر المرفقة.
            4. حافظ على الشخصية (Cool, Calm, Mysterious) طوال الوقت.
          `
        }
      });
      sessionRef.current = sessionPromise;
    } catch (err) {
      console.error(err);
      setErrorMsg("فشل الاتصال.");
      setConnectionState(ConnectionState.DISCONNECTED);
    }
  };

  const toggleConnection = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) disconnect();
    else connect();
  };

  const handleImageUploadChat = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (connectionState !== ConnectionState.CONNECTED) {
        setErrorMsg("لازم نكون متصلين عشان نشوف الصورة يا زميلي");
        return;
    }
    const reader = new FileReader();
    reader.onloadend = async () => {
        const base64String = (reader.result as string).split(',')[1];
        if (sessionRef.current) {
            const session = await sessionRef.current;
            session.sendRealtimeInput({ media: { mimeType: file.type, data: base64String } });
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text: `[صورة: ${file.name}]`, isFinal: true, timestamp: new Date() }]);
        }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const isEnvKey = !!process.env.API_KEY;

  // --- RENDER ---
  
  // 1. Dashboard View
  if (view === 'DASHBOARD') {
      return (
        <div className="min-h-screen bg-tul8te-black text-gray-200 font-sans p-6 flex flex-col items-center">
            <header className="w-full max-w-4xl flex justify-between items-center mb-12 mt-4 animate-fade-in">
                <div className="flex items-center gap-2">
                    <span className="text-3xl">⚖️</span>
                    <h1 className="text-2xl font-bold tracking-wider text-white">MOHAMI AI</h1>
                </div>
                <div className="text-xs tracking-widest text-tul8te-accent uppercase border border-tul8te-accent px-3 py-1 rounded-full">
                    TUL8TE Edition
                </div>
            </header>

            <main className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in">
                {SUBJECTS.map((sub, idx) => (
                    <button 
                        key={sub.id}
                        onClick={() => handleSubjectSelect(sub)}
                        className="group relative bg-law-900 border border-law-800 hover:border-tul8te-accent p-6 rounded-2xl text-right transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-gray-900 overflow-hidden"
                        style={{animationDelay: `${idx * 100}ms`}}
                    >
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-tul8te-accent to-transparent opacity-0 group-hover:opacity-50 transition-opacity"></div>
                        <div className="text-4xl mb-4 grayscale group-hover:grayscale-0 transition-all">{sub.icon}</div>
                        <h2 className="text-xl font-bold text-white mb-2">{sub.name}</h2>
                        <p className="text-sm text-gray-400 leading-relaxed">{sub.description}</p>
                        <div className="mt-4 flex justify-end">
                            <span className="text-xs text-tul8te-accent group-hover:text-white transition-colors">إدارة المادة &larr;</span>
                        </div>
                    </button>
                ))}
            </main>

            {!isEnvKey && (
                <div className="mt-12 w-full max-w-md animate-fade-in">
                    <input 
                        type="password" 
                        value={apiKey} 
                        onChange={(e) => setApiKey(e.target.value)} 
                        placeholder="أدخل مفتاح API للبدء..."
                        className="w-full bg-law-900 border border-law-700 rounded-lg px-4 py-3 text-center text-sm focus:outline-none focus:border-tul8te-accent transition-colors"
                    />
                </div>
            )}
        </div>
      );
  }

  // 2. Details View (Resource Manager)
  if (view === 'DETAILS' && selectedSubject) {
      return (
          <div className="min-h-screen bg-tul8te-black text-gray-200 font-sans p-6 flex flex-col items-center">
             <header className="w-full max-w-4xl flex justify-between items-center mb-8">
                <button onClick={() => setView('DASHBOARD')} className="text-gray-500 hover:text-white">
                    &larr; العودة
                </button>
                <h1 className="text-2xl font-bold">{selectedSubject.name}</h1>
             </header>

             <main className="w-full max-w-4xl space-y-6">
                
                {/* Stats Card */}
                <div className="bg-law-900 border border-law-800 p-6 rounded-2xl flex items-center justify-between relative overflow-hidden">
                    <div className="relative z-10">
                        <h3 className="text-tul8te-accent text-sm uppercase tracking-wider mb-1">المصادر في قاعدة البيانات</h3>
                        <p className="text-3xl font-bold text-white">
                            {processingStatus ? <span className="text-sm text-yellow-500 animate-pulse">{processingStatus}</span> : sources.length}
                        </p>
                    </div>
                    <div className="text-4xl opacity-20 relative z-10">📚</div>
                    {/* Database connection indicator */}
                    <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_#22c55e]" title="Connected to Supabase"></div>
                </div>

                {/* Source List */}
                <div className="space-y-3 min-h-[200px]">
                    {sources.length === 0 ? (
                        <div className="text-center py-10 border-2 border-dashed border-law-800 rounded-2xl text-gray-500">
                            لا توجد مصادر مضافة لهذه المادة في قاعدة البيانات.<br/>
                            أضف ملفات PDF أو صور ليتم تحليلها وحفظها.
                        </div>
                    ) : (
                        sources.map(source => (
                            <div key={source.id} className="bg-law-800 p-4 rounded-xl flex justify-between items-center border border-law-700">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">
                                        {source.type === 'pdf' ? '📄' : source.type === 'image' ? '🖼️' : '📝'}
                                    </span>
                                    <div>
                                        <h4 className="font-bold text-white">{source.title}</h4>
                                        <p className="text-xs text-gray-400">
                                            {source.type === 'image' ? '[تم استخراج النص] ' : ''}
                                            {source.content.substring(0, 50)}...
                                        </p>
                                    </div>
                                </div>
                                <button onClick={() => deleteSourceFromDB(source.id)} className="text-red-900 hover:text-red-500 p-2">
                                    🗑️
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {/* Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <button 
                        onClick={() => pdfInputRef.current?.click()}
                        disabled={isProcessingFile}
                        className="flex items-center justify-center gap-2 p-4 rounded-xl bg-law-900 border border-law-700 hover:border-tul8te-accent transition-colors disabled:opacity-50"
                     >
                        <input type="file" accept="application/pdf" className="hidden" ref={pdfInputRef} onChange={handlePDFUpload} />
                        <span>📄 رفع PDF</span>
                     </button>
                     
                     <button 
                        onClick={() => imageKbInputRef.current?.click()}
                        disabled={isProcessingFile}
                        className="flex items-center justify-center gap-2 p-4 rounded-xl bg-law-900 border border-law-700 hover:border-tul8te-accent transition-colors disabled:opacity-50"
                     >
                        <input type="file" accept="image/*" className="hidden" ref={imageKbInputRef} onChange={handleImageKbUpload} />
                        <span>🖼️ رفع صورة (مسح ضوئي)</span>
                     </button>

                     <button 
                        onClick={handleAddTextNote}
                        disabled={isProcessingFile}
                        className="flex items-center justify-center gap-2 p-4 rounded-xl bg-law-900 border border-law-700 hover:border-tul8te-accent transition-colors"
                     >
                        <span>📝 إضافة نص</span>
                     </button>
                </div>

                {/* Start Button */}
                <button 
                    onClick={handleStartSession}
                    className="w-full py-5 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-transform hover:scale-[1.01] shadow-lg mt-8"
                >
                    بدء المذاكرة مع Mohami AI
                </button>

             </main>
          </div>
      );
  }

  // 3. Chat View
  return (
    <div className="h-screen bg-tul8te-black flex flex-col font-sans overflow-hidden text-gray-200">
      {/* Header */}
      <header className="bg-law-900 border-b border-law-800 p-4 flex justify-between items-center shadow-lg z-10">
        <div className="flex items-center gap-4">
            <button onClick={() => { disconnect(); setView('DETAILS'); }} className="text-gray-400 hover:text-white transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
            </button>
            <div>
                <h1 className="font-bold text-white text-lg">{selectedSubject?.name}</h1>
                <p className="text-xs text-tul8te-accent flex items-center gap-1">
                   {sources.length > 0 ? `يعتمد على ${sources.length} مصادر` : 'شرح عام (بدون مصادر)'}
                </p>
            </div>
        </div>
        <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center border border-gray-700">
             🎭
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4 space-y-6" ref={scrollRef}>
        {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 opacity-60">
                <div className="text-6xl mb-6 grayscale opacity-50">🎧</div>
                <p className="text-lg">جاهز للمذاكرة يا زميلي؟</p>
                <p className="text-sm mt-2">اضغط المايك واسأل براحتك.</p>
            </div>
        )}
        
        {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'} animate-fade-in`}>
                <div className={`max-w-[85%] rounded-2xl px-6 py-4 shadow-md backdrop-blur-sm ${
                    msg.role === 'user' 
                        ? 'bg-law-800 text-gray-100 rounded-br-none border border-law-700' 
                        : 'bg-gradient-to-br from-gray-900 to-black text-gray-300 rounded-bl-none border border-law-800'
                }`}>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                </div>
            </div>
        ))}

        {/* Live Transcripts */}
        {currentInput && (
             <div className="flex justify-start opacity-70">
                <div className="bg-law-800 text-gray-400 border border-law-700 px-5 py-3 rounded-2xl rounded-br-none">
                    <p className="animate-pulse">{currentInput}...</p>
                </div>
            </div>
        )}
        {currentOutput && (
             <div className="flex justify-end opacity-70">
                <div className="bg-black text-tul8te-accent px-5 py-3 rounded-2xl rounded-bl-none border border-law-800">
                    <p>{currentOutput}</p>
                </div>
            </div>
        )}
      </main>

      {/* Controls */}
      <div className="bg-law-900 border-t border-law-800 p-4 pb-8 backdrop-blur-lg bg-opacity-95">
         
         <div className="h-16 mb-4 flex justify-center items-center">
            {connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING ? (
                 <div className="w-full max-w-md h-full transform scale-75 origin-center opacity-80 mix-blend-screen">
                    <Visualizer state={connectionState} volume={volume} />
                 </div>
            ) : null}
         </div>

         {errorMsg && <div className="text-center text-red-400 text-sm mb-2">{errorMsg}</div>}

         <div className="flex items-center justify-center gap-8">
            <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUploadChat} />
            <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={connectionState !== ConnectionState.CONNECTED}
                className={`p-4 rounded-full transition-all duration-300 ${
                    connectionState === ConnectionState.CONNECTED 
                    ? 'bg-law-800 text-gray-300 hover:bg-law-700 hover:text-white' 
                    : 'bg-law-900 text-gray-700 cursor-not-allowed'
                }`}
                title="إرسال صورة للشات"
            >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
            </button>

            <button
                onClick={toggleConnection}
                className={`
                w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transform transition-all duration-300 hover:scale-105 active:scale-95 border-2
                ${connectionState === ConnectionState.CONNECTED 
                    ? 'bg-red-900/80 border-red-500 text-white animate-pulse' 
                    : connectionState === ConnectionState.CONNECTING
                    ? 'bg-gray-800 border-gray-600 text-gray-500'
                    : 'bg-black border-tul8te-accent text-white hover:bg-gray-900'}
                `}
            >
                {connectionState === ConnectionState.CONNECTED ? (
                     <div className="w-8 h-8 bg-red-500 rounded sm shadow-[0_0_15px_rgba(239,68,68,0.5)]" />
                ) : connectionState === ConnectionState.CONNECTING ? (
                    <div className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                )}
            </button>
            
             <button className="p-4 rounded-full bg-law-900 text-gray-700 cursor-not-allowed">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
            </button>
         </div>
      </div>
    </div>
  );
}