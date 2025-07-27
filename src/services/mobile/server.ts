import { MobileServer } from './index';

let server: MobileServer | null = null;

export function getMobileServer() {
    if (!server) {
        server = new MobileServer();
    }
    return server;
}

export { ServerManager } from './server/server-manager';
