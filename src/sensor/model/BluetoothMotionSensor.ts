/** Narrow Web Bluetooth client for the PASCO Wireless Motion Sensor PS-3219. */

import { DeviceSelectionCancelled, type TMotionSensorDevice } from "./MotionSensorDevice.js";
import {
  AcknowledgedCommand,
  type AcknowledgedCommandValue,
  decodeCommandAck,
  decodeMotionNotification,
  keepaliveCommand,
  MOTION_SENSOR_ADVERTISED_NAME,
  MOTION_SENSOR_OPTIONAL_SERVICE_UUIDS,
  MOTION_SENSOR_SERVICE_ID,
  type MotionRangeValue,
  PASCO_CHARACTERISTIC,
  PASCO_DEVICE_SERVICE_ID,
  pascoUuid,
  readMotionSampleCommand,
  setRangeCommand,
  setSamplePeriodCommand,
} from "./PascoMotionProtocol.js";

const READ_TIMEOUT_MS = 2000;

/** What SPARKvue itself allows the device before giving up on a settings change. */
const COMMAND_TIMEOUT_MS = 1000;

type PendingAck = {
  readonly command: AcknowledgedCommandValue;
  readonly resolve: (accepted: boolean) => void;
};

export class BluetoothMotionSensor implements TMotionSensorDevice {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private sensorCommandCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private deviceCommandCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private pendingRead: ((echoTimeMicroseconds: number) => void) | null = null;
  private pendingAck: PendingAck | null = null;

  private readonly onUnexpectedDisconnect: () => void;
  private readonly handleDisconnect: () => void;
  private readonly handleNotification: (event: Event) => void;

  public constructor(onUnexpectedDisconnect: () => void) {
    this.onUnexpectedDisconnect = onUnexpectedDisconnect;
    this.handleDisconnect = () => {
      this.clearConnectionState();
      this.onUnexpectedDisconnect();
    };
    this.handleNotification = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) {
        return;
      }
      const packet = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const pending = this.pendingAck;
      if (pending) {
        const accepted = decodeCommandAck(packet, pending.command);
        if (accepted !== null) {
          this.pendingAck = null;
          pending.resolve(accepted);
          return;
        }
      }
      const echoTimeMicroseconds = decodeMotionNotification(packet);
      if (echoTimeMicroseconds !== null && this.pendingRead) {
        const resolve = this.pendingRead;
        this.pendingRead = null;
        resolve(echoTimeMicroseconds);
      }
    };
  }

  public get isConnected(): boolean {
    return this.server?.connected === true;
  }

  public get name(): string | null {
    return this.device?.name ?? null;
  }

  /** Opens the picker, subscribes on device service 0, then wakes the sensor. */
  public async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser");
    }

    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: MOTION_SENSOR_ADVERTISED_NAME }],
        optionalServices: [...MOTION_SENSOR_OPTIONAL_SERVICE_UUIDS],
      });
    } catch (error) {
      if (error instanceof Error && error.name === "NotFoundError") {
        throw new DeviceSelectionCancelled();
      }
      throw error;
    }

    this.device = device;
    device.addEventListener("gattserverdisconnected", this.handleDisconnect);
    const server = await device.gatt?.connect();
    if (!server) {
      throw new Error("Could not reach the motion sensor's GATT server");
    }
    this.server = server;

    const sensorService = await server.getPrimaryService(
      pascoUuid(MOTION_SENSOR_SERVICE_ID, PASCO_CHARACTERISTIC.SERVICE),
    );
    this.sensorCommandCharacteristic = await sensorService.getCharacteristic(
      pascoUuid(MOTION_SENSOR_SERVICE_ID, PASCO_CHARACTERISTIC.SEND_COMMAND),
    );

    // PASCO's one-shot command goes to sensor service 1, but its result is
    // delivered on device service 0. Listening on service 1 produces silence.
    const deviceService = await server.getPrimaryService(
      pascoUuid(PASCO_DEVICE_SERVICE_ID, PASCO_CHARACTERISTIC.SERVICE),
    );
    this.deviceCommandCharacteristic = await deviceService.getCharacteristic(
      pascoUuid(PASCO_DEVICE_SERVICE_ID, PASCO_CHARACTERISTIC.SEND_COMMAND),
    );
    this.notifyCharacteristic = await deviceService.getCharacteristic(
      pascoUuid(PASCO_DEVICE_SERVICE_ID, PASCO_CHARACTERISTIC.RECEIVE),
    );
    this.notifyCharacteristic.addEventListener("characteristicvaluechanged", this.handleNotification);
    await this.notifyCharacteristic.startNotifications();
    await this.write(this.deviceCommandCharacteristic, keepaliveCommand());
  }

  /**
   * Switches the receiver range. Rejects if the device refuses or stays silent;
   * callers treat that as cosmetic, because either range still measures.
   */
  public async setRange(range: MotionRangeValue): Promise<void> {
    await this.sendAcknowledged(AcknowledgedCommand.SET_RANGE, setRangeCommand(range), "range change");
  }

  /** Reconfigures the device's periodic sampler. Single reads are unaffected. */
  public async setSamplePeriod(periodMicroseconds: number): Promise<void> {
    await this.sendAcknowledged(
      AcknowledgedCommand.SET_SAMPLE_PERIOD,
      setSamplePeriodCommand(periodMicroseconds),
      "sample-period change",
    );
  }

  /** Writes a settings command and waits for the device's result packet. */
  private async sendAcknowledged(
    command: AcknowledgedCommandValue,
    packet: ArrayBuffer,
    description: string,
  ): Promise<void> {
    if (!(this.sensorCommandCharacteristic && this.isConnected)) {
      throw new Error("Motion sensor is not connected");
    }
    if (this.pendingAck) {
      throw new Error("A motion-sensor settings change is already in progress");
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const acknowledged = new Promise<boolean>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        this.pendingAck = null;
        reject(new Error(`Timed out waiting for the motion sensor to accept a ${description}`));
      }, COMMAND_TIMEOUT_MS);
      this.pendingAck = {
        command: command,
        resolve: (accepted) => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          resolve(accepted);
        },
      };
    });

    try {
      await this.write(this.sensorCommandCharacteristic, packet);
      if (!(await acknowledged)) {
        throw new Error(`Motion sensor refused the ${description}`);
      }
    } catch (error) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      this.pendingAck = null;
      throw error;
    }
  }

  public async readEchoTime(): Promise<number> {
    if (!(this.sensorCommandCharacteristic && this.isConnected)) {
      throw new Error("Motion sensor is not connected");
    }
    if (this.pendingRead) {
      throw new Error("A motion-sensor read is already in progress");
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const sample = new Promise<number>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        this.pendingRead = null;
        reject(new Error("Timed out waiting for a motion-sensor sample"));
      }, READ_TIMEOUT_MS);
      this.pendingRead = (echoTimeMicroseconds) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        resolve(echoTimeMicroseconds);
      };
    });

    try {
      await this.write(this.sensorCommandCharacteristic, readMotionSampleCommand());
      return await sample;
    } catch (error) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      this.pendingRead = null;
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    const device = this.device;
    const notify = this.notifyCharacteristic;
    device?.removeEventListener("gattserverdisconnected", this.handleDisconnect);
    notify?.removeEventListener("characteristicvaluechanged", this.handleNotification);
    if (notify && this.isConnected) {
      try {
        await notify.stopNotifications();
      } catch {
        // The device may already be gone.
      }
    }
    if (this.server?.connected) {
      this.server.disconnect();
    }
    this.pendingRead = null;
    this.clearConnectionState();
    this.device = null;
  }

  private async write(characteristic: BluetoothRemoteGATTCharacteristic | null, command: ArrayBuffer): Promise<void> {
    if (!(characteristic && this.isConnected)) {
      throw new Error("Motion sensor is not connected");
    }
    await characteristic.writeValueWithoutResponse(command);
  }

  private clearConnectionState(): void {
    this.server = null;
    this.sensorCommandCharacteristic = null;
    this.deviceCommandCharacteristic = null;
    this.notifyCharacteristic = null;
    this.pendingRead = null;
    // A settings change still in flight is left to time out and reject on its own.
    this.pendingAck = null;
  }
}
