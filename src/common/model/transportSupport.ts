/**
 * transportSupport.ts
 *
 * Whether this browser can talk to the sensor at all, over either transport,
 * reduced to something the view can switch on.
 *
 * The results are memoized: they cannot change during a session, and the view
 * asks for them every time it rebuilds the sensor panel.
 */

import MotionSensorNamespace from "../../MotionSensorNamespace.js";

export const BluetoothStatus = {
  /** Web Bluetooth is present and the page is on a secure origin. */
  AVAILABLE: "available",
  /** Not a browser at all — a test runner or a server-side render. */
  NO_BROWSER: "noBrowser",
  /** The API exists but the page is plain HTTP, so it will refuse to open the picker. */
  INSECURE_CONTEXT: "insecureContext",
  /** Firefox, Safari, and anything else without Web Bluetooth. */
  UNSUPPORTED_BROWSER: "unsupportedBrowser",
} as const;

export type BluetoothStatusValue = (typeof BluetoothStatus)[keyof typeof BluetoothStatus];

let cachedStatus: BluetoothStatusValue | null = null;

export function getBluetoothStatus(): BluetoothStatusValue {
  if (cachedStatus !== null) {
    return cachedStatus;
  }

  if (typeof window === "undefined" || typeof navigator === "undefined") {
    cachedStatus = BluetoothStatus.NO_BROWSER;
    return cachedStatus;
  }

  // Order matters: an insecure context is worth reporting separately because it
  // is the one failure the teacher can actually fix, by serving over HTTPS.
  cachedStatus = !window.isSecureContext
    ? BluetoothStatus.INSECURE_CONTEXT
    : "bluetooth" in navigator
      ? BluetoothStatus.AVAILABLE
      : BluetoothStatus.UNSUPPORTED_BROWSER;

  return cachedStatus;
}

export function isBluetoothAvailable(): boolean {
  return getBluetoothStatus() === BluetoothStatus.AVAILABLE;
}

let cachedUsbAvailable: boolean | null = null;

/**
 * Whether the sensor can be reached over WebUSB — a cable, no pairing.
 *
 * WebUSB rides on the same two conditions as Web Bluetooth (a Chromium browser
 * on a secure origin), so a browser that has one very nearly always has the
 * other; they are asked separately because "very nearly" is not "always", and a
 * missing API here means a button the student must not be shown.
 */
export function isWebUsbAvailable(): boolean {
  if (cachedUsbAvailable !== null) {
    return cachedUsbAvailable;
  }
  cachedUsbAvailable =
    typeof window !== "undefined" && typeof navigator !== "undefined" && window.isSecureContext && "usb" in navigator;
  return cachedUsbAvailable;
}

/** Clears the memos. Exists for unit tests, which vary the environment. */
export function clearBluetoothStatusCache(): void {
  cachedStatus = null;
  cachedUsbAvailable = null;
}

MotionSensorNamespace.register("BluetoothStatus", BluetoothStatus);
