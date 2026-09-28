/**
 * SensorModel.ts
 *
 * The Motion Sensor screen's model: MotionSensorModel driven by a real PASCO
 * Wireless Motion Sensor over Web Bluetooth or WebUSB. Identical to the
 * Simulation screen in every other respect — same clock, same lifecycle, same
 * derived quantities — which is the whole point of the two-screen pairing. Walking in front of the
 * sensor should produce the same graph as dragging the walker did.
 */

import { MotionSensorModel } from "../../common/model/MotionSensorModel.js";
import { PositionSourceType } from "../../common/model/PositionSource.js";
import { SensorPositionSource } from "../../common/model/SensorPositionSource.js";
import type { MotionSensorPreferencesModel } from "../../preferences/MotionSensorPreferencesModel.js";
import motionSensorQueryParameters from "../../preferences/motionSensorQueryParameters.js";

export class SensorModel extends MotionSensorModel {
  /** Kept as a concrete type so the view can drive connect / disconnect. */
  public readonly sensorSource: SensorPositionSource;

  public constructor(preferences: MotionSensorPreferencesModel) {
    const usbBringUp = motionSensorQueryParameters.usbBringUp;
    const source = new SensorPositionSource({
      pollIntervalMs: motionSensorQueryParameters.pollIntervalMs,
      streamingEnabled: motionSensorQueryParameters.sensorStreaming,
      usbProbeOnly: usbBringUp === "probe" || usbBringUp === "probeAll",
      usbAcceptAllDevices: usbBringUp === "all" || usbBringUp === "probeAll",
      diagnosticsEnabledProperty: preferences.showDiagnosticsProperty,
    });
    super({ sourceType: PositionSourceType.MOTION_SENSOR, source: source });
    this.sensorSource = source;
  }
}
