import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { CustomerDetails, ConnectionState, ChatMessage } from './types';
import { createBlob, decode, decodeAudioData, playRingSound } from './utils/audioUtils';
import { exportToCSV } from './utils/exportUtils';
import { Phone, PhoneOff, Download, User, Activity, Mic, Volume2 } from 'lucide-react';

const SYSTEM_INSTRUCTION = `
# Role & Personality
You are a professional, friendly, and helpful insurance advisor for Magma Care. Your goal is to guide customers through insurance options and capture their details for a personalized quote. Speak clearly and use a polite, conversational tone.

# Interaction Flow
1. **Greeting**: The user has already heard a ringing sound. Start immediately with: "Hello! Thank you for calling Magma Care Insurance. I'm your AI assistant. How are you today?"
2. **Insurance Selection**: Ask if they are interested in Health, Term, Travel, Pet, or Family insurance. Briefly explain the one they choose (e.g., "Family insurance is great for ensuring all your loved ones are covered under one policy.").
3. **Details Collection**: Once a type is chosen, politely collect the following one by one:
   - Full Name
   - Phone Number
   - Monthly Income
   - Age
4. **Saving Data**: When you have ALL four pieces of information (Name, Phone, Income, Age) and the Insurance Type, you MUST call the "saveCustomerDetails" tool immediately.
5. **Closing**: After saving, thank them and let them know an expert will reach out soon with a quote.

# Constraints
- If they ask something unrelated, politely bring them back to insurance.
- If they provide a vague answer for monthly income, ask for a ballpark figure.
- Do not make up policy pricing; tell them an agent will provide an exact quote based on their details.
`;

const saveCustomerTool: FunctionDeclaration = {
  name: 'saveCustomerDetails',
  description: 'Saves the customer\'s personal details after they have been collected.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      fullName: { type: Type.STRING, description: "Customer's full name" },
      phoneNumber: { type: Type.STRING, description: "Customer's phone number" },
      monthlyIncome: { type: Type.STRING, description: "Customer's monthly income" },
      age: { type: Type.STRING, description: "Customer's age" },
      insuranceType: { type: Type.STRING, description: "The type of insurance selected" }
    },
    required: ['fullName', 'phoneNumber', 'monthlyIncome', 'age', 'insuranceType']
  }
};

const App: React.FC = () => {
  // State
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [customerData, setCustomerData] = useState<CustomerDetails[]>([]);
  const [transcripts, setTranscripts] = useState<ChatMessage[]>([]);
  const [volumeLevel, setVolumeLevel] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  
  // Session Refs
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  
  // Transcription buffers
  const currentInputTranscription = useRef<string>('');
  const currentOutputTranscription = useRef<string>('');

  const connectToGemini = async () => {
    if (!process.env.API_KEY) {
      alert("API_KEY is missing in environment variables.");
      return;
    }

    setConnectionState(ConnectionState.CONNECTING);
    
    // Initialize Audio Contexts
    const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    inputAudioContextRef.current = inputCtx;
    outputAudioContextRef.current = outputCtx;
    nextStartTimeRef.current = 0; // Reset time cursor

    try {
      // 1. Play Ring Sound Effect
      await playRingSound(outputCtx);

      // 2. Get User Media
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 3. Initialize GenAI Client
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

      // 4. Connect Session
      const sessionPromise = ai.live.connect({
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: [saveCustomerTool] }],
          inputAudioTranscription: {}, // Enable input transcription
          outputAudioTranscription: {}, // Enable output transcription
        },
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            
            // Setup Input Stream Processing
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Simple volume visualization
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolumeLevel(Math.min(100, rms * 500)); // Scale for UI

              const pcmBlob = createBlob(inputData);
              
              // Send Audio Input
              sessionPromise.then((session: any) => {
                 session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              setIsSpeaking(true);
              const ctx = outputAudioContextRef.current;
              if (ctx) {
                // Sync playback time
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                
                const audioBuffer = await decodeAudioData(
                  decode(base64Audio),
                  ctx,
                  24000,
                  1
                );
                
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                
                source.addEventListener('ended', () => {
                   sourcesRef.current.delete(source);
                   if (sourcesRef.current.size === 0) setIsSpeaking(false);
                });

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
              }
            }

            // Handle Transcriptions
            if (message.serverContent?.inputTranscription) {
               currentInputTranscription.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
               currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            }

            // Handle Turn Completion (Commit transcript to logs)
            if (message.serverContent?.turnComplete) {
               if (currentInputTranscription.current) {
                 setTranscripts(prev => [...prev, {
                   role: 'user',
                   text: currentInputTranscription.current,
                   timestamp: new Date()
                 }]);
                 currentInputTranscription.current = '';
               }
               if (currentOutputTranscription.current) {
                 setTranscripts(prev => [...prev, {
                   role: 'model',
                   text: currentOutputTranscription.current,
                   timestamp: new Date()
                 }]);
                 currentOutputTranscription.current = '';
               }
            }

            // Handle Tool Calls (Save Customer Data)
            if (message.toolCall) {
              const responses = message.toolCall.functionCalls.map((fc) => {
                if (fc.name === 'saveCustomerDetails') {
                  const args = fc.args as any;
                  const newCustomer: CustomerDetails = {
                    fullName: args.fullName,
                    phoneNumber: args.phoneNumber,
                    monthlyIncome: args.monthlyIncome,
                    age: args.age,
                    insuranceType: args.insuranceType,
                    timestamp: new Date().toLocaleString()
                  };
                  
                  setCustomerData(prev => [...prev, newCustomer]);
                  
                  return {
                    id: fc.id,
                    name: fc.name,
                    response: { result: "Success: Customer details saved." }
                  };
                }
                return { id: fc.id, name: fc.name, response: { result: "Unknown function" }};
              });

              sessionPromise.then((session: any) => {
                session.sendToolResponse({ functionResponses: responses });
              });
            }
          },
          onclose: () => {
            setConnectionState(ConnectionState.DISCONNECTED);
            setIsSpeaking(false);
          },
          onerror: (err) => {
            console.error("Gemini Live Error:", err);
            setConnectionState(ConnectionState.ERROR);
            setIsSpeaking(false);
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (error) {
      console.error("Connection failed", error);
      setConnectionState(ConnectionState.ERROR);
    }
  };

  const disconnect = async () => {
    if (sessionPromiseRef.current) {
      const session = await sessionPromiseRef.current;
      session.close();
    }
    
    // Stop all audio
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }

    setConnectionState(ConnectionState.DISCONNECTED);
    setIsSpeaking(false);
    setVolumeLevel(0);
  };

  const handleExport = () => {
    exportToCSV(customerData, transcripts);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <header className="p-6 border-b border-white/10 flex justify-between items-center bg-black/20 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg">
             <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Magma Care</h1>
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Voice Advisor</p>
          </div>
        </div>
        <button 
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-full text-sm font-medium transition-colors border border-slate-600"
        >
          <Download className="w-4 h-4" />
          Export Excel (CSV)
        </button>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-88px)]">
        
        {/* Left Column: Voice Interaction */}
        <div className="flex flex-col gap-6 justify-center items-center relative">
           
           {/* Visualizer / Status */}
           <div className="relative w-64 h-64 flex items-center justify-center">
              {/* Outer Glow Rings */}
              {connectionState === ConnectionState.CONNECTED && (
                <>
                  <div className={`absolute inset-0 rounded-full border-2 border-indigo-500/30 ${isSpeaking ? 'animate-pulse-ring' : ''}`} />
                  <div className={`absolute inset-4 rounded-full border-2 border-indigo-400/20 ${isSpeaking ? 'animate-pulse-ring' : ''} animation-delay-500`} />
                </>
              )}
              
              {/* Main Avatar Circle */}
              <div className={`
                relative z-10 w-48 h-48 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500
                ${connectionState === ConnectionState.CONNECTED ? 'bg-indigo-600 shadow-indigo-500/50 scale-105' : 'bg-slate-700 shadow-black/50'}
                ${isSpeaking ? 'scale-110' : ''}
              `}>
                {connectionState === ConnectionState.CONNECTED ? (
                  <Activity className={`w-20 h-20 text-white ${isSpeaking ? 'animate-pulse' : ''}`} />
                ) : (
                  <Mic className="w-20 h-20 text-slate-400" />
                )}
              </div>

              {/* Status Badge */}
              <div className={`
                absolute bottom-0 px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-lg border border-white/10 backdrop-blur-md
                ${connectionState === ConnectionState.CONNECTED ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-slate-800 text-slate-400'}
              `}>
                {connectionState === ConnectionState.CONNECTED ? (isSpeaking ? 'Agent Speaking' : 'Listening...') : connectionState}
              </div>
           </div>

           {/* Controls */}
           <div className="flex flex-col items-center gap-4 w-full max-w-sm">
             {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
               <button 
                onClick={connectToGemini}
                className="w-full py-4 bg-green-600 hover:bg-green-500 text-white rounded-2xl font-bold text-lg shadow-lg shadow-green-900/20 transition-all hover:scale-[1.02] flex items-center justify-center gap-3"
               >
                 <Phone className="w-6 h-6" />
                 Start Call
               </button>
             ) : (
               <button 
                onClick={disconnect}
                className="w-full py-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-bold text-lg shadow-lg shadow-red-900/20 transition-all hover:scale-[1.02] flex items-center justify-center gap-3"
               >
                 <PhoneOff className="w-6 h-6" />
                 End Call
               </button>
             )}

             {connectionState === ConnectionState.CONNECTING && (
               <p className="text-slate-400 animate-pulse">Establishing secure line...</p>
             )}
           </div>

           {/* Audio Input Meter */}
           {connectionState === ConnectionState.CONNECTED && (
             <div className="w-full max-w-xs h-1.5 bg-slate-800 rounded-full overflow-hidden mt-4">
               <div 
                className="h-full bg-indigo-400 transition-all duration-75 ease-out"
                style={{ width: `${Math.min(100, volumeLevel)}%` }} 
               />
             </div>
           )}

           <div className="text-center text-slate-400 text-sm max-w-xs mt-4">
             <p>Speak clearly. The agent will guide you through the process.</p>
           </div>
        </div>

        {/* Right Column: Data & Logs */}
        <div className="flex flex-col gap-4 h-full overflow-hidden">
          
          {/* Captured Data Card */}
          <div className="bg-slate-800/50 rounded-2xl border border-white/5 p-6 flex-shrink-0 backdrop-blur-sm">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4 text-indigo-300">
              <User className="w-5 h-5" />
              Captured Details
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-400 uppercase bg-slate-700/50">
                  <tr>
                    <th className="px-4 py-2 rounded-tl-lg">Name</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Phone</th>
                    <th className="px-4 py-2 rounded-tr-lg">Income</th>
                  </tr>
                </thead>
                <tbody>
                  {customerData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500 italic">
                        No data captured yet...
                      </td>
                    </tr>
                  ) : (
                    customerData.map((c, i) => (
                      <tr key={i} className="border-b border-slate-700/50 last:border-0 hover:bg-white/5">
                        <td className="px-4 py-3 font-medium text-white">{c.fullName}</td>
                        <td className="px-4 py-3 text-indigo-300 bg-indigo-900/20 rounded-md inline-block my-2 text-xs font-bold px-2 py-0.5 ml-2">{c.insuranceType}</td>
                        <td className="px-4 py-3 text-slate-300">{c.phoneNumber}</td>
                        <td className="px-4 py-3 text-slate-300">{c.monthlyIncome}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Transcript Log */}
          <div className="flex-1 bg-black/40 rounded-2xl border border-white/5 p-6 overflow-hidden flex flex-col">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4 text-slate-300">
              <Volume2 className="w-5 h-5" />
              Live Transcript
            </h2>
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-hide">
              {transcripts.length === 0 ? (
                <div className="text-center mt-20 text-slate-600">
                  <p>Conversation history will appear here.</p>
                </div>
              ) : (
                transcripts.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                      msg.role === 'user' 
                        ? 'bg-indigo-600 text-white rounded-br-none' 
                        : 'bg-slate-700 text-slate-200 rounded-bl-none'
                    }`}>
                      <p className="mb-1">{msg.text}</p>
                      <p className={`text-[10px] ${msg.role === 'user' ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {msg.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;