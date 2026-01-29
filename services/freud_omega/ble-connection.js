// ble-connection.js - Adaptación del Python a JavaScript para manejo robusto de BLE
export class EEGDevice {
    constructor() {
        this.device = null;
        this.server = null;
        this.characteristic = null;
        this.isConnected = false;
        this.dataCallback = null;
        
        // UUIDs específicos del dispositivo Prometeo
        this.serviceUUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
        this.characteristicUUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
    }

    async scanDevices(timeout = 5000) {
        console.log(`🔍 Escaneando dispositivos BLE (${timeout}ms)...`);
        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Prometeo' }],
                optionalServices: [this.serviceUUID]
            });
            
            return [{
                name: device.name || 'Desconocido',
                id: device.id,
                address: device.id // En Web Bluetooth, el ID es similar a la dirección
            }];
        } catch (error) {
            console.error('❌ Error en escaneo:', error);
            return [];
        }
    }

    async connect(deviceId) {
        try {
            console.log(`🔗 Conectando a dispositivo...`);
            
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Prometeo' }],
                optionalServices: [this.serviceUUID]
            });
            
            this.device.addEventListener('gattserverdisconnected', () => {
                this.onDisconnected();
            });
            
            this.server = await this.device.gatt.connect();
            
            if (this.server.connected) {
                this.isConnected = true;
                console.log(`✅ Conectado a: ${this.device.name || 'Prometeo EEG'}`);
                return true;
            }
            
            return false;
        } catch (error) {
            console.error(`❌ Error de conexión:`, error);
            return false;
        }
    }

    async startReceiving(callback) {
        if (!this.server || !this.server.connected) {
            console.error('❌ No hay dispositivo conectado');
            return false;
        }
        
        this.dataCallback = callback;
        
        try {
            const service = await this.server.getPrimaryService(this.serviceUUID);
            this.characteristic = await service.getCharacteristic(this.characteristicUUID);
            
            await this.characteristic.startNotifications();
            this.characteristic.addEventListener('characteristicvaluechanged', 
                (event) => this.notificationHandler(event));
            
            await this.sendCommand('START');
            console.log('👂 Escuchando datos EEG...');
            return true;
        } catch (error) {
            console.error('❌ Error iniciando recepción:', error);
            return false;
        }
    }

    async stopReceiving() {
        if (!this.server || !this.server.connected || !this.characteristic) {
            return;
        }
        
        try {
            await this.sendCommand('STOP');
            await this.characteristic.stopNotifications();
            console.log('🛑 Recepción detenida');
        } catch (error) {
            console.error('⚠️ Error deteniendo recepción:', error);
        }
    }

    async sendCommand(command) {
        if (!this.server || !this.server.connected || !this.characteristic) {
            return;
        }
        
        try {
            const encoder = new TextEncoder();
            await this.characteristic.writeValue(encoder.encode(command));
            console.log(`📤 Comando enviado: ${command}`);
        } catch (error) {
            console.error(`❌ Error enviando comando:`, error);
        }
    }

    notificationHandler(event) {
        try {
            const value = event.target.value;
            const packet = this.parseEEGPacket(value);
            
            if (this.dataCallback && packet) {
                this.dataCallback(packet);
            }
        } catch (error) {
            console.error('⚠️ Error procesando paquete:', error);
        }
    }

    parseEEGPacket(dataView) {
        const bytes = new Uint8Array(dataView.buffer);
        const timestamp = Date.now();
        
        // Formato: C7 7C counter adc_hi adc_lo 01 (6 bytes)
        if (bytes.length >= 6 && bytes[0] === 0xC7 && bytes[1] === 0x7C) {
            return {
                timestamp: timestamp,
                timestamp_ms: timestamp,
                counter: bytes[2],
                adc_high: bytes[3],
                adc_low: bytes[4],
                adc_value: (bytes[3] << 8) | bytes[4],
                checksum: bytes[5],
                hex: Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''),
                type: 'eeg_data'
            };
        }
        
        // Si es texto
        try {
            const text = new TextDecoder().decode(bytes).trim();
            if (text) {
                return {
                    timestamp: timestamp,
                    timestamp_ms: timestamp,
                    text: text,
                    hex: Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''),
                    type: 'text_response'
                };
            }
        } catch {
            // Ignore decode errors
        }
        
        // Formato desconocido
        return {
            timestamp: timestamp,
            timestamp_ms: timestamp,
            raw: Array.from(bytes),
            hex: Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''),
            size: bytes.length,
            type: 'unknown'
        };
    }

    onDisconnected() {
        console.log('🔌 Dispositivo desconectado');
        this.isConnected = false;
        this.device = null;
        this.server = null;
        this.characteristic = null;
        this.dataCallback = null;
    }

    async disconnect() {
        try {
            if (this.dataCallback) {
                await this.stopReceiving();
            }
            
            if (this.device && this.device.gatt.connected) {
                await this.device.gatt.disconnect();
            }
            
            this.onDisconnected();
            console.log('🔌 Desconexión completada');
        } catch (error) {
            console.error('⚠️ Error desconectando:', error);
        }
    }
}


// Opcional: exponer en window para debugging
if (typeof window !== 'undefined') window.EEGDevice = EEGDevice;
