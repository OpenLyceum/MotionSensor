import { GRAPH_ANNOUNCER_SETTINGS } from "../../MotionSensorConstants.js";
/**
 * GraphAnnouncer.ts
 *
 * Voicing for the configurable graph. Changing an axis replaces the plot
 * wholesale — the label, the scale and every point — which a sighted user takes
 * in at a glance and a screen-reader user otherwise learns only by hunting. One
 * spoken sentence per change closes that gap.
 *
 * Voicing is used rather than a manual ARIA live region so the announcement
 * honours the user's own voicing preferences, following PhET's practice.
 *
 * The utterance is reused and given a stable delay so that flicking through the
 * combo box announces where you landed, not every option you passed on the way.
 */

import { voicingUtteranceQueue } from "scenerystack/scenery";
import { Utterance } from "scenerystack/utterance-queue";
import MotionSensorNamespace from "../../MotionSensorNamespace.js";

/**
 * Milliseconds of quiet required before an axis change is spoken. Long enough
 * to swallow a run of rapid selections, short enough not to feel laggy.
 */
const GRAPH_CHANGE_ANNOUNCEMENT_DELAY: number = GRAPH_ANNOUNCER_SETTINGS.GRAPH_CHANGE_ANNOUNCEMENT_DELAY;

const graphChangeUtterance = new Utterance({
  priority: 1,
  alertStableDelay: GRAPH_CHANGE_ANNOUNCEMENT_DELAY,
});

/**
 * Speak a sentence describing a change to the graph.
 */
export function announceGraphChange(message: string): void {
  graphChangeUtterance.alert = message;
  voicingUtteranceQueue.addToBack(graphChangeUtterance);
}

MotionSensorNamespace.register("announceGraphChange", announceGraphChange);
