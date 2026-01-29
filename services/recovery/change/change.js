// game.js - Updated with recalibrated thresholds and better debugging
(function() {
    'use strict';

    let device = null;
    let characteristic = null;
    let isConnected = false;

    // EEG Configuration - RECALIBRATED!
    const FS = 500;
    const BUFFER_SIZE = 256;
    const ON_THRESHOLD = 25;    // MUCHO MÁS BAJO - requiere concentración real

    // Game state
    let gameState = "instructions";
    let bulbOn = false;
    let currentBetaPower = 0;
    let lastLogTime = 0;
    const LOG_INTERVAL = 1000;

    // Data buffers
    const eegBuffer = new Array(BUFFER_SIZE).fill(0);
    let bufferIndex = 0;
    let packetsReceived = 0;
    let bufferFillCount = 0;

    // Image elements
    let imgOff, imgOn, katanaIdle, katanaSlash;

    // UI Elements
    const statusText = document.getElementById('status-text');
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const instructionsScreen = document.getElementById('instructions-screen');
    const bulbGame = document.getElementById('bulb-game');
    const katanaGame = document.getElementById('katana-game');
    const gameImage = document.getElementById('game-image');
    const katanaImage = document.getElementById('katana-image');
    const betaPowerText = document.getElementById('beta-power');
    const gameStateText = document.getElementById('game-state');
    const connectionStatus = document.getElementById('connection-status');
    const packetsReceivedEl = document.getElementById('packets-received');
    const powerLevel = document.getElementById('power-level');
    const currentPower = document.getElementById('current-power');
    const bulbFeedback = document.getElementById('bulb-feedback');
    const katanaFeedback = document.getElementById('katana-feedback');

    // BLE Configuration
    const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
    const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

    // Packet constants
    const SYNC_BYTE_1 = 0xC7;
    const SYNC_BYTE_2 = 0x7C;
    const END_BYTE = 0x01;

    async function loadImages() {
        try {
            imgOff = await loadImage('images/light off.png');
            imgOn = await loadImage('images/light on.png');
            katanaIdle = await loadImage('images/katana 1.png');
            katanaSlash = await loadImage('images/katana 2.png');
            console.log('All images loaded successfully');
        } catch (error) {
            console.error('Error loading images:', error);
        }
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = chrome.runtime.getURL(src);
        });
    }

    function setStatus(text) {
        statusText.textContent = text;
    }

    function showScreen(screenName) {
        instructionsScreen.style.display = 'none';
        bulbGame.style.display = 'none';
        katanaGame.style.display = 'none';
        
        switch(screenName) {
            case 'instructions':
                instructionsScreen.style.display = 'flex';
                break;
            case 'bulb':
                bulbGame.style.display = 'flex';
                break;
            case 'katana':
                katanaGame.style.display = 'flex';
                break;
        }
    }

    function analyzeSignalQuality(signal) {
        const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
        const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
        const stdDev = Math.sqrt(variance);
        
        return {
            mean: mean,
            stdDev: stdDev,
            min: Math.min(...signal),
            max: Math.max(...signal),
            range: Math.max(...signal) - Math.min(...signal)
        };
    }

    function updateConcentrationFeedback() {
        const powerPercentage = Math.min((currentBetaPower / ON_THRESHOLD) * 100, 100);
        
        // Update power bar
        powerLevel.style.width = `${powerPercentage}%`;
        currentPower.textContent = `${Math.round(powerPercentage)}%`;
        
        // Update feedback messages with more granular levels
        if (gameState === 'bulb') {
            if (powerPercentage < 20) {
                bulbFeedback.className = 'concentration-feedback feedback-low';
                bulbFeedback.textContent = '🔴 Very relaxed - Light is OFF';
            } else if (powerPercentage < 40) {
                bulbFeedback.className = 'concentration-feedback feedback-low';
                bulbFeedback.textContent = '🟡 Slightly focused - Light is OFF';
            } else if (powerPercentage < 60) {
                bulbFeedback.className = 'concentration-feedback';
                bulbFeedback.textContent = '🟢 Moderately focused - Light is ON';
            } else if (powerPercentage < 80) {
                bulbFeedback.className = 'concentration-feedback feedback-good';
                bulbFeedback.textContent = '🔵 Well focused - Light is ON';
            } else {
                bulbFeedback.className = 'concentration-feedback feedback-high';
                bulbFeedback.textContent = '🟣 Highly focused - Light is ON';
            }
        } else if (gameState === 'katana') {
            if (powerPercentage < 30) {
                katanaFeedback.className = 'concentration-feedback feedback-low';
                katanaFeedback.textContent = '🔴 Ready... Focus to unleash slash!';
            } else if (powerPercentage < 50) {
                katanaFeedback.className = 'concentration-feedback';
                katanaFeedback.textContent = '🟡 Building power... Keep focusing!';
            } else if (powerPercentage < 70) {
                katanaFeedback.className = 'concentration-feedback feedback-good';
                katanaFeedback.textContent = '🟢 Good focus! Slash is active!';
            } else {
                katanaFeedback.className = 'concentration-feedback feedback-high';
                katanaFeedback.textContent = '🔵 Excellent focus! Strong slash!';
            }
        }
    }

    function updateGameUI() {
        betaPowerText.textContent = `${currentBetaPower.toFixed(2)}`;
        gameStateText.textContent = bulbOn ? 'ON' : 'OFF';
        connectionStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
        packetsReceivedEl.textContent = packetsReceived.toString();
        
        // Update game visuals
        if (gameState === 'bulb') {
            gameImage.src = bulbOn ? imgOn.src : imgOff.src;
        } else if (gameState === 'katana') {
            katanaImage.src = currentBetaPower > ON_THRESHOLD ? katanaSlash.src : katanaIdle.src;
        }
        
        updateConcentrationFeedback();
    }

    function processEEGData(value) {
        // Update circular buffer
        eegBuffer[bufferIndex] = value;
        bufferIndex = (bufferIndex + 1) % BUFFER_SIZE;
        
        // Calculate beta power when buffer is full
        if (bufferIndex === 0) {
            bufferFillCount++;
            
            // Only calculate beta power every few buffer fills to smooth the response
            if (bufferFillCount % 2 === 0) {
                const oldPower = currentBetaPower;
                currentBetaPower = betaPower(eegBuffer, FS);
                
                // Debug: Log signal analysis occasionally
                if (bufferFillCount % 10 === 0) {
                    const signalStats = analyzeSignalQuality(eegBuffer);
                    console.log(`Signal Analysis - Mean: ${signalStats.mean.toFixed(2)}, StdDev: ${signalStats.stdDev.toFixed(2)}, Range: ${signalStats.range}`);
                    console.log(`Beta Power: ${oldPower.toFixed(2)} -> ${currentBetaPower.toFixed(2)}`);
                }
                
                // Update game states with immediate response (like katana)
                if (gameState === 'bulb') {
                    // Lógica directa como katana
                    bulbOn = currentBetaPower > ON_THRESHOLD;
                    if (bufferFillCount % 5 === 0) {
                        console.log(`💡 Light ${bulbOn ? 'ON' : 'OFF'} - Beta: ${currentBetaPower.toFixed(2)}`);
                    }
                }
            }
        }
        
        // Log periodically with more detail
        const now = Date.now();
        if (now - lastLogTime > LOG_INTERVAL) {
            const bufferUsed = eegBuffer.filter(val => val !== 0).length;
            console.log(`📊 EEG: ${value} | Beta Power: ${currentBetaPower.toFixed(2)} | State: ${bulbOn ? 'ON' : 'OFF'} | Game: ${gameState} | Buffer: ${bufferUsed}/${BUFFER_SIZE} | Packets: ${packetsReceived}`);
            lastLogTime = now;
        }
        
        updateGameUI();
    }

    async function connectPrometeo() {
        try {
            setStatus('Searching for device...');
            connectBtn.disabled = true;

            device = await navigator.bluetooth.requestDevice({
                filters: [{ name: 'Prometeo' }],
                optionalServices: [SERVICE_UUID]
            });

            device.addEventListener('gattserverdisconnected', onDisconnected);

            setStatus('Connecting GATT...');
            const server = await device.gatt.connect();

            const service = await server.getPrimaryService(SERVICE_UUID);
            characteristic = await service.getCharacteristic(CHAR_UUID);

            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', handleNotification);

            isConnected = true;
            setStatus('Connected');
            disconnectBtn.disabled = false;

            // Send initial commands
            const encoder = new TextEncoder();
            await characteristic.writeValue(encoder.encode('WHORU'));
            await new Promise(r => setTimeout(r, 500));
            await characteristic.writeValue(encoder.encode('START'));
            
            // Reset game state
            bulbOn = false;
            currentBetaPower = 0;
            bufferFillCount = 0;
            
            // Show instructions
            showScreen('instructions');

        } catch (err) {
            console.error('Connection error:', err);
            setStatus('Error: ' + (err.message || err));
            connectBtn.disabled = false;
        }
    }

    async function disconnectPrometeo() {
        if (device && device.gatt.connected) {
            try {
                const encoder = new TextEncoder();
                await characteristic.writeValue(encoder.encode('STOP'));
            } catch (e) {
                console.warn('Could not send STOP command:', e);
            }
            device.gatt.disconnect();
        }
    }

    function onDisconnected() {
        isConnected = false;
        characteristic = null;
        setStatus('Disconnected');
        disconnectBtn.disabled = true;
        connectBtn.disabled = false;
        showScreen('instructions');
    }

    function handleNotification(event) {
        const dataView = event.target.value;
        const bytes = new Uint8Array(dataView.buffer);

        // Parse BLE packet
        if (bytes.length >= 6 && 
            bytes[0] === SYNC_BYTE_1 && 
            bytes[1] === SYNC_BYTE_2 && 
            bytes[5] === END_BYTE) {
            
            // Extract 12-bit ADC value (little endian)
            const value = (bytes[3] << 8) | bytes[4];
            packetsReceived++;
            processEEGData(value);
            
            // Debug log every 100 packets
            if (packetsReceived % 100 === 0) {
                console.log(`📦 Packet #${packetsReceived}: ADC=${value}, Counter=${bytes[2]}`);
            }
        } else if (bytes.length > 0 && bytes[0] < 0x80) {
            // Text response
            const text = new TextDecoder().decode(bytes);
            console.log('🔤 Device response:', text);
            setStatus(`Connected: ${text}`);
        }
    }

    // Event Listeners
    connectBtn.addEventListener('click', connectPrometeo);
    disconnectBtn.addEventListener('click', disconnectPrometeo);

    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space') {
            event.preventDefault();
            
            if (gameState === 'instructions') {
                gameState = 'bulb';
                showScreen('bulb');
                console.log('🎮 Game started: Light Bulb Control');
            } else if (gameState === 'bulb') {
                gameState = 'katana';
                showScreen('katana');
                console.log('🎮 Game changed: Katana Slash');
            } else if (gameState === 'katana') {
                gameState = 'bulb';
                showScreen('bulb');
                console.log('🎮 Game changed: Light Bulb Control');
            }
        }
    });

    // Initialize
    loadImages().then(() => {
        console.log('🎯 Prometeo EEG Games initialized - Waiting for connection...');
        showScreen('instructions');
    });

})();