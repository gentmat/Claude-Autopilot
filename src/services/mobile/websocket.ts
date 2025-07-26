/**
 * WebSocket handling for the mobile server
 */
import * as WebSocket from 'ws';
import * as http from 'http';
import { debugLog } from '../../utils/logging';
import { 
    messageQueue, 
    isRunning, 
    claudeOutputBuffer, 
    processingQueue,
    sessionReady,
    currentMessage
} from '../../core/state';

export class WebSocketManager {
    private wss: WebSocket.Server | null = null;
    private clients: Set<WebSocket> = new Set();

    setup(server: http.Server): void {
        this.wss = new WebSocket.Server({ server });
        
        this.wss.on('connection', (ws: WebSocket) => {
            debugLog('📱 New WebSocket client connected');
            this.clients.add(ws);
            
            // Send initial data to new client
            this.sendToClient(ws, {
                type: 'initial',
                data: this.getQueueData()
            });
            
            ws.on('close', () => {
                debugLog('📱 WebSocket client disconnected');
                this.clients.delete(ws);
            });
            
            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.clients.delete(ws);
            });
        });
    }

    private getQueueData() {
        return {
            queue: messageQueue,
            isRunning: isRunning,
            output: claudeOutputBuffer,
            processingQueue: processingQueue,
            sessionReady: sessionReady,
            currentMessage: currentMessage
        };
    }

    private sendToClient(ws: WebSocket, message: object): void {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error sending WebSocket message:', error);
            }
        }
    }

    broadcastToClients(message: object): void {
        this.clients.forEach(ws => {
            this.sendToClient(ws, message);
        });
    }

    notifyQueueUpdate(): void {
        this.broadcastToClients({
            type: 'queueUpdate',
            data: this.getQueueData()
        });
    }

    notifyStatusUpdate(): void {
        this.broadcastToClients({
            type: 'statusUpdate',
            data: {
                isRunning: isRunning,
                processingQueue: processingQueue,
                sessionReady: sessionReady,
                currentMessage: currentMessage
            }
        });
    }

    notifyOutputUpdate(): void {
        this.broadcastToClients({
            type: 'outputUpdate',
            data: {
                output: claudeOutputBuffer
            }
        });
    }

    close(): void {
        if (this.wss) {
            this.clients.forEach(ws => {
                ws.close();
            });
            this.wss.close();
            this.wss = null;
        }
        this.clients.clear();
    }
}