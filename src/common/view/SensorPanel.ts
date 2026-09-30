/**
 * SensorPanel.ts
 *
 * The Motion Sensor screen's connection control: status, Connect / Disconnect, and
 * whatever went wrong.
 *
 * ── Two rules carried over from RadioactivityAndStatistics ────────────────────
 * 1. The status is a coloured dot **and** a text label. Colour alone never
 *    carries the meaning.
 * 2. When a transport is unavailable there is **no** Connect button for it,
 *    rather than a disabled one — and when neither works, a sentence saying why
 *    and what to do instead. A greyed-out button invites clicking and explains
 *    nothing.
 *
 * ── One button per transport ──────────────────────────────────────────────────
 * Bluetooth and USB reach the same sensor, and the browser demands a user
 * gesture either way, so the choice is the click itself rather than a setting
 * made beforehand. Each button is shown only where its API exists.
 */

import type { TReadOnlyProperty } from "scenerystack/axon";
import { DerivedProperty, PatternStringProperty } from "scenerystack/axon";
import { StringUtils } from "scenerystack/phetcommon";
import { Circle, HBox, RichText, Text, VBox } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { RectangularPushButton } from "scenerystack/sun";
import { FLAT_PANEL_PUSH_BUTTON_OPTIONS, LIGHT_SURFACE_TEXT_FILL } from "../../common/MotionSensorButtonOptions.js";
import { MotionSensorPanel } from "../../common/MotionSensorPanel.js";
import type { SensorA11yStrings } from "../../i18n/StringManager.js";
import { StringManager } from "../../i18n/StringManager.js";
import MotionSensorColors from "../../MotionSensorColors.js";
import { CONTROL_PANEL_WIDTH } from "../../MotionSensorConstants.js";
import { ConnectionState } from "../model/ConnectionState.js";
import {
  type SensorPositionSource,
  SensorTransport,
  type SensorTransportValue,
} from "../model/SensorPositionSource.js";
import { BluetoothStatus, getBluetoothStatus, isWebUsbAvailable } from "../model/transportSupport.js";

const LABEL_FONT = new PhetFont(13);
const MESSAGE_FONT = new PhetFont(12);

export type SensorPanelOptions = {
  readonly source: SensorPositionSource;
  readonly a11y: SensorA11yStrings;
  /** Whether to show the raw reading; from Preferences → Simulation. */
  readonly showDiagnosticsProperty: TReadOnlyProperty<boolean>;
};

export class SensorPanel extends MotionSensorPanel {
  /** Null when Web Bluetooth is unavailable, so there is nothing to focus. */
  public readonly connectButton: RectangularPushButton | null;

  /** Null when WebUSB is unavailable. */
  public readonly connectUsbButton: RectangularPushButton | null;

  public readonly disconnectButton: RectangularPushButton;

  private readonly disposeSensorPanel: () => void;

  public constructor(providedOptions: SensorPanelOptions) {
    const source = providedOptions.source;
    const a11y = providedOptions.a11y;
    const strings = StringManager.getInstance();
    const sensorStrings = strings.getSensorStrings();

    const status = getBluetoothStatus();
    const bluetoothAvailable = status === BluetoothStatus.AVAILABLE;
    const usbAvailable = isWebUsbAvailable();

    const statusTextProperty = new DerivedProperty(
      [
        source.connectionStateProperty,
        sensorStrings.statusDisconnectedStringProperty,
        sensorStrings.statusConnectingStringProperty,
        sensorStrings.statusConnectedStringProperty,
        sensorStrings.statusErrorStringProperty,
      ],
      (state, disconnected, connecting, connected, errored) => {
        switch (state) {
          case ConnectionState.CONNECTING:
            return connecting;
          case ConnectionState.CONNECTED:
            return connected;
          case ConnectionState.ERROR:
            return errored;
          default:
            return disconnected;
        }
      },
    );

    const statusColorProperty = new DerivedProperty([source.connectionStateProperty], (state) => {
      switch (state) {
        case ConnectionState.CONNECTING:
          return MotionSensorColors.statusConnectingColorProperty.value;
        case ConnectionState.CONNECTED:
          return MotionSensorColors.statusConnectedColorProperty.value;
        case ConnectionState.ERROR:
          return MotionSensorColors.statusErrorColorProperty.value;
        default:
          return MotionSensorColors.statusDisconnectedColorProperty.value;
      }
    });

    const statusDot = new Circle(5, { fill: statusColorProperty });
    const statusRow = new HBox({
      spacing: 8,
      children: [
        statusDot,
        new Text(statusTextProperty, {
          font: LABEL_FONT,
          fill: MotionSensorColors.textColorProperty,
          maxWidth: CONTROL_PANEL_WIDTH - 60,
        }),
      ],
    });

    const isDisconnectedProperty = new DerivedProperty(
      [source.connectionStateProperty],
      (state) => state !== ConnectionState.CONNECTED,
    );
    const isConnectedProperty = new DerivedProperty(
      [source.connectionStateProperty],
      (state) => state === ConnectionState.CONNECTED,
    );

    const createConnectButton = (
      transport: SensorTransportValue,
      labelProperty: TReadOnlyProperty<string>,
      accessibleNameProperty: TReadOnlyProperty<string>,
    ) =>
      new RectangularPushButton({
        ...FLAT_PANEL_PUSH_BUTTON_OPTIONS,
        content: new Text(labelProperty, {
          font: LABEL_FONT,
          fill: LIGHT_SURFACE_TEXT_FILL,
        }),
        // Deliberately not async: the browser must still see this call stack
        // as part of the user gesture, and connect() reports failure through
        // Properties rather than by rejecting.
        listener: () => {
          source.connect(transport).catch(() => undefined);
        },
        accessibleName: accessibleNameProperty,
        visibleProperty: isDisconnectedProperty,
      });

    const connectButton = bluetoothAvailable
      ? createConnectButton(
          SensorTransport.BLUETOOTH,
          sensorStrings.connectBluetoothStringProperty,
          a11y.controls.connectBluetoothButtonStringProperty,
        )
      : null;

    const connectUsbButton = usbAvailable
      ? createConnectButton(
          SensorTransport.USB,
          sensorStrings.connectUsbStringProperty,
          a11y.controls.connectUsbButtonStringProperty,
        )
      : null;

    const disconnectButton = new RectangularPushButton({
      ...FLAT_PANEL_PUSH_BUTTON_OPTIONS,
      content: new Text(sensorStrings.disconnectStringProperty, {
        font: LABEL_FONT,
        fill: LIGHT_SURFACE_TEXT_FILL,
      }),
      listener: () => {
        source.disconnect().catch(() => undefined);
      },
      accessibleName: a11y.controls.disconnectButtonStringProperty,
      visibleProperty: isConnectedProperty,
    });

    const deviceNameProperty = new DerivedProperty([source.deviceNameProperty], (name) => name ?? "");
    const hasDeviceNameProperty = new DerivedProperty([source.deviceNameProperty], (name) => name !== null);
    const deviceNameText = new Text(deviceNameProperty, {
      font: MESSAGE_FONT,
      fill: MotionSensorColors.textColorProperty,
      visibleProperty: hasDeviceNameProperty,
      maxWidth: CONTROL_PANEL_WIDTH - 40,
    });

    // The library's own error text is English and often a raw DOMException
    // message; the one failure students actually hit — the sensor going away —
    // gets a localized sentence instead.
    const errorTextProperty = new DerivedProperty(
      [source.errorMessageProperty, sensorStrings.lostConnectionStringProperty],
      (message, lost) => (message === null ? "" : message === "disconnected" ? lost : message),
    );
    const hasErrorProperty = new DerivedProperty([source.errorMessageProperty], (message) => message !== null);
    // Whole sentences wrap rather than shrink: `maxWidth` on a Text scales the
    // glyphs down, and a two-line explanation squeezed onto one line is the one
    // thing on this panel a student most needs to be able to read.
    const errorText = new RichText(errorTextProperty, {
      font: MESSAGE_FONT,
      fill: MotionSensorColors.statusErrorColorProperty,
      visibleProperty: hasErrorProperty,
      lineWrap: CONTROL_PANEL_WIDTH - 40,
    });

    // Only when neither transport is reachable: with one of them working there
    // is a button to press, and a sentence about the other would be noise.
    const unavailableText = new RichText(
      status === BluetoothStatus.INSECURE_CONTEXT
        ? sensorStrings.unavailableInsecureStringProperty
        : sensorStrings.unavailableBrowserStringProperty,
      {
        font: MESSAGE_FONT,
        fill: MotionSensorColors.textColorProperty,
        visible: !(bluetoothAvailable || usbAvailable),
        lineWrap: CONTROL_PANEL_WIDTH - 40,
      },
    );

    const rawPositionProperty = new PatternStringProperty(sensorStrings.rawPositionPatternStringProperty, {
      position: new DerivedProperty([source.sensorPositionProperty], (metres) => StringUtils.toFixedLTR(metres, 3)),
    });
    const diagnosticsText = new Text(rawPositionProperty, {
      font: MESSAGE_FONT,
      fill: MotionSensorColors.textColorProperty,
      visibleProperty: providedOptions.showDiagnosticsProperty,
      maxWidth: CONTROL_PANEL_WIDTH - 40,
    });

    // Verbatim device output, for telling a real zero reading (nothing in front
    // of the sensor) apart from a device that is answering nothing at all.
    const measurementListText = new Text(source.measurementListProperty, {
      font: MESSAGE_FONT,
      fill: MotionSensorColors.textColorProperty,
      visibleProperty: providedOptions.showDiagnosticsProperty,
      maxWidth: CONTROL_PANEL_WIDTH - 40,
    });
    const rawReadingText = new Text(source.diagnosticsProperty, {
      font: MESSAGE_FONT,
      fill: MotionSensorColors.textColorProperty,
      visibleProperty: providedOptions.showDiagnosticsProperty,
      maxWidth: CONTROL_PANEL_WIDTH - 40,
    });

    super(
      new VBox({
        align: "left",
        spacing: 8,
        preferredWidth: CONTROL_PANEL_WIDTH - 24,
        stretch: true,
        children: [
          statusRow,
          deviceNameText,
          ...(connectButton === null ? [] : [connectButton]),
          ...(connectUsbButton === null ? [] : [connectUsbButton]),
          disconnectButton,
          unavailableText,
          errorText,
          diagnosticsText,
          measurementListText,
          rawReadingText,
        ],
      }),
      { minWidth: CONTROL_PANEL_WIDTH },
    );

    this.connectButton = connectButton;
    this.connectUsbButton = connectUsbButton;
    this.disconnectButton = disconnectButton;

    this.disposeSensorPanel = () => {
      for (const property of [
        statusTextProperty,
        statusColorProperty,
        isDisconnectedProperty,
        isConnectedProperty,
        deviceNameProperty,
        hasDeviceNameProperty,
        errorTextProperty,
        hasErrorProperty,
        rawPositionProperty,
      ]) {
        property.dispose();
      }
    };
  }

  public override dispose(): void {
    this.disposeSensorPanel();
    super.dispose();
  }
}
