// Simplified chat message for real-time communication
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
}

// Legacy types kept for backward compatibility during migration
export interface MessageItem {
    id: string;
    text: string;
    timestamp: string;
    status: 'pending' | 'processing' | 'completed' | 'error' | 'waiting';
    output?: string;
    error?: string;
    processingStartedAt?: string;
    completedAt?: string;
    waitUntil?: number;
    waitSeconds?: number;
}

export interface HistoryRun {
    id: string;
    startTime: string;
    endTime?: string;
    workspacePath: string;
    messages: MessageItem[];
    messageStatusMap: { [messageId: string]: 'pending' | 'processing' | 'completed' | 'error' | 'waiting' };
    totalMessages: number;
    completedMessages: number;
    errorMessages: number;
    waitingMessages: number;
}

