export interface CustomerDetails {
  fullName: string;
  phoneNumber: string;
  monthlyIncome: string;
  age: string;
  insuranceType: string;
  timestamp: string;
}

export interface ChatMessage {
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: Date;
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface ToolCallResponse {
  functionResponses: {
    id: string;
    name: string;
    response: object;
  }[];
}
