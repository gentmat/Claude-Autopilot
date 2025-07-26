/**
 * API routes for the mobile server
 */
import { Request, Response, Application } from 'express';
import { spawn } from 'child_process';
import { 
    addMessageToQueueFromWebview,
    removeMessageFromQueue,
    editMessageInQueue,
    duplicateMessageInQueue
} from '../../queue/manager';
import { 
    startProcessingQueue, 
    stopProcessingQueue 
} from '../../claude/communication';
import { resetClaudeSession, handleClaudeKeypress } from '../../claude/session';
import { 
    messageQueue, 
    isRunning, 
    claudeOutputBuffer, 
    processingQueue,
    sessionReady,
    currentMessage
} from '../../core/state';
import { AuthConfig, AuthManager } from './auth';
import { FileExplorer } from './file-explorer';
import { getErrorMessage } from '../../utils/error-handler';

export class APIRoutes {
    private fileExplorer: FileExplorer;
    private authConfig: AuthConfig;

    constructor(authConfig: AuthConfig) {
        this.authConfig = authConfig;
        this.fileExplorer = new FileExplorer();
    }

    setupRoutes(app: Application): void {
        // Status API
        app.get('/api/status', (req: Request, res: Response) => {
            res.json({
                isRunning: isRunning,
                processingQueue: processingQueue,
                sessionReady: sessionReady,
                currentMessage: currentMessage,
                queueLength: messageQueue.length
            });
        });

        // Queue management APIs
        app.get('/api/queue', (req: Request, res: Response) => {
            res.json(messageQueue);
        });

        app.post('/api/queue/add', (req: Request, res: Response) => {
            try {
                const { text } = req.body;
                if (!text || typeof text !== 'string' || text.trim().length === 0) {
                    return res.status(400).json({ error: 'Message text is required' });
                }

                addMessageToQueueFromWebview(text.trim());
                res.json({ success: true, message: 'Message added to queue' });
            } catch (error) {
                console.error('Error adding message to queue:', error);
                res.status(500).json({ error: 'Failed to add message to queue' });
            }
        });

        app.put('/api/queue/:id', (req: Request, res: Response) => {
            try {
                const messageId = req.params.id;
                const { text } = req.body;

                if (!text || typeof text !== 'string' || text.trim().length === 0) {
                    return res.status(400).json({ error: 'Message text is required' });
                }

                editMessageInQueue(messageId, text.trim());
                res.json({ success: true, message: 'Message updated' });
            } catch (error) {
                console.error('Error editing message:', error);
                res.status(500).json({ error: 'Failed to edit message' });
            }
        });

        app.delete('/api/queue/:id', (req: Request, res: Response) => {
            try {
                const messageId = req.params.id;
                removeMessageFromQueue(messageId);
                res.json({ success: true, message: 'Message removed from queue' });
            } catch (error) {
                console.error('Error removing message:', error);
                res.status(500).json({ error: 'Failed to remove message' });
            }
        });

        app.post('/api/queue/:id/duplicate', (req: Request, res: Response) => {
            try {
                const messageId = req.params.id;
                duplicateMessageInQueue(messageId);
                res.json({ success: true, message: 'Message duplicated' });
            } catch (error) {
                console.error('Error duplicating message:', error);
                res.status(500).json({ error: 'Failed to duplicate message' });
            }
        });

        // Control APIs
        app.post('/api/control/start', async (req: Request, res: Response) => {
            try {
                await startProcessingQueue();
                res.json({ success: true, message: 'Processing started' });
            } catch (error) {
                console.error('Error starting processing:', error);
                res.status(500).json({ error: 'Failed to start processing' });
            }
        });

        app.post('/api/control/stop', async (req: Request, res: Response) => {
            try {
                stopProcessingQueue();
                res.json({ success: true, message: 'Processing stopped' });
            } catch (error) {
                console.error('Error stopping processing:', error);
                res.status(500).json({ error: 'Failed to stop processing' });
            }
        });

        app.post('/api/control/reset', async (req: Request, res: Response) => {
            try {
                await resetClaudeSession();
                res.json({ success: true, message: 'Session reset' });
            } catch (error) {
                console.error('Error resetting session:', error);
                res.status(500).json({ error: 'Failed to reset session' });
            }
        });

        app.post('/api/control/interrupt', (req: Request, res: Response) => {
            try {
                handleClaudeKeypress('\x03'); // Ctrl+C
                res.json({ success: true, message: 'Interrupt signal sent' });
            } catch (error) {
                console.error('Error sending interrupt:', error);
                res.status(500).json({ error: 'Failed to send interrupt' });
            }
        });

        // Output API
        app.get('/api/output', (req: Request, res: Response) => {
            res.json({ output: claudeOutputBuffer });
        });

        // File Explorer APIs
        app.get('/api/files/tree', (req: Request, res: Response) => {
            this.fileExplorer.handleFileExplorer(req, res);
        });

        app.get('/api/files/content', (req: Request, res: Response) => {
            this.fileExplorer.handleFileContent(req, res);
        });

        // Git APIs
        app.get('/api/git/status', async (req: Request, res: Response) => {
            try {
                const result = await this.executeGitCommand(['status', '--porcelain']);
                res.json({ output: result });
            } catch (error) {
                console.error('Error getting git status:', error);
                const message = getErrorMessage(error) || 'Failed to get git status';
                res.status(500).json({ error: message });
            }
        });

        app.get('/api/git/file-diff', async (req: Request, res: Response) => {
            try {
                const filePath = req.query.file as string;
                if (!filePath) {
                    return res.status(400).json({ error: 'File path is required' });
                }

                const result = await this.executeGitCommand(['diff', 'HEAD', '--', filePath]);
                res.json({ output: result, file: filePath });
            } catch (error) {
                console.error('Error getting file diff:', error);
                const message = getErrorMessage(error) || 'Failed to get file diff';
                res.status(500).json({ error: message });
            }
        });

        // Authentication API
        app.post('/api/auth/login', (req: Request, res: Response) => {
            try {
                const { password } = req.body;
                const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
                
                if (!password) {
                    return res.status(400).json({ error: 'Password is required' });
                }

                const result = AuthManager.validatePassword(
                    password, 
                    this.authConfig.webPassword, 
                    this.authConfig, 
                    clientIp
                );

                if (result.valid && result.sessionToken) {
                    // Set session cookie
                    res.cookie('sessionToken', result.sessionToken, {
                        httpOnly: true,
                        secure: false, // Set to true if using HTTPS
                        sameSite: 'lax',
                        maxAge: 24 * 60 * 60 * 1000 // 24 hours
                    });

                    res.json({ 
                        success: true, 
                        message: 'Login successful',
                        sessionToken: result.sessionToken 
                    });
                } else {
                    res.status(401).json({ 
                        error: result.error || 'Invalid password' 
                    });
                }
            } catch (error) {
                console.error('Error during login:', error);
                res.status(500).json({ error: 'Login failed' });
            }
        });
    }

    private executeGitCommand(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const gitProcess = spawn('git', args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: process.cwd()
            });

            let stdout = '';
            let stderr = '';

            gitProcess.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            gitProcess.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            gitProcess.on('close', (code: number | null) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr || `Git command failed with code ${code}`));
                }
            });

            gitProcess.on('error', (error: Error) => {
                reject(error);
            });
        });
    }
}