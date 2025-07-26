/**
 * Main dependency checking orchestration
 */
import { DependencyCheckResults } from './types';
import { 
    checkClaudeInstallation,
    checkPythonInstallation, 
    checkPtyWrapperAvailability,
    checkNgrokInstallation
} from './checkers';

export async function runDependencyCheck(): Promise<DependencyCheckResults> {
    // Run all checks concurrently for better performance
    const [claude, python, wrapper, ngrok] = await Promise.all([
        checkClaudeInstallation(),
        checkPythonInstallation(),
        checkPtyWrapperAvailability(),
        checkNgrokInstallation()
    ]);

    return {
        claude,
        python,
        wrapper,
        ngrok
    };
}