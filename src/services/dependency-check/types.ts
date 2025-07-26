/**
 * Type definitions for dependency checking
 */

export interface DependencyCheckResult {
    available: boolean;
    version?: string;
    path?: string;
    error?: string;
    installInstructions?: string;
}

export interface DependencyCheckResults {
    claude: DependencyCheckResult;
    python: DependencyCheckResult;
    wrapper: DependencyCheckResult;
    ngrok: DependencyCheckResult;
}

export interface DependencyStatus {
    allReady: boolean;
    issues: string[];
    successMessages: string[];
}