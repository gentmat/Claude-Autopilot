// Main entry point - loads the modular structure
// This file now simply imports the new modular architecture

// Import and initialize the main module
import('./main.js').catch(error => {
  console.error('Failed to load modular script system:', error);
  
  // Fallback: show error to user
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #ff4444;
    color: white;
    padding: 20px;
    border-radius: 8px;
    z-index: 10000;
    text-align: center;
    max-width: 400px;
  `;
  errorDiv.innerHTML = `
    <h3>Failed to Load Application</h3>
    <p>Error loading the modular script system. Please reload the extension.</p>
    <p><small>Error: ${error.message}</small></p>
  `;
  document.body.appendChild(errorDiv);
});