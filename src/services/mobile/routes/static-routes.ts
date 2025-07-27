import { Application, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { AuthManager, AuthConfig } from '../auth/';

export class StaticRoutes {
    private authManager: AuthManager;
    private config: AuthConfig;

    constructor(authManager: AuthManager, config: AuthConfig) {
        this.authManager = authManager;
        this.config = config;
    }

    public updateConfig(config: AuthConfig): void {
        this.config = config;
        this.authManager.updateConfig(config);
    }

    public setupRoutes(app: Application): void {
        app.get('/', (req: Request, res: Response) => {
            const token = req.query.token;
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication token' });
            }
            
            if (this.config.useExternalServer && this.config.webPassword) {
                const sessionToken = req.headers['x-session-token'] as string || (req as any).cookies?.sessionToken;
                if (!sessionToken || !this.authManager.hasActiveSession(sessionToken)) {
                    return res.redirect(`/password?token=${this.config.authToken}`);
                }
            }
            
            const htmlPath = path.join(__dirname, '../../../webview/mobile/index.html');
            let html = fs.readFileSync(htmlPath, 'utf8');
            
            html = html.replace('href="styles.css"', `href="styles.css?token=${this.config.authToken}"`);
            html = html.replace('src="script.js"', `src="script.js?token=${this.config.authToken}"`);
            html = html.replace('href="manifest.json"', `href="manifest.json?token=${this.config.authToken}"`);
            
            html = html.replace('</head>', `
                <script>
                    window.CLAUDE_AUTH_TOKEN = '${this.config.authToken}';
                </script>
                </head>
            `);
            
            res.send(html);
        });

        app.get('/password', (req: Request, res: Response) => {
            const token = req.query.token;
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication token' });
            }
            
            const htmlPath = path.join(__dirname, '../../../webview/mobile/password.html');
            const html = fs.readFileSync(htmlPath, 'utf8');
            res.send(html);
        });

        app.get('/manifest.json', (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            if (!this.authManager.checkPasswordForStaticFiles(req, res)) {
                return;
            }
            
            res.sendFile(path.join(__dirname, '../../../webview/mobile/manifest.json'));
        });

        app.get('/sw.js', (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            if (!this.authManager.checkPasswordForStaticFiles(req, res)) {
                return;
            }
            
            res.setHeader('Content-Type', 'application/javascript');
            res.sendFile(path.join(__dirname, '../../../webview/mobile/sw.js'));
        });

        app.get('/styles.css', (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            if (!this.authManager.checkPasswordForStaticFiles(req, res)) {
                return;
            }
            
            const filePath = path.join(__dirname, '../../../webview/mobile/styles.css');
            
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

        app.get('/script.js', (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            if (!this.authManager.checkPasswordForStaticFiles(req, res)) {
                return;
            }
            
            const filePath = path.join(__dirname, '../../../webview/mobile/script.js');
            
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
    }
}