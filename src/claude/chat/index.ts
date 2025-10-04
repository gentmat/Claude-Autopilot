import * as vscode from 'vscode';
import { ChatMessage } from '../../core/types';
import { claudeProcess, sessionReady, chatHistory, setChatHistory } from '../../core/state';
import { debugLog } from '../../utils/logging';
import { updateWebviewContent, updateSessionState } from '../../ui/webview';
import { startClaudeSession } from '../../claude/session';
import { generateMessageId } from '../../utils/id-generator';
import { getMobileServer } from '../../services/mobile/index';

// Real-time message sending - no queue, no processing status
export async function sendChatMessage(userMessage: string): Promise<void> {
    debugLog('📤 Sending chat message in real-time');
    
    // Add user message to chat history
    const userChatMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString()
    };
    
    chatHistory.push(userChatMessage);
    updateWebviewContent();
    
    // Notify mobile clients
    notifyMobileClients();
    
    // Ensure Claude session is running
    if (!claudeProcess) {
        debugLog('🚀 Starting Claude session for real-time chat');
        await startClaudeSession(true);
        
        // Wait for session to be ready
        await waitForSessionReady();
    }
    
    // For real-time chat, allow proceeding as long as the process is alive,
    // even if sessionReady hasn't been set yet (e.g., no ready prompt detected).
    if (!claudeProcess || claudeProcess.killed) {
        throw new Error('Claude process not available');
    }
    if (!sessionReady) {
        debugLog('⚡ Proceeding with chat: process running but session not fully marked ready');
    }
    
    try {
        debugLog('📝 Sending message to Claude process');
        await writeToClaudeProcess(userMessage);
        
        debugLog('✓ Message sent successfully');
        vscode.window.showInformationMessage('Message sent to Claude');
        
        // Reply capture is handled centrally by the output module
        
    } catch (error) {
        debugLog(`❌ Error sending message: ${error}`);
        
        // Add error message to chat history
        const errorMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'system',
            content: `Error: ${error}`,
            timestamp: new Date().toISOString()
        };
        chatHistory.push(errorMessage);
        updateWebviewContent();
        
        throw error;
    }
}

async function waitForSessionReady(): Promise<void> {
    return new Promise((resolve, reject) => {
        // For real-time chat, wait a short time for Claude to initialize
        // We don't need the full "ready" prompt - just a running process is enough
        let attempts = 0;
        const maxAttempts = 20; // 10 seconds total
        
        const checkInterval = setInterval(() => {
            attempts++;
            
            // If session is fully ready, great!
            if (sessionReady) {
                clearInterval(checkInterval);
                resolve();
                return;
            }
            
            // If process is running for 5+ seconds, consider it ready enough for chat
            if (attempts >= 10 && claudeProcess && !claudeProcess.killed) {
                debugLog('⚡ Claude process running - proceeding with chat (ready prompt not required)');
                clearInterval(checkInterval);
                resolve();
                return;
            }
            
            // Timeout after 10 seconds
            if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                reject(new Error('Claude session startup timeout - process may not be responding'));
            }
        }, 500);
    });
}

async function writeToClaudeProcess(message: string): Promise<void> {
    if (!claudeProcess || !claudeProcess.stdin) {
        throw new Error('Claude process not available');
    }
    
    if (claudeProcess.stdin.destroyed || !claudeProcess.stdin.writable) {
        throw new Error('Claude process stdin is not writable');
    }
    
    // Send message in chunks to prevent issues with large messages
    const CHUNK_SIZE = 1024;
    const messageBuffer = Buffer.from(message, 'utf8');
    
    for (let i = 0; i < messageBuffer.length; i += CHUNK_SIZE) {
        const chunk = messageBuffer.subarray(i, Math.min(i + CHUNK_SIZE, messageBuffer.length));
        
        await new Promise<void>((resolve, reject) => {
            if (!claudeProcess || !claudeProcess.stdin) {
                reject(new Error('Claude process not available'));
                return;
            }
            claudeProcess.stdin.write(chunk, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Send carriage return to submit
    await new Promise<void>((resolve, reject) => {
        if (!claudeProcess || !claudeProcess.stdin) {
            reject(new Error('Claude process not available'));
            return;
        }
        claudeProcess.stdin.write('\r', (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function notifyMobileClients(): void {
    try {
        const mobileServer = getMobileServer();
        if (mobileServer.isRunning()) {
            mobileServer.notifyQueueUpdate();
        }
    } catch (error) {
        // Silently fail if mobile service isn't available
    }
}

export function clearChatHistory(): void {
    setChatHistory([]);
    updateWebviewContent();
    vscode.window.showInformationMessage('Chat history cleared');
}
