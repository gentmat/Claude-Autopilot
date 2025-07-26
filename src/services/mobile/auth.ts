/**
 * Authentication and middleware utilities for the mobile server
 */
import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { AUTH_BLOCK_DURATION } from '../../core/constants/timeouts';

export interface AuthConfig {
    useExternalServer: boolean;
    webPassword: string;
    authToken: string;
    passwordAttempts: Map<string, number>;
    blockedIPs: Set<string>;
    activeSessions: Set<string>;
}

export class AuthManager {
    private static readonly MAX_ATTEMPTS = 5;
    private static readonly BLOCK_DURATION = AUTH_BLOCK_DURATION;

    static generateAuthToken(): string {
        return randomBytes(32).toString('hex');
    }

    static generateSessionToken(): string {
        return randomBytes(16).toString('hex');
    }

    static createPasswordAuthMiddleware(config: AuthConfig) {
        return (req: Request, res: Response, next: NextFunction) => {
            // Skip authentication for certain routes
            const skipPaths = ['/password', '/auth'];
            if (skipPaths.some(path => req.path.startsWith(path))) {
                return next();
            }

            // Check if external server with password is enabled
            if (!config.useExternalServer || !config.webPassword) {
                return next();
            }

            const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
            
            // Check if IP is blocked
            if (config.blockedIPs.has(clientIp)) {
                return res.status(429).json({ 
                    error: 'Too many failed attempts. Please try again later.' 
                });
            }

            // Check session token in cookies and headers
            const sessionToken = req.headers['x-session-token'] as string || (req as any).cookies?.sessionToken;
            
            if (sessionToken && config.activeSessions.has(sessionToken)) {
                return next();
            }

            // Check if it's a static file request - redirect to password page
            if (req.path === '/' || req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.json')) {
                return res.redirect(`/password?token=${config.authToken}&redirect=${encodeURIComponent(req.originalUrl)}`);
            }

            // For API requests, return unauthorized
            return res.status(401).json({ 
                error: 'Authentication required. Please login first.',
                requiresPassword: true 
            });
        };
    }

    static checkPasswordForStaticFiles(req: Request, res: Response, config: AuthConfig): boolean {
        if (!config.useExternalServer || !config.webPassword) {
            return true;
        }

        const sessionToken = req.headers['x-session-token'] as string || (req as any).cookies?.sessionToken;
        
        if (!sessionToken || !config.activeSessions.has(sessionToken)) {
            res.status(401).json({ 
                error: 'Authentication required', 
                requiresPassword: true 
            });
            return false;
        }

        return true;
    }

    static createAuthTokenMiddleware(authToken: string) {
        return (req: Request, res: Response, next: NextFunction) => {
            // Check token in query params or headers
            const token = req.query.token || req.headers['x-auth-token'];
            
            if (token !== authToken) {
                return res.status(401).json({ 
                    error: 'Unauthorized: Invalid or missing authentication token' 
                });
            }
            
            next();
        };
    }

    static validatePassword(password: string, correctPassword: string, config: AuthConfig, clientIp: string): { valid: boolean; sessionToken?: string; error?: string } {
        // Check if IP is temporarily blocked
        if (config.blockedIPs.has(clientIp)) {
            return { 
                valid: false, 
                error: 'Too many failed attempts. Please try again later.' 
            };
        }

        if (password === correctPassword) {
            // Reset failed attempts on successful login
            config.passwordAttempts.delete(clientIp);
            
            // Generate session token
            const sessionToken = this.generateSessionToken();
            config.activeSessions.add(sessionToken);
            
            return { valid: true, sessionToken };
        } else {
            // Track failed attempts
            const attempts = config.passwordAttempts.get(clientIp) || 0;
            const newAttempts = attempts + 1;
            config.passwordAttempts.set(clientIp, newAttempts);

            if (newAttempts >= this.MAX_ATTEMPTS) {
                config.blockedIPs.add(clientIp);
                // Auto-unblock after timeout
                setTimeout(() => {
                    config.blockedIPs.delete(clientIp);
                    config.passwordAttempts.delete(clientIp);
                }, AUTH_BLOCK_DURATION);
                
                return { 
                    valid: false, 
                    error: `Too many failed attempts. Blocked for 15 minutes.` 
                };
            }

            return { 
                valid: false, 
                error: `Invalid password. ${this.MAX_ATTEMPTS - newAttempts} attempts remaining.` 
            };
        }
    }

    static clearSession(sessionToken: string, config: AuthConfig): void {
        config.activeSessions.delete(sessionToken);
    }
}