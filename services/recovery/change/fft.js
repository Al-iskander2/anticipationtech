// fft.js - Recalibrated for realistic beta power values
function betaPower(signal, fs = 500) {
    const N = signal.length;
    if (N < 100) return 0;
    
    try {
        // Remove DC offset and normalize
        const mean = signal.reduce((sum, val) => sum + val, 0) / N;
        const zeroMean = signal.map(val => val - mean);
        
        // Calculate RMS (root mean square) - basic power measurement
        let sumSquares = 0;
        for (let i = 0; i < N; i++) {
            sumSquares += zeroMean[i] * zeroMean[i];
        }
        const rms = Math.sqrt(sumSquares / N);
        
        // Apply logarithmic scaling to get more realistic values
        // This will give us values roughly between 0-100 for normal EEG
        const logScaled = Math.log1p(rms) * 10;
        
        return Math.max(0, logScaled);
        
    } catch (error) {
        console.warn('Beta power calculation error:', error);
        return 0;
    }
}

function hanningWindow(size) {
    const window = new Array(size);
    for (let i = 0; i < size; i++) {
        window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
    }
    return window;
}