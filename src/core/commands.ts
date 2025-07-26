/**
 * Command handlers for the Claude Autopilot extension
 */
import * as vscode from 'vscode';
import { startClaudeSession, stopProcessingQueue, startProcessingQueue } from '../claude';
import { showInput, showError, showErrorFromException, showInfo, Messages } from '../utils/notifications';
import { addMessageToQueueFromWebview } from '../queue/manager';
import { getMobileServer } from '../services/mobile';
import { debugLog } from '../utils';
import { DebugEmojis, formatDebugMessage } from './constants/ui-strings';

export class CommandHandlers {
    static registerAllCommands(context: vscode.ExtensionContext): void {
        const commands = [
            vscode.commands.registerCommand('claude-autopilot.start', CommandHandlers.handleStart),
            vscode.commands.registerCommand('claude-autopilot.stop', CommandHandlers.handleStop),
            vscode.commands.registerCommand('claude-autopilot.addMessage', CommandHandlers.handleAddMessage),
            vscode.commands.registerCommand('claude-autopilot.startWebInterface', CommandHandlers.handleStartWebInterface),
            vscode.commands.registerCommand('claude-autopilot.stopWebInterface', CommandHandlers.handleStopWebInterface),
            vscode.commands.registerCommand('claude-autopilot.showWebInterfaceQR', CommandHandlers.handleShowQR)
        ];

        context.subscriptions.push(...commands);
    }

    static async handleStart(): Promise<void> {
        debugLog(formatDebugMessage(DebugEmojis.ROCKET, 'Command: claude-autopilot.start'));
        
        try {
            // Show the webview panel first
            await vscode.commands.executeCommand('claude-autopilot.showPanel');
            
            // Start Claude session
            await startClaudeSession();
            
            // Start processing queue
            try {
                await startProcessingQueue();
            } catch (error) {
                showErrorFromException(error, Messages.FAILED_TO_START_PROCESSING);
                debugLog(`Error starting processing: ${error}`);
            }
        } catch (error) {
            showErrorFromException(error, 'Failed to start autopilot');
            debugLog(`Error in start command: ${error}`);
        }
    }

    static handleStop(): void {
        debugLog(formatDebugMessage(DebugEmojis.STOP, 'Command: claude-autopilot.stop'));
        stopProcessingQueue();
    }

    static async handleAddMessage(): Promise<void> {
        debugLog(formatDebugMessage(DebugEmojis.ROCKET, 'Command: claude-autopilot.addMessage'));
        
        const message = await showInput({
            prompt: 'Enter message to add to Claude queue',
            placeholder: 'Type your message here...'
        });
        
        if (message && message.trim()) {
            addMessageToQueueFromWebview(message.trim());
            showInfo(Messages.MESSAGE_ADDED);
        }
    }

    static async handleStartWebInterface(): Promise<void> {
        debugLog(formatDebugMessage(DebugEmojis.NETWORK, 'Command: claude-autopilot.startWebInterface'));
        
        try {
            const webServer = getMobileServer();
            if (webServer.isRunning()) {
                showInfo('Web interface is already running');
                return;
            }

            const webUrl = await webServer.start();
            await webServer.generateQRCode();
            
            showInfo(Messages.WEB_INTERFACE_STARTED(webUrl));
        } catch (error) {
            showErrorFromException(error, Messages.FAILED_TO_START_WEB_INTERFACE);
        }
    }

    static async handleStopWebInterface(): Promise<void> {
        debugLog(formatDebugMessage(DebugEmojis.STOP, 'Command: claude-autopilot.stopWebInterface'));
        
        try {
            const webServer = getMobileServer();
            if (!webServer.isRunning()) {
                showError('Web interface is not running');
                return;
            }

            await webServer.stop();
            showInfo(Messages.WEB_INTERFACE_STOPPED);
        } catch (error) {
            showErrorFromException(error, Messages.FAILED_TO_STOP_WEB_INTERFACE);
        }
    }

    static async handleShowQR(): Promise<void> {
        debugLog(formatDebugMessage(DebugEmojis.SEARCH, 'Command: claude-autopilot.showWebInterfaceQR'));
        
        try {
            const webServer = getMobileServer();
            if (!webServer.isRunning()) {
                showError(Messages.WEB_INTERFACE_NOT_RUNNING);
                return;
            }

            const qrCode = await webServer.generateQRCode();
            
            // Create and show webview panel with QR code
            const panel = vscode.window.createWebviewPanel(
                'claudeQRCode',
                'Claude Autopilot - Mobile QR Code',
                vscode.ViewColumn.One,
                { enableScripts: false }
            );

            panel.webview.html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Claude Autopilot QR Code</title>
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            text-align: center; 
                            padding: 20px; 
                            background: var(--vscode-editor-background);
                            color: var(--vscode-editor-foreground);
                        }
                        .qr-container {
                            display: inline-block;
                            padding: 20px;
                            background: white;
                            border-radius: 8px;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                            margin: 20px 0;
                        }
                        h1 { color: var(--vscode-editor-foreground); }
                        .url { 
                            font-family: monospace; 
                            background: var(--vscode-textCodeBlock-background);
                            padding: 8px 12px;
                            border-radius: 4px;
                            display: inline-block;
                            margin: 10px 0;
                        }
                    </style>
                </head>
                <body>
                    <h1>🚀 Claude Autopilot Mobile Interface</h1>
                    <p>Scan this QR code with your mobile device to access the interface:</p>
                    <div class="qr-container">
                        <img src="${qrCode}" alt="QR Code for Mobile Interface" />
                    </div>
                    <p>Or visit directly:</p>
                    <div class="url">${webServer.getWebUrl()}</div>
                </body>
                </html>
            `;
        } catch (error) {
            showErrorFromException(error, Messages.FAILED_TO_SHOW_QR);
        }
    }
}