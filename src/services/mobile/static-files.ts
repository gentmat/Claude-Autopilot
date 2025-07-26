/**
 * Static file serving utilities for the mobile server
 */
import { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { AuthConfig, AuthManager } from './auth';

export class StaticFileHandler {
    private authToken: string;
    private authConfig: AuthConfig;

    constructor(authToken: string, authConfig: AuthConfig) {
        this.authToken = authToken;
        this.authConfig = authConfig;
    }

    serveMainPage(req: Request, res: Response) {
        // Check if password is required and session is not authenticated
        if (this.authConfig.useExternalServer && this.authConfig.webPassword) {
            const sessionToken = req.headers['x-session-token'] as string || (req as any).cookies?.sessionToken;
            if (!sessionToken || !this.authConfig.activeSessions.has(sessionToken)) {
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
    }

    servePasswordPage(req: Request, res: Response) {
        const htmlPath = path.join(__dirname, '../../webview/mobile/password.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        res.send(html);
    }

    serveManifest(req: Request, res: Response) {
        // Check password for external server
        if (!AuthManager.checkPasswordForStaticFiles(req, res, this.authConfig)) {
            return; // Response already sent by checkPasswordForStaticFiles
        }
        
        res.sendFile(path.join(__dirname, '../../webview/mobile/manifest.json'));
    }

    serveServiceWorker(req: Request, res: Response) {
        // Check password for external server
        if (!AuthManager.checkPasswordForStaticFiles(req, res, this.authConfig)) {
            return; // Response already sent by checkPasswordForStaticFiles
        }
        
        res.setHeader('Content-Type', 'application/javascript');
        res.sendFile(path.join(__dirname, '../../webview/mobile/sw.js'));
    }

    serveCSS(req: Request, res: Response) {
        // Check password for external server
        if (!AuthManager.checkPasswordForStaticFiles(req, res, this.authConfig)) {
            return; // Response already sent by checkPasswordForStaticFiles
        }
        
        const filePath = path.join(__dirname, '../../webview/mobile/styles.css');
        
        if (!fs.existsSync(filePath)) {
            console.error('styles.css not found at expected path:', filePath);
            return res.status(404).send('styles.css not found');
        }
        
        res.setHeader('Content-Type', 'text/css');
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            res.send(content);
        } catch (error) {
            console.error('Error reading styles.css:', error);
            res.status(500).send('Error loading styles');
        }
    }

    serveJavaScript(req: Request, res: Response) {
        // Check password for external server
        if (!AuthManager.checkPasswordForStaticFiles(req, res, this.authConfig)) {
            return; // Response already sent by checkPasswordForStaticFiles
        }
        
        const filePath = path.join(__dirname, '../../webview/mobile/script.js');
        
        if (!fs.existsSync(filePath)) {
            console.error('script.js not found at expected path:', filePath);
            return res.status(404).send('script.js not found');
        }
        
        res.setHeader('Content-Type', 'application/javascript');
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            res.send(content);
        } catch (error) {
            console.error('Error reading script.js:', error);
            res.status(500).send('Error loading script');
        }
    }

    serveDebugScript(req: Request, res: Response) {
        // Check password for external server
        if (!AuthManager.checkPasswordForStaticFiles(req, res, this.authConfig)) {
            return; // Response already sent by checkPasswordForStaticFiles
        }
        
        const filePath = path.join(__dirname, '../../webview/mobile/debug.js');
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('debug.js not found');
        }
        
        res.setHeader('Content-Type', 'application/javascript');
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            res.send(content);
        } catch (error) {
            console.error('Error reading debug.js:', error);
            res.status(500).send('Error loading debug script');
        }
    }
}