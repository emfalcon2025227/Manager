const express = require('express');
const cors = require('cors');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 18622;
const BRIDGE_VERSION = "2.1.1"; // Hardened version

app.use(express.json({ limit: '100mb' }));

// Restrict CORS safely to ERP hostnames and localhost
const allowedOrigins = [
    /^https?:\/\/localhost(:\d+)?$/, 
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/, 
    /^https:\/\/.*\.run\.app$/
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        const isAllowed = allowedOrigins.some(regex => regex.test(origin));
        if (isAllowed) {
            callback(null, true);
        } else {
            callback(new Error('CORS policy violation'));
        }
    }
}));

function runWiaScriptSafe(argList) {
    const psScript = path.join(__dirname, 'wia-scanner.ps1');
    const fullArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript, ...argList];
    try {
        const output = execFileSync('powershell.exe', fullArgs, {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 60000,
            windowsHide: true,
        });
        return { success: true, output: (output || '').trim() };
    } catch (error) {
        return { success: false, error: error.stderr ? error.stderr.toString() : error.message };
    }
}

app.get('/health', (req, res) => {
    const result = runWiaScriptSafe(['-Action', 'list']);
    if (result.success && result.output) {
        try {
            const scanners = JSON.parse(result.output);
            const available = Array.isArray(scanners) && scanners.length > 0;
            res.json({
                ok: true,
                bridgeVersion: BRIDGE_VERSION,
                scannerAvailable: available,
                scannerName: available ? scanners[0].name : null,
                protocol: "WIA",
                devices: scanners
            });
        } catch (e) {
            res.json({ ok: true, bridgeVersion: BRIDGE_VERSION, scannerAvailable: false, devices: [] });
        }
    } else {
        res.json({ ok: true, bridgeVersion: BRIDGE_VERSION, scannerAvailable: false, devices: [] });
    }
});

app.get('/scanners', (req, res) => {
    const result = runWiaScriptSafe(['-Action', 'list']);
    if (result.success && result.output) {
        try {
            const scanners = JSON.parse(result.output);
            res.json({ scanners: Array.isArray(scanners) ? scanners : [] });
        } catch (e) {
            res.json({ scanners: [] });
        }
    } else {
        res.json({ scanners: [] });
    }
});

app.get('/diagnostics', (req, res) => {
    const result = runWiaScriptSafe(['-Action', 'list']);
    let scanners = [];
    if (result.success && result.output) {
        try { 
            const parsed = JSON.parse(result.output); 
            if (Array.isArray(parsed)) scanners = parsed;
        } catch (e) {}
    }
    res.json({
        bridge: { running: true, version: BRIDGE_VERSION },
        wia: { available: scanners.length > 0 },
        scanners: scanners.map(s => ({ 
            id: s.id,
            name: s.name, 
            protocol: "WIA",
            available: true
        }))
    });
});

app.post('/scan', (req, res) => {
    const { scannerId, dpi = 300, colorMode = "COLOR", source = "auto" } = req.body;
    
    // Check if any scanners are available
    const listRes = runWiaScriptSafe(['-Action', 'list']);
    if (!listRes.success || !listRes.output || listRes.output === '[]') {
        return res.status(503).json({ error: "لا يوجد ماسح ضوئي متصل عبر WIA." });
    }

    // Input sanitization & whitelisting
    const validDpi = Math.min(1200, Math.max(75, parseInt(dpi, 10) || 300));
    const validColorMode = ['COLOR', 'GRAYSCALE', 'BW'].includes(String(colorMode).toUpperCase())
        ? String(colorMode).toUpperCase()
        : 'COLOR';
    const validSource = ['auto', 'flatbed', 'feeder', 'duplex'].includes(String(source).toLowerCase())
        ? String(source).toLowerCase()
        : 'auto';
    const safeScannerId = typeof scannerId === 'string' ? scannerId.replace(/[^a-zA-Z0-9_\-\.\{\}\:\s]/g, '') : '';

    // Secure temp file creation in the OS temp directory
    const safeTimestamp = Date.now();
    const safeRandom = Math.floor(Math.random() * 1000000);
    const tempFile = path.join(os.tmpdir(), `scan_${safeTimestamp}_${safeRandom}.jpg`);
    
    // Execute WIA script with array arguments (safe from command injection)
    const scriptArgs = [
        '-Action', 'scan',
        '-ScannerId', safeScannerId,
        '-Dpi', String(validDpi),
        '-ColorMode', validColorMode,
        '-OutFile', tempFile,
        '-Source', validSource,
    ];
    const result = runWiaScriptSafe(scriptArgs);
    
    if (result.success && fs.existsSync(tempFile)) {
        try {
            const base64 = fs.readFileSync(tempFile, { encoding: 'base64' });
            // Secure cleanup of the original scanned file immediately after reading
            fs.unlinkSync(tempFile);
            
            let warnings = [];
            try { 
                const outJson = JSON.parse(result.output);
                if (outJson.warnings) warnings = outJson.warnings;
            } catch (e) {}

            res.json({
                success: true,
                mimeType: "image/jpeg",
                imageBase64: `data:image/jpeg;base64,${base64}`,
                warnings: warnings.length > 0 ? warnings : undefined
            });
        } catch (e) {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            res.status(500).json({ error: "Failed to read image from scanner: " + e.message });
        }
    } else {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        let errorMsg = result.error || "تعذر تنفيذ عملية المسح.";
        try {
            const outObj = JSON.parse(result.output);
            if (outObj.error) errorMsg = outObj.error;
        } catch(e) {}
        res.status(500).json({ error: errorMsg, code: "WIA_SCAN_FAILED" });
    }
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(`Emirates Falcon Scanner Bridge running on http://127.0.0.1:${PORT}`);
    console.log(`WIA Native Interface Active. Version: ${BRIDGE_VERSION}`);
});

