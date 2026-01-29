// ble-connection.js - Thin Client (solo reenvía bytes)
export class EEGDevice {
    constructor(wsUrl = '/ws/eeg') {
        this.device = null;
        this.characteristic = null;
        this.ws = null;
        this.wsUrl = wsUrl;
        this.sessionId = null;
        this.onProcessedData = null;

        // UUIDs Prometeo
        this.serviceUUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
        this.characteristicUUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
    }

    async connectBLE() {
        if (!navigator.bluetooth) {
            throw new Error('Web Bluetooth no disponible');
        }

        try {
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ name: 'Prometeo' }],
                optionalServices: [this.serviceUUID]
            });

            const server = await this.device.gatt.connect();
            const service = await server.getPrimaryService(this.serviceUUID);
            this.characteristic = await service.getCharacteristic(this.characteristicUUID);

            this.device.addEventListener('gattserverdisconnected', () => {
                console.log('BLE desconectado');
                if (this.ws) this.ws.close();
            });

            return true;
        } catch (error) {
            console.error('Error BLE:', error);
            throw error;
        }
    }

    async startSession() {
        // Crear sesión en backend
        const response = await fetch('/api/session/start', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user: 'anonymous',
                device: 'Prometeo',
                start_time: new Date().toISOString()
            })
        });

        const data = await response.json();
        this.sessionId = data.session_id;

        // Conectar WebSocket
        this.ws = new WebSocket(`${this.wsUrl}/${this.sessionId}`);

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (this.onProcessedData) {
                    this.onProcessedData(data);
                }
            } catch (e) {
                console.error('Error procesando mensaje:', e);
            }
        };

        return new Promise((resolve, reject) => {
            this.ws.onopen = () => resolve(true);
            this.ws.onerror = (e) => reject(e);
        });
    }

    async startStreaming() {
        if (!this.characteristic || !this.ws) {
            throw new Error('BLE o WebSocket no conectado');
        }

        await this.characteristic.startNotifications();

        this.characteristic.addEventListener('characteristicvaluechanged', (event) => {
            // Obtener bytes crudos
            const dataView = event.target.value;
            const bytes = new Uint8Array(dataView.buffer);

            // Enviar bytes crudos al backend (sin procesar)
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'raw_eeg',
                    packet: Array.from(bytes),  // Enviar como array
                    timestamp: Date.now()
                }));
            }
        });

        console.log('Streaming BLE activo → Backend Python');
    }

    async stopStreaming() {
        if (this.characteristic) {
            await this.characteristic.stopNotifications();
        }

        if (this.ws) {
            this.ws.close();
        }

        // Finalizar sesión en backend
        if (this.sessionId) {
            await fetch(`/api/session/${this.sessionId}/stop`, {
                method: 'POST'
            });
        }
    }

    async sendCommand(command) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'command',
                command: command
            }));
        }
    }
}
