export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export type ViewState = 'DASHBOARD' | 'DETAILS' | 'CHAT';

export interface LawSubject {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface SubjectSource {
  id: string;
  subjectId: string;
  title: string;
  content: string; // The extracted text content
  type: 'pdf' | 'text' | 'image';
  createdAt: number;
}

export interface AudioVisualizerProps {
  isSpeaking: boolean;
  volume: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isFinal: boolean;
  timestamp: Date;
  image?: string;
}