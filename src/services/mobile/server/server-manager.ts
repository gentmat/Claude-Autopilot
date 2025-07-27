import express from 'express';
import cookieParser from 'cookie-parser';
import * as http from 'http';
import { AddressInfo } from 'net';
import { NetworkInterfaceInfo } from 'os';
import * as ngrok from 'ngrok';
import * as QRCode from 'qrcode';
import { debugLog } from '../../../utils/logging';
import { AuthManager, AuthConfig } from '../auth/';

export class ServerManager {
    private app: express.Application;
    private server: http.Server | null = null;
    private ngrokUrl: string | null = null;
    private isServerRunning = false;
    private authManager: AuthManager;
    private config: AuthConfig;

    constructor(authManager: AuthManager, config: AuthConfig) {
        this.app = express();
        this.authManager = authManager;
        this.config = config;
        this.setupMiddleware();
    }

    public updateConfig(config: AuthConfig): void {
        this.config = config;
        this.authManager.updateConfig(config);
    }

    private setupMiddleware(): void {
        this.app.use(express.json());
        this.app.use(cookieParser());
        
        // Basic auth middleware for API routes only
        this.app.use('/api', this.authManager.getApiAuthMiddleware());

        // Apply password middleware to API routes for external server
        if (this.config.useExternalServer && this.config.webPassword) {
            this.app.use('/api', this.authManager.getPasswordAuthMiddleware());
        }
    }

    public getApp(): express.Application {
        return this.app;
    }

    public async start(): Promise<string> {
        if (this.isServerRunning) {
            throw new Error('Web server is already running');
        }

        return new Promise((resolve, reject) => {
            this.server = this.app.listen(0, '0.0.0.0', async () => {
                try {
                    const address = this.server?.address() as AddressInfo;
                    const port = address?.port;
                    if (!port) {
                        throw new Error('Failed to get server port');
                    }
                    debugLog(`🌐 Web server started on port ${port}`);
                    
                    let publicUrl: string;
                    
                    if (this.config.useExternalServer) {
                        this.ngrokUrl = await ngrok.connect({
                            port,
                            region: 'us'
                        });
                        publicUrl = this.ngrokUrl;
                        debugLog(`🌍 External server (ngrok): ${this.ngrokUrl}`);
                    } else {
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

        if (this.server) {
            await new Promise<void>((resolve) => {
                this.server!.close(() => resolve());
            });
            this.server = null;
        }

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
        
        if (this.config.useExternalServer && this.ngrokUrl) {
            return this.ngrokUrl;
        }
        
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
            isExternal: this.config.useExternalServer,
            hasPassword: this.config.useExternalServer && !!this.config.webPassword,
            blockedIPs: this.authManager.getBlockedIPsCount()
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
        
        const webUrl = `${baseUrl}?token=${this.config.authToken}`;
        return webUrl;
    }

    public isRunning(): boolean {
        return this.isServerRunning;
    }

    public getHttpServer(): http.Server | null {
        return this.server;
    }
}