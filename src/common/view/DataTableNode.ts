import { DATA_TABLE_NODE_SETTINGS } from "../../MotionSensorConstants.js";
/**
 * DataTableNode.ts
 *
 * The recording as numbers: two chosen quantities side by side, one row per
 * sample, and a button that writes what is on screen to a CSV file.
 *
 * ── Why a table at all, next to a graph ───────────────────────────────────────
 * A graph shows shape; a table shows values. Reading "0.85 m at 1.40 s" off a
 * plot is guesswork, and a lab write-up usually wants the numbers. Both are fed
 * from the same recording and the same clock, so a row and a point are the same
 * sample seen twice.
 *
 * ── Two columns, chosen the way the axes are ──────────────────────────────────
 * The column pickers take the same {@link PlottableProperty} list the graph's
 * axis pickers do, so "Velocity" means the same series in both places, and the
 * columns stay aligned row for row because every series comes off the model's
 * one clock.
 *
 * ── Where the rows come from ──────────────────────────────────────────────────
 * From the recorded series (`samples()`), not from the live Property values: the
 * table is a view of the trace, so scrolling back through a finished recording
 * shows what was recorded rather than what the walker is doing now. It follows
 * the newest row while a recording grows and stops following as soon as a
 * student scrolls away from the end — the usual behaviour of a log window.
 */

import {
  DerivedProperty,
  NumberProperty,
  PatternStringProperty,
  Property,
  type TReadOnlyProperty,
} from "scenerystack/axon";
import { toFixed } from "scenerystack/dot";
import { HBox, Node, Rectangle, Text, type TInputListener, VBox } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { ComboBox, RectangularPushButton } from "scenerystack/sun";
import { StringManager } from "../../i18n/StringManager.js";
import MotionSensorColors from "../../MotionSensorColors.js";
import { FLAT_PANEL_PUSH_BUTTON_OPTIONS, LIGHT_SURFACE_TEXT_FILL } from "../MotionSensorButtonOptions.js";
import { MotionSensorPanel } from "../MotionSensorPanel.js";
import type { MotionSensorModel } from "../model/MotionSensorModel.js";
import { type CsvColumn, toCsv } from "./dataTableCsv.js";
import type { PlottableProperty } from "./graph/PlottableProperty.js";

const HEADER_FONT = new PhetFont({ size: DATA_TABLE_NODE_SETTINGS.HEADER_FONT_SIZE, weight: "bold" });
const CELL_FONT = new PhetFont({ size: DATA_TABLE_NODE_SETTINGS.CELL_FONT_SIZE });
const COMBO_BOX_FONT = new PhetFont({ size: DATA_TABLE_NODE_SETTINGS.COMBO_BOX_FONT_SIZE });
const FOOTER_FONT = new PhetFont({ size: DATA_TABLE_NODE_SETTINGS.FOOTER_FONT_SIZE });
const BUTTON_FONT = new PhetFont({ size: DATA_TABLE_NODE_SETTINGS.BUTTON_FONT_SIZE });
const SCROLL_BUTTON_FONT = new PhetFont({ size: DATA_TABLE_NODE_SETTINGS.SCROLL_BUTTON_FONT_SIZE, weight: "bold" });

/**
 * Rows on screen at once. Enough to see a turnaround, and chosen so the panel
 * fits inside the graph's plot area rather than hanging over its tick labels;
 * the rest of a recording is a scroll — or a download — away.
 */
const VISIBLE_ROWS: number = DATA_TABLE_NODE_SETTINGS.VISIBLE_ROWS;
const ROW_HEIGHT: number = DATA_TABLE_NODE_SETTINGS.ROW_HEIGHT;
const COLUMN_WIDTH: number = DATA_TABLE_NODE_SETTINGS.COLUMN_WIDTH;
const COLUMN_GAP: number = DATA_TABLE_NODE_SETTINGS.COLUMN_GAP;
const TABLE_WIDTH = 2 * COLUMN_WIDTH + COLUMN_GAP;

/** Rows moved by one press of a scroll button, or one notch of the wheel. */
const SCROLL_STEP_ROWS: number = DATA_TABLE_NODE_SETTINGS.SCROLL_STEP_ROWS;

/** Decimals in every cell and in the CSV. Three is a millimetre — past any sensor's honesty. */
const VALUE_DECIMALS: number = DATA_TABLE_NODE_SETTINGS.VALUE_DECIMALS;

/** Downloaded file name. Stamped so a student's downloads folder stays sortable. */
function csvFileName(): string {
  return `motion-data-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
}

/** A plottable's display name, resolved whether it is a plain string or localized. */
function nameOf(plottable: PlottableProperty): string {
  return typeof plottable.name === "string" ? plottable.name : plottable.name.value;
}

export type DataTableNodeOptions = {
  readonly model: MotionSensorModel;
  /** The same list the graph's axis pickers use, so the two agree on what a name means. */
  readonly plottableProperties: PlottableProperty[];
  /** Where the combo-box popups go, above everything else. */
  readonly listParent: Node;
  readonly visibleProperty: TReadOnlyProperty<boolean>;
};

export class DataTableNode extends MotionSensorPanel {
  /** Exposed so the ScreenView can order them in the PDOM. */
  public readonly columnAComboBox: ComboBox<PlottableProperty>;
  public readonly columnBComboBox: ComboBox<PlottableProperty>;
  public readonly scrollUpButton: RectangularPushButton;
  public readonly scrollDownButton: RectangularPushButton;
  public readonly downloadButton: RectangularPushButton;

  /** The two selected columns as CSV text — what the download writes. Exposed for tests. */
  public readonly toCsv: () => string;

  private readonly resetDataTableNode: () => void;
  private readonly disposeDataTableNode: () => void;

  public constructor(providedOptions: DataTableNodeOptions) {
    const model = providedOptions.model;
    const plottables = providedOptions.plottableProperties;
    const strings = StringManager.getInstance().getTableStrings();

    // Time against position is where a motion study starts, in the table as on
    // the graph; the seconds column reads down the left the way a lab book does.
    const timePlottable = plottables.find((plottable) => plottable.unit === "s") ?? plottables[0];
    const columnAProperty = new Property<PlottableProperty>(timePlottable as PlottableProperty);
    const columnBProperty = new Property<PlottableProperty>(plottables[0] as PlottableProperty);

    /** Index of the first row on screen. */
    const scrollOffsetProperty = new NumberProperty(0);
    const totalRowsProperty = new NumberProperty(0);
    const firstRowProperty = new NumberProperty(0);
    const lastRowProperty = new NumberProperty(0);

    /** Whether the newest row is pinned in view; true until a student scrolls away from it. */
    let followTail = true;

    const seriesFor = (plottable: PlottableProperty): readonly number[] => plottable.samples?.() ?? [];
    const rowCount = () => Math.min(seriesFor(columnAProperty.value).length, seriesFor(columnBProperty.value).length);

    /**
     * Moves the window by `rows`. Landing on the last row re-arms tail-following,
     * so a student who scrolls back down to the end keeps seeing new samples.
     */
    const scrollBy = (rows: number) => {
      const maximumOffset = Math.max(0, rowCount() - VISIBLE_ROWS);
      const offset = Math.max(0, Math.min(maximumOffset, scrollOffsetProperty.value + rows));
      followTail = offset === maximumOffset;
      scrollOffsetProperty.value = offset;
    };

    // ── Column pickers ────────────────────────────────────────────────────────
    const createComboBox = (
      property: Property<PlottableProperty>,
      accessibleName: TReadOnlyProperty<string>,
    ): ComboBox<PlottableProperty> =>
      new ComboBox(
        property,
        plottables.map((plottable) => ({
          value: plottable,
          createNode: () =>
            new Text(plottable.name, { font: COMBO_BOX_FONT, fill: MotionSensorColors.textColorProperty }),
        })),
        providedOptions.listParent,
        {
          cornerRadius: DATA_TABLE_NODE_SETTINGS.CREATE_COMBO_BOX_CORNER_RADIUS,
          xMargin: DATA_TABLE_NODE_SETTINGS.CREATE_COMBO_BOX_X_MARGIN,
          yMargin: DATA_TABLE_NODE_SETTINGS.CREATE_COMBO_BOX_Y_MARGIN,
          buttonFill: MotionSensorColors.panelBackgroundColorProperty,
          buttonStroke: MotionSensorColors.panelBorderColorProperty,
          listFill: MotionSensorColors.panelBackgroundColorProperty,
          listStroke: MotionSensorColors.panelBorderColorProperty,
          highlightFill: MotionSensorColors.panelBorderColorProperty,
          accessibleName: accessibleName,
        },
      );

    const columnAComboBox = createComboBox(columnAProperty, strings.columnAStringProperty);
    const columnBComboBox = createComboBox(columnBProperty, strings.columnBStringProperty);

    // ── Headings and rows ─────────────────────────────────────────────────────
    const headerA = new Text("", { font: HEADER_FONT, fill: MotionSensorColors.textColorProperty });
    const headerB = new Text("", { font: HEADER_FONT, fill: MotionSensorColors.textColorProperty });
    const headerRow = new Node({ children: [headerA, headerB] });
    const headerRule = new Rectangle(0, 0, TABLE_WIDTH, 1, { fill: MotionSensorColors.panelBorderColorProperty });

    // One Text pair per visible row, created once and rewritten as the window
    // moves. Rebuilding thirteen rows of Text on every sample would churn the
    // scene graph twenty times a second for nothing a reader can see.
    const cells: { readonly a: Text; readonly b: Text }[] = [];
    const rowsNode = new Node();
    for (let row = 0; row < VISIBLE_ROWS; row++) {
      const a = new Text("", { font: CELL_FONT, fill: MotionSensorColors.textColorProperty, top: row * ROW_HEIGHT });
      const b = new Text("", { font: CELL_FONT, fill: MotionSensorColors.textColorProperty, top: row * ROW_HEIGHT });
      cells.push({ a: a, b: b });
      rowsNode.addChild(a);
      rowsNode.addChild(b);
    }

    // A fixed-size body, so the panel does not grow row by row as a recording
    // does — a control that resizes under the pointer is hard to use.
    const body = new Node({
      children: [
        new Rectangle(0, 0, TABLE_WIDTH, VISIBLE_ROWS * ROW_HEIGHT, {
          fill: MotionSensorColors.chartBackgroundColorProperty,
        }),
        rowsNode,
      ],
    });

    // ── Scrolling, the row counter, and the download ──────────────────────────
    const canScrollUpProperty = new DerivedProperty([scrollOffsetProperty], (offset) => offset > 0);
    const canScrollDownProperty = new DerivedProperty(
      [scrollOffsetProperty, totalRowsProperty],
      (offset, total) => offset + VISIBLE_ROWS < total,
    );
    const hasDataProperty = new DerivedProperty([totalRowsProperty], (total) => total > 0);
    const isEmptyProperty = new DerivedProperty([totalRowsProperty], (total) => total === 0);

    const createScrollButton = (
      glyph: string,
      accessibleName: TReadOnlyProperty<string>,
      rows: number,
      enabledProperty: TReadOnlyProperty<boolean>,
    ): RectangularPushButton =>
      new RectangularPushButton({
        ...FLAT_PANEL_PUSH_BUTTON_OPTIONS,
        content: new Text(glyph, { font: SCROLL_BUTTON_FONT, fill: LIGHT_SURFACE_TEXT_FILL }),
        xMargin: DATA_TABLE_NODE_SETTINGS.CREATE_SCROLL_BUTTON_X_MARGIN,
        yMargin: DATA_TABLE_NODE_SETTINGS.CREATE_SCROLL_BUTTON_Y_MARGIN,
        listener: () => scrollBy(rows),
        accessibleName: accessibleName,
        enabledProperty: enabledProperty,
      });

    const scrollUpButton = createScrollButton(
      "▲",
      strings.scrollUpStringProperty,
      -SCROLL_STEP_ROWS,
      canScrollUpProperty,
    );
    const scrollDownButton = createScrollButton(
      "▼",
      strings.scrollDownStringProperty,
      SCROLL_STEP_ROWS,
      canScrollDownProperty,
    );

    const rowsCounterProperty = new PatternStringProperty(strings.rowsPatternStringProperty, {
      first: firstRowProperty,
      last: lastRowProperty,
      total: totalRowsProperty,
    });
    const footer = new Node({
      children: [
        new Text(rowsCounterProperty, {
          font: FOOTER_FONT,
          fill: MotionSensorColors.textColorProperty,
          visibleProperty: hasDataProperty,
          maxWidth: TABLE_WIDTH - DATA_TABLE_NODE_SETTINGS.FOOTER_MAX_WIDTH_OFFSET,
        }),
        new Text(strings.emptyStringProperty, {
          font: FOOTER_FONT,
          fill: MotionSensorColors.textColorProperty,
          visibleProperty: isEmptyProperty,
          maxWidth: TABLE_WIDTH - DATA_TABLE_NODE_SETTINGS.FOOTER_MAX_WIDTH_OFFSET,
        }),
      ],
    });

    /** The two selected columns, as CSV text — exactly the table that is on screen. */
    const buildCsv = (): string => {
      const column = (plottable: PlottableProperty): CsvColumn => ({
        label: plottable.unit === undefined ? nameOf(plottable) : `${nameOf(plottable)} (${plottable.unit})`,
        values: seriesFor(plottable),
      });
      return toCsv([column(columnAProperty.value), column(columnBProperty.value)], VALUE_DECIMALS);
    };

    /**
     * Hands the CSV to the browser's downloader. A Blob URL rather than a data
     * URI, so a long recording is not pushed through a URL-length limit, and it
     * is revoked straight away — the click has already read it.
     */
    const downloadCsv = () => {
      const blob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    };

    // Disposed by hand: ButtonNode wraps its content, so disposing the button's subtree
    // does not reach this Text.
    const downloadLabel = new Text(strings.downloadStringProperty, {
      font: BUTTON_FONT,
      fill: LIGHT_SURFACE_TEXT_FILL,
    });
    const downloadButton = new RectangularPushButton({
      ...FLAT_PANEL_PUSH_BUTTON_OPTIONS,
      content: downloadLabel,
      listener: downloadCsv,
      accessibleName: strings.downloadStringProperty,
      enabledProperty: hasDataProperty,
    });

    // Kept so dispose() can release every control: the buttons and footer Text link to
    // sim-lifetime string and accessible-name Properties, and Panel.dispose() does not
    // dispose its content.
    const content = new VBox({
      align: "left",
      spacing: DATA_TABLE_NODE_SETTINGS.CONSTRUCTOR_SPACING,
      children: [
        new HBox({ spacing: COLUMN_GAP, children: [columnAComboBox, columnBComboBox] }),
        new VBox({
          align: "left",
          spacing: DATA_TABLE_NODE_SETTINGS.ITEM_2_SPACING,
          children: [headerRow, headerRule, body],
        }),
        new HBox({
          spacing: DATA_TABLE_NODE_SETTINGS.ITEM_3_SPACING,
          children: [scrollUpButton, scrollDownButton, footer],
        }),
        downloadButton,
      ],
    });

    super(content, {
      xMargin: DATA_TABLE_NODE_SETTINGS.CONSTRUCTOR_X_MARGIN,
      yMargin: DATA_TABLE_NODE_SETTINGS.CONSTRUCTOR_Y_MARGIN,
    });

    this.columnAComboBox = columnAComboBox;
    this.columnBComboBox = columnBComboBox;
    this.scrollUpButton = scrollUpButton;
    this.scrollDownButton = scrollDownButton;
    this.downloadButton = downloadButton;
    this.toCsv = buildCsv;
    this.visibleProperty = providedOptions.visibleProperty;

    // ── Keeping the cells in step with the trace ──────────────────────────────
    const updateHeaders = () => {
      const pattern = strings.headerPatternStringProperty.value;
      const label = (plottable: PlottableProperty) =>
        plottable.unit === undefined
          ? nameOf(plottable)
          : pattern.replace("{{name}}", nameOf(plottable)).replace("{{unit}}", plottable.unit);
      headerA.string = label(columnAProperty.value);
      headerB.string = label(columnBProperty.value);
      headerA.right = COLUMN_WIDTH;
      headerB.right = TABLE_WIDTH;
    };

    const updateRows = () => {
      const seriesA = seriesFor(columnAProperty.value);
      const seriesB = seriesFor(columnBProperty.value);
      const total = Math.min(seriesA.length, seriesB.length);
      totalRowsProperty.value = total;

      const maximumOffset = Math.max(0, total - VISIBLE_ROWS);
      if (followTail || scrollOffsetProperty.value > maximumOffset) {
        scrollOffsetProperty.value = maximumOffset;
      }
      const offset = scrollOffsetProperty.value;

      for (let row = 0; row < VISIBLE_ROWS; row++) {
        const cell = cells[row];
        if (cell === undefined) {
          continue;
        }
        const valueA = seriesA[offset + row];
        const valueB = seriesB[offset + row];
        cell.a.string = valueA === undefined ? "" : toFixed(valueA, VALUE_DECIMALS);
        cell.b.string = valueB === undefined ? "" : toFixed(valueB, VALUE_DECIMALS);
        cell.a.right = COLUMN_WIDTH;
        cell.b.right = TABLE_WIDTH;
      }

      // Row numbers a student can say out loud start at 1, not at 0.
      firstRowProperty.value = total === 0 ? 0 : offset + 1;
      lastRowProperty.value = Math.min(total, offset + VISIBLE_ROWS);
    };

    updateHeaders();
    updateRows();

    // Redraw on the next frame rather than from inside the model's notification:
    // rewriting Text bounds synchronously there can re-enter the very Property
    // that called us. Same reason the graph batches its own updates.
    let updateFrame: number | null = null;
    const scheduleUpdate = () => {
      if (updateFrame === null) {
        updateFrame = requestAnimationFrame(() => {
          updateFrame = null;
          updateRows();
        });
      }
    };
    model.traceChangedProperty.lazyLink(scheduleUpdate);

    const columnListener = () => {
      updateHeaders();
      updateRows();
    };
    columnAProperty.lazyLink(columnListener);
    columnBProperty.lazyLink(columnListener);
    scrollOffsetProperty.lazyLink(updateRows);

    // A locale change rewrites the headings under us; they are plain strings
    // rather than StringProperties because they are built from two sources.
    const headerSources: TReadOnlyProperty<string>[] = [
      ...plottables
        .map((plottable) => plottable.name)
        .filter((name): name is TReadOnlyProperty<string> => typeof name !== "string"),
      strings.headerPatternStringProperty,
    ];
    for (const source of headerSources) {
      source.lazyLink(updateHeaders);
    }

    // The wheel scrolls the rows under the pointer, which is where a reader
    // reaches first; the buttons are the keyboard-reachable equivalent.
    const wheelListener: TInputListener = {
      wheel: (event) => {
        const domEvent = event.domEvent;
        if (domEvent !== null && domEvent.deltaY !== 0) {
          scrollBy(Math.sign(domEvent.deltaY) * SCROLL_STEP_ROWS);
        }
      },
    };
    body.addInputListener(wheelListener);

    this.resetDataTableNode = () => {
      columnAProperty.reset();
      columnBProperty.reset();
      followTail = true;
      scrollOffsetProperty.reset();
    };

    this.disposeDataTableNode = () => {
      model.traceChangedProperty.unlink(scheduleUpdate);
      if (updateFrame !== null) {
        cancelAnimationFrame(updateFrame);
      }
      body.removeInputListener(wheelListener);
      columnAProperty.unlink(columnListener);
      columnBProperty.unlink(columnListener);
      scrollOffsetProperty.unlink(updateRows);
      for (const source of headerSources) {
        source.unlink(updateHeaders);
      }
      // The controls first (including both combo boxes), while the Properties they
      // listen to still exist.
      content.disposeSubtree();
      downloadLabel.dispose();
      for (const disposable of [
        rowsCounterProperty,
        canScrollUpProperty,
        canScrollDownProperty,
        hasDataProperty,
        isEmptyProperty,
        columnAProperty,
        columnBProperty,
        scrollOffsetProperty,
        totalRowsProperty,
        firstRowProperty,
        lastRowProperty,
      ]) {
        disposable.dispose();
      }
    };
  }

  public reset(): void {
    this.resetDataTableNode();
  }

  public override dispose(): void {
    this.disposeDataTableNode();
    super.dispose();
  }
}
