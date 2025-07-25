import * as vscode from 'vscode';
import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import * as WebSocket from 'ws';
import * as http from 'http';
import { AddressInfo } from 'net';
import { NetworkInterfaceInfo } from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as ngrok from 'ngrok';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
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
    private activeSessions = new Set<string>();

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
        this.app.use(cookieParser());
        
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

        // Skip auth for login endpoint (path is relative to /api mount point)
        if (req.path === '/auth/login') {
            return next();
        }

        // Check for session token in headers or cookies
        const sessionToken = req.headers['x-session-token'] as string || (req as any).cookies?.sessionToken;
        
        if (!sessionToken || !this.activeSessions.has(sessionToken)) {
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
                error: 'Session expired. Please login again.', 
                attemptsLeft: 5 - (attempts + 1) 
            });
            return;
        }

        // Reset attempts on successful auth
        this.passwordAttempts.delete(clientIP);
        next();
    }

    private checkPasswordForStaticFiles(req: Request, res: Response): boolean {
        // If external server with password is enabled, check session
        if (this.useExternalServer && this.webPassword) {
            const sessionToken = req.headers['x-session-token'] as string || (req as any).cookies?.sessionToken;
            const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
            
            if (!sessionToken || !this.activeSessions.has(sessionToken)) {
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
                    error: 'Session expired. Please login again.', 
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
            
            // Check if password is required and session is not authenticated
            if (this.useExternalServer && this.webPassword) {
                const sessionToken = req.headers['x-session-token'] as string || (req as any).cookies?.sessionToken;
                if (!sessionToken || !this.activeSessions.has(sessionToken)) {
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
            
            const filePath = path.join(__dirname, '../../webview/mobile/styles.css');
            
            if (!fs.existsSync(filePath)) {
                console.error('styles.css not found at expected path:', filePath);
                return res.status(404).send('styles.css not found');
            }
            
            res.setHeader('Content-Type', 'text/css');
            
            try {
                const cssContent = fs.readFileSync(filePath, 'utf8');
                res.send(cssContent);
            } catch (error) {
                console.error('Error reading styles.css:', error);
                res.status(500).send('Error loading stylesheet');
            }
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
            
            const filePath = path.join(__dirname, '../../webview/mobile/script.js');
            
            if (!fs.existsSync(filePath)) {
                console.error('script.js not found at expected path:', filePath);
                return res.status(404).send('script.js not found');
            }
            
            res.setHeader('Content-Type', 'application/javascript');
            
            try {
                const jsContent = fs.readFileSync(filePath, 'utf8');
                res.send(jsContent);
            } catch (error) {
                console.error('Error reading script.js:', error);
                res.status(500).send('Error loading script');
            }
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

        // File Explorer API Endpoints
        this.app.get('/api/files/tree', (req: Request, res: Response) => {
            try {
                const requestPath = req.query.path as string || '';
                const maxDepth = Math.min(parseInt(req.query.maxDepth as string) || 3, 5); // Max 5 levels for performance
                
                // Security: Validate and sanitize path
                const workspaceRoot = this.getWorkspaceRoot();
                if (!workspaceRoot) {
                    return res.status(400).json({ error: 'No workspace available' });
                }
                
                const resolvedPath = this.validateAndResolvePath(workspaceRoot, requestPath);
                if (!resolvedPath) {
                    return res.status(403).json({ error: 'Invalid path or access denied' });
                }
                
                const items = this.buildFileTree(resolvedPath, maxDepth, 0);
                
                res.json({
                    items,
                    path: requestPath,
                    total: this.countItems(items)
                });
                
            } catch (error) {
                console.error('Error building file tree:', error);
                res.status(500).json({ error: 'Failed to load file tree' });
            }
        });

        this.app.get('/api/files/content', (req: Request, res: Response) => {
            try {
                const filePath = req.query.path as string;
                if (!filePath) {
                    return res.status(400).json({ error: 'File path is required' });
                }
                
                // Security: Validate and sanitize path
                const workspaceRoot = this.getWorkspaceRoot();
                if (!workspaceRoot) {
                    return res.status(400).json({ error: 'No workspace available' });
                }
                
                const resolvedPath = this.validateAndResolvePath(workspaceRoot, filePath);
                if (!resolvedPath) {
                    return res.status(403).json({ error: 'Invalid path or access denied' });
                }
                
                // Check if file exists and is actually a file
                if (!fs.existsSync(resolvedPath)) {
                    return res.status(404).json({ error: 'File not found' });
                }
                
                const stats = fs.statSync(resolvedPath);
                if (!stats.isFile()) {
                    return res.status(400).json({ error: 'Path is not a file' });
                }
                
                // Security: File size limit (100KB)
                const maxFileSize = 100 * 1024;
                if (stats.size > maxFileSize) {
                    return res.status(413).json({ 
                        error: 'File too large for preview',
                        maxSize: maxFileSize,
                        actualSize: stats.size
                    });
                }
                
                // Check if file is binary
                if (this.isBinaryFile(resolvedPath)) {
                    return res.status(415).json({ error: 'Binary files are not supported for preview' });
                }
                
                let content = fs.readFileSync(resolvedPath, 'utf8');
                const lines = content.split('\n');
                const maxLines = 1000;
                let truncated = false;
                
                if (lines.length > maxLines) {
                    content = lines.slice(0, maxLines).join('\n');
                    truncated = true;
                }
                
                const extension = path.extname(resolvedPath).toLowerCase();
                const language = this.getLanguageFromExtension(extension);
                
                res.json({
                    content,
                    language,
                    size: stats.size,
                    lines: lines.length,
                    truncated,
                    modified: stats.mtime.toISOString(),
                    extension
                });
                
            } catch (error) {
                console.error('Error reading file content:', error);
                res.status(500).json({ error: 'Failed to read file content' });
            }
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
                
                // Create session token
                const sessionToken = randomBytes(32).toString('hex');
                this.activeSessions.add(sessionToken);
                
                // Set session cookie and return success
                res.cookie('sessionToken', sessionToken, { 
                    httpOnly: true, 
                    secure: this.useExternalServer, // HTTPS in production
                    maxAge: 24 * 60 * 60 * 1000 // 24 hours
                });
                
                res.json({ success: true, sessionToken });
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

    // File Explorer Utility Methods
    private getWorkspaceRoot(): string | null {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder ? workspaceFolder.uri.fsPath : null;
    }

    private validateAndResolvePath(workspaceRoot: string, requestPath: string): string | null {
        try {
            // Remove leading slash and normalize
            const cleanPath = requestPath.replace(/^\/+/, '').replace(/\.\./g, '');
            const fullPath = path.resolve(workspaceRoot, cleanPath);
            
            // Security: Ensure path is within workspace
            if (!fullPath.startsWith(path.resolve(workspaceRoot))) {
                return null;
            }
            
            return fullPath;
        } catch (error) {
            return null;
        }
    }

    private buildFileTree(dirPath: string, maxDepth: number, currentDepth: number): any[] {
        if (currentDepth >= maxDepth) {
            return [];
        }

        const items: any[] = [];
        const ignorePatterns = [
            '.git', '.vscode', 'node_modules', '.DS_Store', 'Thumbs.db',
            '.gitignore', '.vscodeignore', 'out', 'dist', 'build', '.cache',
            '__pycache__', '*.pyc', '.env', '.env.local', '.next', 'coverage'
        ];

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            
            // Separate directories and files
            const directories = entries.filter(entry => entry.isDirectory());
            const files = entries.filter(entry => entry.isFile());
            
            // Sort directories first, then files
            const sortedEntries = [
                ...directories.sort((a, b) => a.name.localeCompare(b.name)),
                ...files.sort((a, b) => a.name.localeCompare(b.name))
            ];

            for (const entry of sortedEntries) {
                // Skip ignored patterns
                if (this.shouldIgnoreFile(entry.name, ignorePatterns)) {
                    continue;
                }

                const fullPath = path.join(dirPath, entry.name);
                const stats = fs.statSync(fullPath);
                const relativePath = path.relative(this.getWorkspaceRoot()!, fullPath);

                if (entry.isDirectory()) {
                    const item = {
                        name: entry.name,
                        type: 'directory',
                        path: '/' + relativePath.replace(/\\/g, '/'),
                        children: currentDepth < maxDepth - 1 ? this.buildFileTree(fullPath, maxDepth, currentDepth + 1) : [],
                        expanded: false,
                        size: 0,
                        modified: stats.mtime.toISOString()
                    };
                    items.push(item);
                } else {
                    const extension = path.extname(entry.name).toLowerCase();
                    const item = {
                        name: entry.name,
                        type: 'file',
                        path: '/' + relativePath.replace(/\\/g, '/'),
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        extension: extension
                    };
                    items.push(item);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
        }

        return items;
    }

    private shouldIgnoreFile(filename: string, ignorePatterns: string[]): boolean {
        for (const pattern of ignorePatterns) {
            if (pattern.includes('*')) {
                const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                if (regex.test(filename)) {
                    return true;
                }
            } else if (filename === pattern) {
                return true;
            }
        }
        return false;
    }

    private countItems(items: any[]): number {
        let count = items.length;
        for (const item of items) {
            if (item.children) {
                count += this.countItems(item.children);
            }
        }
        return count;
    }

    private isBinaryFile(filePath: string): boolean {
        try {
            const buffer = fs.readFileSync(filePath, { encoding: null });
            const sampleSize = Math.min(buffer.length, 512);
            
            for (let i = 0; i < sampleSize; i++) {
                const byte = buffer[i];
                // Check for null bytes (common in binary files) and other non-printable characters
                if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
                    return true;
                }
            }
            return false;
        } catch (error) {
            return true; // Assume binary if we can't read it
        }
    }

    private getLanguageFromExtension(extension: string): string {
        const languageMap: { [key: string]: string } = {
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.c': 'c',
            '.cpp': 'cpp',
            '.cxx': 'cpp',
            '.cc': 'cpp',
            '.h': 'c',
            '.hpp': 'cpp',
            '.cs': 'csharp',
            '.php': 'php',
            '.rb': 'ruby',
            '.go': 'go',
            '.rs': 'rust',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.html': 'html',
            '.htm': 'html',
            '.css': 'css',
            '.scss': 'scss',
            '.sass': 'sass',
            '.less': 'less',
            '.json': 'json',
            '.xml': 'xml',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.toml': 'toml',
            '.ini': 'ini',
            '.cfg': 'ini',
            '.conf': 'ini',
            '.sh': 'bash',
            '.bash': 'bash',
            '.zsh': 'bash',
            '.fish': 'bash',
            '.ps1': 'powershell',
            '.sql': 'sql',
            '.md': 'markdown',
            '.txt': 'text',
            '.log': 'text',
            '.dockerfile': 'dockerfile',
            '.gitignore': 'text',
            '.env': 'text'
        };
        
        return languageMap[extension] || 'text';
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