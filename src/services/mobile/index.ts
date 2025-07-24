import * as vscode from 'vscode';
import express, { Request, Response, NextFunction } from 'express';
import * as WebSocket from 'ws';
import * as http from 'http';
import { AddressInfo } from 'net';
import { NetworkInterfaceInfo } from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as ngrok from 'ngrok';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { debugLog } from '../../utils/logging';
import { 
    messageQueue, 
    isRunning, 
    claudeOutputBuffer, 
    processingQueue,
    sessionReady,
    currentMessage,
    setProcessingQueue,
    setIsRunning
} from '../../core/state';
import { 
    addMessageToQueueFromWebview,
    removeMessageFromQueue,
    editMessageInQueue,
    duplicateMessageInQueue,
    clearMessageQueue
} from '../../queue/manager';
import { startClaudeSession } from '../../claude/session';
import { startProcessingQueue, stopProcessingQueue } from '../../claude/communication';

export class MobileServer {
    private app: express.Application;
    private server: http.Server | null = null;
    private wss: WebSocket.Server | null = null;
    private ngrokUrl: string | null = null;
    private authToken: string;
    private clients: Set<WebSocket> = new Set();
    private isServerRunning = false;
    private useExternalServer = false;
    private webPassword = '';
    private passwordAttempts = new Map<string, number>();
    private blockedIPs = new Set<string>();

    constructor() {
        this.app = express();
        this.authToken = uuidv4();
        this.loadConfiguration();
        this.setupMiddleware();
        this.setupRoutes();
    }

    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('claudeAutopilot');
        this.useExternalServer = config.get<boolean>('webInterface.useExternalServer', false);
        this.webPassword = config.get<string>('webInterface.password', '');
    }

    private getWorkspaceInfo(): { name: string; path: string } {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return {
                name: workspaceFolder.name,
                path: workspaceFolder.uri.fsPath
            };
        }
        return {
            name: 'No Workspace',
            path: process.cwd()
        };
    }

    private setupMiddleware(): void {
        this.app.use(express.json());
        
        // DO NOT USE express.static - it bypasses authentication!
        // Static files will be served individually with authentication
        
        // Basic auth middleware for API routes only
        this.app.use('/api', (req: Request, res: Response, next: NextFunction) => {
            const token = req.headers.authorization?.replace('Bearer ', '');
            if (token !== this.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            next();
        });

        // Apply password middleware to API routes for external server
        if (this.useExternalServer && this.webPassword) {
            this.app.use('/api', this.passwordAuthMiddleware.bind(this));
        }
    }

    private passwordAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
        const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
        
        // Check if IP is blocked
        if (this.blockedIPs.has(clientIP)) {
            res.status(403).json({ error: 'IP blocked due to too many failed attempts' });
            return;
        }

        // Skip auth for main route, password route, and login endpoint
        if (req.path === '/' || req.path === '/password' || req.path === '/api/auth/login' || req.path === '/login.html') {
            return next();
        }

        // Check password in query, body, or headers
        const password = req.query.password || req.body?.password || req.headers['x-web-password'];
        
        if (!password || password !== this.webPassword) {
            const attempts = this.passwordAttempts.get(clientIP) || 0;
            this.passwordAttempts.set(clientIP, attempts + 1);
            
            if (attempts + 1 >= 5) {
                this.blockedIPs.add(clientIP);
                debugLog(`🚫 IP ${clientIP} blocked after 5 failed password attempts`);
                
                // Auto-shutdown server after blocking
                setTimeout(() => {
                    debugLog('🛑 Shutting down server due to security breach');
                    this.stop();
                }, 1000);
                
                res.status(403).json({ error: 'Too many failed attempts. Server shutting down.' });
                return;
            }
            
            res.status(401).json({ 
                error: 'Password required', 
                attemptsLeft: 5 - (attempts + 1) 
            });
            return;
        }

        // Reset attempts on successful auth
        this.passwordAttempts.delete(clientIP);
        next();
    }

    private checkPasswordForStaticFiles(req: Request, res: Response): boolean {
        // If external server with password is enabled, check password
        if (this.useExternalServer && this.webPassword) {
            const password = req.query.password || req.body?.password || req.headers['x-web-password'];
            const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
            
            if (!password || password !== this.webPassword) {
                // Check if IP is blocked
                if (this.blockedIPs.has(clientIP)) {
                    res.status(403).json({ error: 'IP blocked due to too many failed attempts' });
                    return false;
                }

                const attempts = this.passwordAttempts.get(clientIP) || 0;
                this.passwordAttempts.set(clientIP, attempts + 1);
                
                if (attempts + 1 >= 5) {
                    this.blockedIPs.add(clientIP);
                    debugLog(`🚫 IP ${clientIP} blocked after 5 failed password attempts`);
                    
                    // Auto-shutdown server after blocking
                    setTimeout(() => {
                        debugLog('🛑 Shutting down server due to security breach');
                        this.stop();
                    }, 1000);
                    
                    res.status(403).json({ error: 'Too many failed attempts. Server shutting down.' });
                    return false;
                }
                
                res.status(401).json({ 
                    error: 'Password required', 
                    attemptsLeft: 5 - (attempts + 1) 
                });
                return false;
            }

            // Reset attempts on successful auth
            this.passwordAttempts.delete(clientIP);
        }
        
        return true;
    }

    private setupRoutes(): void {
        // Serve mobile interface
        this.app.get('/', (req: Request, res: Response) => {
            // Check if token is provided in URL
            const token = req.query.token;
            if (token !== this.authToken) {
                return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication token' });
            }
            
            // Check if password is required and not provided
            if (this.useExternalServer && this.webPassword) {
                const password = req.query.password;
                if (!password || password !== this.webPassword) {
                    return res.redirect(`/password?token=${this.authToken}`);
                }
            }
            
            // Read the HTML file and inject the token
            const htmlPath = path.join(__dirname, '../../webview/mobile/index.html');
            let html = fs.readFileSync(htmlPath, 'utf8');
            
            // Inject the token into the HTML and update static file URLs
            html = html.replace('href="styles.css"', `href="styles.css?token=${this.authToken}"`);
            html = html.replace('src="script.js"', `src="script.js?token=${this.authToken}"`);
            html = html.replace('href="manifest.json"', `href="manifest.json?token=${this.authToken}"`);
            
            html = html.replace('</head>', `
                <script>
                    window.CLAUDE_AUTH_TOKEN = '${this.authToken}';
                </script>
                </head>
            `);
            
            res.send(html);
        });

        // Serve password entry page
        this.app.get('/password', (req: Request, res: Response) => {
            const token = req.query.token;
            if (token !== this.authToken) {
                return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication token' });
            }
            
            const htmlPath = path.join(__dirname, '../../webview/mobile/password.html');
            const html = fs.readFileSync(htmlPath, 'utf8');
            res.send(html);
        });

        // Serve static files with token authentication
        this.app.get('/manifest.json', (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            if (token !== this.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            // Check password for external server
            if (!this.checkPasswordForStaticFiles(req, res)) {
                return; // Response already sent by checkPasswordForStaticFiles
            }
            
            res.sendFile(path.join(__dirname, '../../webview/mobile/manifest.json'));
        });

        this.app.get('/sw.js', (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            if (token !== this.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            // Check password for external server
            if (!this.checkPasswordForStaticFiles(req, res)) {
                return; // Response already sent by checkPasswordForStaticFiles
            }
            
            res.setHeader('Content-Type', 'application/javascript');
            res.sendFile(path.join(__dirname, '../../webview/mobile/sw.js'));
        });

        // Protect CSS and JS files
        this.app.get('/styles.css', (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            if (token !== this.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            // Check password for external server
            if (!this.checkPasswordForStaticFiles(req, res)) {
                return; // Response already sent by checkPasswordForStaticFiles
            }
            
            res.setHeader('Content-Type', 'text/css');
            res.sendFile(path.join(__dirname, '../../webview/mobile/styles.css'));
        });

        this.app.get('/script.js', (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            if (token !== this.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            // Check password for external server
            if (!this.checkPasswordForStaticFiles(req, res)) {
                return; // Response already sent by checkPasswordForStaticFiles
            }
            
            res.setHeader('Content-Type', 'application/javascript');
            res.sendFile(path.join(__dirname, '../../webview/mobile/script.js'));
        });

        // API Routes
        this.app.get('/api/status', (req: Request, res: Response) => {
            const workspace = this.getWorkspaceInfo();
            res.json({
                isRunning,
                sessionReady,
                processingQueue,
                queueLength: messageQueue.length,
                currentMessage: currentMessage?.text?.substring(0, 100) || null,
                workspace: workspace
            });
        });

        this.app.get('/api/queue', (req: Request, res: Response) => {
            res.json(messageQueue.map(msg => ({
                id: msg.id,
                text: msg.text.substring(0, 200) + (msg.text.length > 200 ? '...' : ''),
                status: msg.status,
                timestamp: msg.timestamp,
                output: msg.output?.substring(0, 500) || null
            })));
        });

        this.app.post('/api/queue/add', (req: Request, res: Response) => {
            const { message } = req.body;
            if (!message || typeof message !== 'string') {
                return res.status(400).json({ error: 'Message is required' });
            }
            
            try {
                addMessageToQueueFromWebview(message);
                this.broadcastToClients({ type: 'queue_update', queue: this.getQueueData() });
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to add message' });
            }
        });

        this.app.put('/api/queue/:id', (req: Request, res: Response) => {
            const { id } = req.params;
            const { text } = req.body;
            
            if (!text || typeof text !== 'string') {
                return res.status(400).json({ error: 'Text is required' });
            }
            
            try {
                editMessageInQueue(id, text);
                this.broadcastToClients({ type: 'queue_update', queue: this.getQueueData() });
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to edit message' });
            }
        });

        this.app.delete('/api/queue/:id', (req: Request, res: Response) => {
            const { id } = req.params;
            
            try {
                removeMessageFromQueue(id);
                this.broadcastToClients({ type: 'queue_update', queue: this.getQueueData() });
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to remove message' });
            }
        });

        this.app.post('/api/queue/:id/duplicate', (req: Request, res: Response) => {
            const { id } = req.params;
            
            try {
                duplicateMessageInQueue(id);
                this.broadcastToClients({ type: 'queue_update', queue: this.getQueueData() });
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to duplicate message' });
            }
        });

        this.app.post('/api/control/start', async (req: Request, res: Response) => {
            try {
                if (!sessionReady) {
                    await startClaudeSession(true);
                }
                await startProcessingQueue(true);
                this.broadcastToClients({ 
                    type: 'status_update', 
                    status: { isRunning: true, processingQueue: true }
                });
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to start Claude' });
            }
        });

        this.app.post('/api/control/stop', async (req: Request, res: Response) => {
            try {
                stopProcessingQueue();
                setProcessingQueue(false);
                setIsRunning(false);
                this.broadcastToClients({ 
                    type: 'status_update', 
                    status: { isRunning: false, processingQueue: false }
                });
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to stop Claude' });
            }
        });

        this.app.post('/api/control/reset', async (req: Request, res: Response) => {
            try {
                stopProcessingQueue();
                clearMessageQueue();
                setProcessingQueue(false);
                setIsRunning(false);
                this.broadcastToClients({ 
                    type: 'status_update', 
                    status: { isRunning: false, processingQueue: false }
                });
                this.broadcastToClients({ type: 'queue_update', queue: [] });
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to reset' });
            }
        });

        this.app.get('/api/output', (req: Request, res: Response) => {
            res.json({
                output: claudeOutputBuffer,
                timestamp: Date.now()
            });
        });

        // Login endpoint for password authentication
        this.app.post('/api/auth/login', (req: Request, res: Response) => {
            // Validate token first (since it's excluded from the main middleware)
            const token = req.headers.authorization?.replace('Bearer ', '');
            if (token !== this.authToken) {
                return res.status(401).json({ error: 'Unauthorized: Invalid token' });
            }
            
            const { password } = req.body;
            const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
            
            if (this.blockedIPs.has(clientIP)) {
                return res.status(403).json({ error: 'IP blocked' });
            }
            
            if (!this.webPassword || password === this.webPassword) {
                this.passwordAttempts.delete(clientIP);
                res.json({ success: true, token: this.authToken });
            } else {
                const attempts = this.passwordAttempts.get(clientIP) || 0;
                this.passwordAttempts.set(clientIP, attempts + 1);
                
                if (attempts + 1 >= 5) {
                    this.blockedIPs.add(clientIP);
                    setTimeout(() => this.stop(), 1000);
                    return res.status(403).json({ error: 'Too many attempts. Server shutting down.' });
                }
                
                res.status(401).json({ 
                    error: 'Invalid password', 
                    attemptsLeft: 5 - (attempts + 1) 
                });
            }
        });

        this.app.post('/api/control/interrupt', (req: Request, res: Response) => {
            try {
                // Import handleClaudeKeypress from Claude session
                const { handleClaudeKeypress } = require('../../claude/session');
                handleClaudeKeypress('escape');
                res.json({ success: true });
            } catch (error) {
                console.error('Error interrupting Claude:', error);
                res.status(500).json({ error: 'Failed to interrupt Claude' });
            }
        });
    }

    private setupWebSocket(): void {
        if (!this.server) return;

        this.wss = new WebSocket.Server({ 
            server: this.server,
            path: '/ws'
        });
        
        this.wss.on('connection', (ws: WebSocket, req) => {
            // Simple auth check for WebSocket
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            const token = url.searchParams.get('token');
            
            if (token !== this.authToken) {
                ws.close(1008, 'Unauthorized');
                return;
            }

            debugLog('📱 Mobile client connected');
            this.clients.add(ws);

            // Send initial state
            const workspace = this.getWorkspaceInfo();
            ws.send(JSON.stringify({
                type: 'initial_state',
                data: {
                    status: { isRunning, sessionReady, processingQueue, workspace },
                    queue: this.getQueueData(),
                    output: claudeOutputBuffer
                }
            }));

            ws.on('close', () => {
                debugLog('📱 Mobile client disconnected');
                this.clients.delete(ws);
            });

            ws.on('error', (error: Error) => {
                this.clients.delete(ws);
            });
        });
    }

    private getQueueData() {
        return messageQueue.map(msg => ({
            id: msg.id,
            text: msg.text.substring(0, 200) + (msg.text.length > 200 ? '...' : ''),
            status: msg.status,
            timestamp: msg.timestamp
        }));
    }

    private broadcastToClients(message: any): void {
        const messageStr = JSON.stringify(message);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }

    public async start(): Promise<string> {
        if (this.isServerRunning) {
            throw new Error('Web server is already running');
        }

        this.loadConfiguration(); // Reload config in case it changed

        return new Promise((resolve, reject) => {
            this.server = this.app.listen(0, '0.0.0.0', async () => {
                try {
                    const address = this.server?.address() as AddressInfo;
                    const port = address?.port;
                    if (!port) {
                        throw new Error('Failed to get server port');
                    }
                    debugLog(`🌐 Web server started on port ${port}`);
                    
                    this.setupWebSocket();
                    
                    let publicUrl: string;
                    
                    if (this.useExternalServer) {
                        // Create ngrok tunnel for external access
                        this.ngrokUrl = await ngrok.connect({
                            port,
                            region: 'us'
                        });
                        publicUrl = this.ngrokUrl;
                        debugLog(`🌍 External server (ngrok): ${this.ngrokUrl}`);
                    } else {
                        // Use local network IP
                        const networkInterfaces = require('os').networkInterfaces();
                        let localIP = 'localhost';
                        
                        for (const [name, interfaces] of Object.entries(networkInterfaces)) {
                            if (interfaces) {
                                for (const iface of interfaces as NetworkInterfaceInfo[]) {
                                    if (iface.family === 'IPv4' && !iface.internal) {
                                        localIP = iface.address;
                                        break;
                                    }
                                }
                                if (localIP !== 'localhost') break;
                            }
                        }
                        
                        publicUrl = `http://${localIP}:${port}`;
                        debugLog(`🏠 Local network server: ${publicUrl}`);
                    }
                    
                    this.isServerRunning = true;
                    resolve(publicUrl);
                } catch (error) {
                    debugLog(`❌ Failed to start web server: ${error}`);
                    reject(error);
                }
            });

            this.server.on('error', (error) => {
                debugLog(`❌ Web server error: ${error}`);
                reject(error);
            });
        });
    }

    public async stop(): Promise<void> {
        if (!this.isServerRunning) {
            return;
        }

        // Close all WebSocket connections
        this.clients.forEach(client => {
            client.close();
        });
        this.clients.clear();

        // Close WebSocket server
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }

        // Close HTTP server
        if (this.server) {
            await new Promise<void>((resolve) => {
                this.server!.close(() => resolve());
            });
            this.server = null;
        }

        // Close ngrok tunnel
        if (this.ngrokUrl) {
            try {
                await ngrok.disconnect();
                await ngrok.kill();
            } catch (error) {
                // Ignore ngrok close errors
            }
            this.ngrokUrl = null;
        }

        this.isServerRunning = false;
        debugLog('📱 Mobile server stopped');
    }

    public async generateQRCode(): Promise<string> {
        if (!this.isServerRunning) {
            throw new Error('Web server is not running');
        }

        const webUrl = this.getWebUrl();
        if (!webUrl) {
            throw new Error('Failed to get web URL for QR code');
        }
        
        debugLog(`📱 QR Code URL: ${webUrl}`);
        
        return QRCode.toDataURL(webUrl, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });
    }

    public getServerUrl(): string {
        if (!this.isServerRunning) {
            return '';
        }
        
        if (this.useExternalServer && this.ngrokUrl) {
            return this.ngrokUrl;
        }
        
        // Return local network URL
        const address = this.server?.address() as AddressInfo;
        const port = address?.port;
        if (!port) return '';
        
        const networkInterfaces = require('os').networkInterfaces();
        let localIP = 'localhost';
        
        for (const [name, interfaces] of Object.entries(networkInterfaces)) {
            if (interfaces) {
                for (const iface of interfaces as NetworkInterfaceInfo[]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        localIP = iface.address;
                        break;
                    }
                }
                if (localIP !== 'localhost') break;
            }
        }
        
        return `http://${localIP}:${port}`;
    }

    public getServerStatus(): { 
        running: boolean; 
        url: string; 
        isExternal: boolean; 
        hasPassword: boolean;
        blockedIPs: number;
    } {
        return {
            running: this.isServerRunning,
            url: this.getServerUrl(),
            isExternal: this.useExternalServer,
            hasPassword: !!this.webPassword,
            blockedIPs: this.blockedIPs.size
        };
    }

    public getWebUrl(): string | null {
        if (!this.isServerRunning) {
            return null;
        }
        
        const baseUrl = this.getServerUrl();
        if (!baseUrl) {
            return null;
        }
        
        // SECURITY: Only include token in URL, never password
        // Password should be entered separately by the user
        const webUrl = `${baseUrl}?token=${this.authToken}`;
        
        return webUrl;
    }

    public getAuthToken(): string {
        return this.authToken;
    }

    public isRunning(): boolean {
        return this.isServerRunning;
    }

    // Method to notify mobile clients of changes
    public notifyQueueUpdate(): void {
        this.broadcastToClients({ type: 'queue_update', queue: this.getQueueData() });
    }

    public notifyStatusUpdate(): void {
        const workspace = this.getWorkspaceInfo();
        this.broadcastToClients({ 
            type: 'status_update', 
            status: { isRunning, sessionReady, processingQueue, workspace }
        });
    }

    public notifyOutputUpdate(): void {
        this.broadcastToClients({ 
            type: 'output_update', 
            output: claudeOutputBuffer,
            timestamp: Date.now()
        });
    }
}

// Singleton instance
let mobileServerInstance: MobileServer | null = null;

export function getMobileServer(): MobileServer {
    if (!mobileServerInstance) {
        mobileServerInstance = new MobileServer();
    }
    return mobileServerInstance;
}