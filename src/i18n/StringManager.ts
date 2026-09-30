/**
 * StringManager.ts
 *
 * Centralizes all localized string access for the simulation.
 *
 * Strings are loaded from JSON files per locale and wrapped in reactive
 * Property objects by SceneryStack. When the user switches language in the
 * Preferences dialog, all StringProperties update automatically.
 *
 * ── How to add a locale ───────────────────────────────────────────────────────
 * 1. Create src/i18n/strings_XX.json with the same keys as strings_en.json
 * 2. Import it below and add `XX: stringsXX` to the locale map
 * 3. Add "XX" to `availableLocales` in src/init.ts
 *
 * ── How to add a string ───────────────────────────────────────────────────────
 * 1. Add the key + English value to strings_en.json
 * 2. Add the same key + translated value to ALL other locale files
 *    (TypeScript will show an error here if any locale is missing a key)
 * 3. Expose the new StringProperty via a new getter method below
 */

import type { ReadOnlyProperty } from "scenerystack/axon";
import { LocalizedString } from "scenerystack/chipper";
import stringsEn from "./strings_en.json";
import stringsEs from "./strings_es.json";
import stringsFr from "./strings_fr.json";

// ── Compile-time key-parity check ─────────────────────────────────────────────
// English is the canonical shape; every other locale must match it exactly.
// TypeScript errors here if any locale file is missing (or adds) a key relative to
// English. Add one `satisfies` line per new locale so the check stays exhaustive.
// biome-ignore lint/complexity/noVoid: intentional compile-time type assertion
void (stringsFr satisfies typeof stringsEn);
// biome-ignore lint/complexity/noVoid: intentional compile-time type assertion
void (stringsEn satisfies typeof stringsFr);
// biome-ignore lint/complexity/noVoid: intentional compile-time type assertion
void (stringsEs satisfies typeof stringsEn);
// biome-ignore lint/complexity/noVoid: intentional compile-time type assertion
void (stringsEn satisfies typeof stringsEs);

// ── Build the reactive string property tree ───────────────────────────────────
const stringProperties = LocalizedString.getNestedStringProperties({
  en: stringsEn,
  fr: stringsFr,
  es: stringsEs,
});

/**
 * The a11y shape both screens share, and the only shape the shared ScreenView
 * needs. The Motion Sensor screen's block is a strict superset of the
 * Simulation screen's — same summary regions, same figure and control names,
 * plus connect/disconnect — so one type serves the shared view and each screen
 * reaches for its own extras separately.
 *
 * Keep in sync with the `a11y` key in `strings_en.json`; a rename that is not
 * mirrored here fails at the getter return rather than silently at runtime.
 */
export type ScreenA11yStrings = {
  readonly screenSummary: {
    readonly playAreaStringProperty: ReadOnlyProperty<string>;
    readonly controlAreaStringProperty: ReadOnlyProperty<string>;
    readonly interactionHintStringProperty: ReadOnlyProperty<string>;
  };
  readonly currentDetails: {
    readonly readyStringProperty: ReadOnlyProperty<string>;
    readonly recordingStringProperty: ReadOnlyProperty<string>;
    readonly stoppedStringProperty: ReadOnlyProperty<string>;
    readonly waitingForSensorStringProperty: ReadOnlyProperty<string>;
  };
  readonly controls: {
    readonly walkerStringProperty: ReadOnlyProperty<string>;
    readonly walkerHelpStringProperty: ReadOnlyProperty<string>;
    readonly recordButtonStringProperty: ReadOnlyProperty<string>;
    readonly stopButtonStringProperty: ReadOnlyProperty<string>;
    readonly clearButtonStringProperty: ReadOnlyProperty<string>;
  };
};

/**
 * Everything the ConfigurableGraph needs to name itself: the axis pickers, the
 * zoom and pan buttons, and the sentence spoken when an axis changes. Screen-
 * independent — the same graph appears on both screens, so it reaches for one
 * shared block rather than a per-screen one.
 */
export type GraphA11yStrings = {
  readonly vsStringProperty: ReadOnlyProperty<string>;
  /** " {{vs}} " — spaces live in the pattern so locales can drop or move them. */
  readonly vsPaddedPatternStringProperty: ReadOnlyProperty<string>;
  /** "({{name}}" — the opening parenthesis stays with the vertical-axis name. */
  readonly leadingAxisPatternStringProperty: ReadOnlyProperty<string>;
  /** "{{name}})" — the closing parenthesis stays with the horizontal-axis name. */
  readonly trailingAxisPatternStringProperty: ReadOnlyProperty<string>;
  /** "({{y}} {{vs}} {{x}})" spoken for the title group. */
  readonly titlePatternStringProperty: ReadOnlyProperty<string>;
  readonly xAxisStringProperty: ReadOnlyProperty<string>;
  readonly yAxisStringProperty: ReadOnlyProperty<string>;
  readonly rescaleStringProperty: ReadOnlyProperty<string>;
  readonly zoomInStringProperty: ReadOnlyProperty<string>;
  readonly zoomOutStringProperty: ReadOnlyProperty<string>;
  readonly panLeftStringProperty: ReadOnlyProperty<string>;
  readonly panRightStringProperty: ReadOnlyProperty<string>;
  readonly panUpStringProperty: ReadOnlyProperty<string>;
  readonly panDownStringProperty: ReadOnlyProperty<string>;
  /** "…is now {{property}}." */
  readonly xAxisChangedStringProperty: ReadOnlyProperty<string>;
  readonly yAxisChangedStringProperty: ReadOnlyProperty<string>;
};

/** The Motion Sensor screen's block: the shared shape plus the link controls. */
export type SensorA11yStrings = ScreenA11yStrings & {
  readonly controls: {
    readonly connectBluetoothButtonStringProperty: ReadOnlyProperty<string>;
    readonly connectUsbButtonStringProperty: ReadOnlyProperty<string>;
    readonly disconnectButtonStringProperty: ReadOnlyProperty<string>;
  };
};

/**
 * StringManager is a singleton that provides typed access to all localized
 * strings. Use `StringManager.getInstance()` everywhere — never construct it
 * directly.
 */
export class StringManager {
  private static instance: StringManager | null = null;

  private constructor() {
    // Private — obtain via getInstance()
  }

  public static getInstance(): StringManager {
    if (StringManager.instance === null) {
      StringManager.instance = new StringManager();
    }
    return StringManager.instance;
  }

  /** The simulation title shown in the navigation bar and browser tab. */
  public getTitleStringProperty(): ReadOnlyProperty<string> {
    return stringProperties.titleStringProperty;
  }

  /** Screen name StringProperties used when constructing Screen instances. */
  public getScreenNames(): {
    readonly simulationStringProperty: ReadOnlyProperty<string>;
    readonly sensorStringProperty: ReadOnlyProperty<string>;
  } {
    return {
      simulationStringProperty: stringProperties.screens.simulationStringProperty,
      sensorStringProperty: stringProperties.screens.sensorStringProperty,
    };
  }

  /** Label for the graph's visibility checkbox. */
  public getShowGraphStringProperty(): ReadOnlyProperty<string> {
    return stringProperties.showGraphStringProperty;
  }

  /** Label for the data table's visibility checkbox. */
  public getShowTableStringProperty(): ReadOnlyProperty<string> {
    return stringProperties.showTableStringProperty;
  }

  /** Column choosers, row counter and CSV download in the data table. */
  public getTableStrings() {
    return stringProperties.table;
  }

  /** Labels for the Motion Sensor screen's measurement-adjustment panel. */
  public getSensorOptionsStrings() {
    return stringProperties.sensorOptions;
  }

  /**
   * Names of the plottable quantities, without units — ConfigurableGraph appends
   * the unit from the PlottableProperty itself.
   */
  public getAxesStrings() {
    return stringProperties.axes;
  }

  /** Names and announcements for the configurable graph's own controls. */
  public getGraphA11yStrings(): GraphA11yStrings {
    return stringProperties.graph;
  }

  /** Record-control labels and the elapsed-time readout pattern. */
  public getRunStrings() {
    return stringProperties.run;
  }

  /** Connection status, buttons, and unavailable-browser messages. */
  public getSensorStrings() {
    return stringProperties.sensor;
  }

  /** Accessibility strings for the Simulation screen. */
  public getSimulationA11yStrings(): ScreenA11yStrings {
    return stringProperties.a11y.simulation;
  }

  /** Accessibility strings for the Motion Sensor screen. */
  public getSensorA11yStrings(): SensorA11yStrings {
    return stringProperties.a11y.sensor;
  }

  /** Simulation-specific preference labels shown in Preferences → Simulation. */
  public getPreferences() {
    return stringProperties.preferences;
  }
}
