/**
 * main.ts
 *
 * Entry point for the simulation. Initializes SceneryStack, creates the
 * screens, and starts the main event loop.
 *
 * !! CRITICAL IMPORT ORDER !!
 * brand.js MUST be the first import. Each module imports the next, so the import nesting is
 *
 *   main → brand → splash → assert → init
 *
 * and therefore the actual EXECUTION order (deepest import runs first) is the reverse:
 *
 *   init → assert → splash → brand → main
 *
 * SceneryStack requires this exact load order. Never reorder these imports.
 */

// brand.js MUST be first; importing it runs the whole chain (init→assert→splash→brand) before main.
import "./brand.js";

import { onReadyToLaunch, PreferencesModel, Sim } from "scenerystack/sim";
import { Tandem } from "scenerystack/tandem";
import { StringManager } from "./i18n/StringManager.js";
import MotionSensorColors from "./MotionSensorColors.js";
import { MotionSensorPreferencesModel } from "./preferences/MotionSensorPreferencesModel.js";
import { MotionSensorPreferencesNode } from "./preferences/MotionSensorPreferencesNode.js";
import { SensorScreen } from "./sensor/SensorScreen.js";
import { SimulationScreen } from "./simulation/SimulationScreen.js";

onReadyToLaunch(() => {
  const stringManager = StringManager.getInstance();

  // Simulation-specific preferences; initial values come from motionSensorQueryParameters.
  const simPreferences = new MotionSensorPreferencesModel(Tandem.ROOT.createTandem("preferences"));

  const screens = [
    new SimulationScreen(simPreferences, {
      // The screen name Property updates automatically when the locale changes
      name: stringManager.getScreenNames().simulationStringProperty,
      tandem: Tandem.ROOT.createTandem("simulationScreen"),
      backgroundColorProperty: MotionSensorColors.backgroundColorProperty,
    }),
    new SensorScreen(simPreferences, {
      // The screen name Property updates automatically when the locale changes
      name: stringManager.getScreenNames().sensorStringProperty,
      tandem: Tandem.ROOT.createTandem("sensorScreen"),
      backgroundColorProperty: MotionSensorColors.backgroundColorProperty,
    }),
  ];

  const sim = new Sim(stringManager.getTitleStringProperty(), screens, {
    preferencesModel: new PreferencesModel({
      visualOptions: {
        // Adds a "Projector Mode" toggle in Preferences → Visual
        supportsProjectorMode: true,
        // Enables keyboard-navigation highlight outlines
        supportsInteractiveHighlights: true,
      },
      simulationOptions: {
        customPreferences: [
          {
            createContent: (tandem: Tandem) => new MotionSensorPreferencesNode(simPreferences, tandem),
          },
        ],
      },
      localizationOptions: {
        // Adds a language picker in Preferences → Language
        supportsDynamicLocale: true,
      },
    }),

    // Optional: fill in credits shown in Help → About
    credits: {
      softwareDevelopment: "OpenLyceum",
    },
  });

  sim.start();
});
