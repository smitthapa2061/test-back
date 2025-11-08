const fs = require('fs');
const path = require('path');
const util = require('util');
const os = require('os');

// Determine the log directory
let logDir;
let logStream;

// Check if we're running in a packaged environment
const isPackaged = process.pkg !== undefined;

if (isPackaged) {
    // In packaged app, use the directory where the executable is located
    logDir = path.dirname(process.execPath);
} else {
    // In development, use a logs directory in the project root
    logDir = path.join(__dirname, 'logs');
}

// Ensure log directory exists
let logFile;
try {
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Create a write stream (in append mode)
    logFile = path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`);
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    // Log the log file location
    console.log(`Logging to: ${logFile}`);
} catch (error) {
    console.error('Failed to initialize logging:', error.message);
    // Fallback to console-only logging if file logging fails
    logStream = {
        write: (message) => process.stdout.write(message),
        end: () => {}
    };
    logFile = 'console';
}

// Override console methods
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug
};

// Format log message with timestamp
function formatMessage(level, message) {
    try {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level.toUpperCase()}] ${util.format(message)}\n`;
    } catch (error) {
        return `[${new Date().toISOString()}] [ERROR] Failed to format log message: ${error.message}\n`;
    }
}

// Override console methods
console.log = function() {
    const message = formatMessage('info', util.format.apply(null, arguments));
    logStream.write(message);
    originalConsole.log.apply(console, arguments);
};

console.error = function() {
    const message = formatMessage('error', util.format.apply(null, arguments));
    logStream.write(message);
    originalConsole.error.apply(console, arguments);
};

console.warn = function() {
    const message = formatMessage('warn', util.format.apply(null, arguments));
    logStream.write(message);
    originalConsole.warn.apply(console, arguments);
};

console.info = function() {
    const message = formatMessage('info', util.format.apply(null, arguments));
    logStream.write(message);
    originalConsole.info.apply(console, arguments);
};

console.debug = function() {
    const message = formatMessage('debug', util.format.apply(null, arguments));
    logStream.write(message);
    originalConsole.debug.apply(console, arguments);
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    const message = formatMessage('error', `Uncaught Exception: ${error.stack || error}`);
    logStream.write(message);
    originalConsole.error('Uncaught Exception:', error);
    // Don't exit for uncaught exceptions to keep the process running
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    const message = formatMessage('error', `Unhandled Rejection at: ${promise}, reason: ${reason}`);
    logStream.write(message);
    originalConsole.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle process exit
process.on('exit', (code) => {
    const message = formatMessage('info', `Process exited with code ${code}`);
    logStream.write(message);
    logStream.end();
});

// Handle process signals
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
    process.on(signal, () => {
        const message = formatMessage('info', `Received ${signal}, shutting down...`);
        logStream.write(message);
        logStream.end(() => {
            process.exit(0);
        });
    });
});

module.exports = {
    logStream,
    logFile
};
