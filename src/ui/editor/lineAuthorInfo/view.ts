import { gutter, GutterMarker } from "@codemirror/view";
import * as moment from "moment";
import { DATE_FORMAT, DATE_TIME_FROMAT_MINUTES } from "src/constants";
import { parseColoringMaxAgeDuration } from "src/settings";
import {
  BlameCommit,
  LineAuthorDateTimeFormatOptions,
  LineAuthorDisplay,
} from "src/types";
import { lineAuthorSettingsExtension } from "src/ui/editor/lineAuthorInfo/control";
import {
  LineAuthoring,
  LineAuthorSettings,
  lineAuthorState,
  OptLineAuthoring,
} from "src/ui/editor/lineAuthorInfo/model";
import { typeCheckedUnreachable as impossibleBranch } from "src/utils";

const RESULT_AWAITING_FALLBACK = "...";
const VALUE_NOT_FOUND_FALLBACK = "-";
const NEW_COMMIT = "+++";

/*

Document this workflow somewhere.

tracked changes within obsidian -> initiate computation | done

computation finished -> publish new value to subscribers for the finished file | done

editors subscribe to their file at startup | done

subscribed editors update their internal state | done

state/editor update -> gutter can get new value | done.


todo.
document that line author information does not show up in reading mode.
it's not a CM6 editor. Adding that would be quite an effort. For now it'll be just left out.

*/

/** todo. */
export const lineAuthorGutter = gutter({
  // class: "gutter-wip-class", // todo. use this to enable custom styling for users.
  lineMarker(view, line, _otherMarkers) {
    const lineAuthoring = view.state.field(lineAuthorState, false);
    const settings: LineAuthorSettings = view.state.field(
      lineAuthorSettingsExtension,
      false
    );
    const currLine = view.state.doc.lineAt(line.from).number;

    const result: LineAuthoringGutter | string = getLineAuthorInfo(
      currLine,
      lineAuthoring,
      settings,
      RESULT_AWAITING_FALLBACK
    );

    return typeof result === "string" ? new TextGutter(result) : result;
  },
  // Only change, when we have any state change
  lineMarkerChange(update) {
    const newLAid = update.state.field(lineAuthorState)?.[0];
    const oldLAid = update.startState.field(lineAuthorState)?.[0];
    const idsDifferent = oldLAid !== newLAid;

    idsDifferent && console.log("Updating lineMarker.");

    return idsDifferent;
  },
  renderEmptyElements: true,
});

/** todo. */
function getLineAuthorInfo(
  currLine: number,
  optLineAuthoring: OptLineAuthoring,
  settings: LineAuthorSettings,
  resultAwaitingFallback: string
): LineAuthoringGutter | string {
  if (optLineAuthoring === undefined) {
    return resultAwaitingFallback;
  }

  const [key, lineAuthoring] = optLineAuthoring;

  return currLine < lineAuthoring.hashPerLine.length
    ? new LineAuthoringGutter(lineAuthoring, currLine, key, settings)
    : resultAwaitingFallback;
}

class TextGutter extends GutterMarker {
  constructor(public text: string) {
    super();
  }

  eq(other: GutterMarker): boolean {
    return this.text === (<any>other)?.text;
  }

  toDOM() {
    return document.createTextNode(this.text);
  }

  destroy(dom: Node): void {
    dom.parentNode.removeChild(dom);
  }
}

/** todo. */
class LineAuthoringGutter extends GutterMarker {
  constructor(
    public readonly la: LineAuthoring,
    public readonly line: number,
    public readonly key: string,
    public readonly settings: LineAuthorSettings
  ) {
    super();
  }

  eq(other: GutterMarker): boolean {
    return this.key === (<any>other)?.key && this.line === (<any>other)?.line;
  }

  elementClass: string = "obs-git-blame-gutter";

  toDOM() {
    const lineAuthoring = this.la;

    // todo. show * if comitter and author date and time are different?

    const commitHash = lineAuthoring.hashPerLine[this.line];
    const commit = lineAuthoring.commits.get(commitHash);

    const optionalShortHash = this.settings.showCommitHash
      ? commitHash.substring(0, 6)
      : "";

    const optionalAuthorName =
      this.settings.authorDisplay === "hide"
        ? ""
        : ` ${authorName(commit, this.settings.authorDisplay)}`;

    const optionalAuthoringDate =
      this.settings.dateTimeFormatOptions === "hide"
        ? ""
        : ` ${authoringDate(
            commit,
            this.settings.dateTimeFormatOptions,
            this.settings
          )}`;

    const node = document.body.createDiv();

    // Add basic color. todo. calibrate and improve. make adaptive to dark mode
    node.style.backgroundColor = commitAuthoringAgeBasedColor(
      commit,
      this.settings
    );
    node.style.color = "var(--text-normal)";
    node.style.fontSize = "1.2em";
    node.style.fontFamily = "monospace";
    node.style.height = "100%";
    node.style.textAlign = "right";
    node.style.borderWidth = "1px 3px 1px 3px";
    node.style.borderStyle = "solid";
    node.style.borderColor = "var(--background-secondary)";
    node.style.padding = "0px 5px 0px 5px";

    // todo. use maximum text length for each element to ensure predictable spacing
    node.innerText = [
      optionalShortHash,
      optionalAuthorName,
      optionalAuthoringDate,
    ].join("");

    return node;
  }

  destroy(dom: Node): void {
    dom.parentNode.removeChild(dom);
  }
}

function authorName(
  commit: BlameCommit,
  authorDisplay: Exclude<LineAuthorDisplay, "hide">
) {
  if (commit.isZeroCommit) return NEW_COMMIT;

  const name = commit.author.name;
  const words = name.split(" ").filter((word) => word.length >= 1);

  switch (authorDisplay) {
    case "initials":
      return words.map((word) => word[0].toUpperCase()).join("");
    case "first name":
      return words.first() ?? VALUE_NOT_FOUND_FALLBACK;
    case "last name":
      return words.last() ?? VALUE_NOT_FOUND_FALLBACK;
    case "full":
      return name;
    default:
      return impossibleBranch(authorDisplay);
  }
}

function authoringDate(
  commit: BlameCommit,
  dateTimeFormatOptions: Exclude<LineAuthorDateTimeFormatOptions, "hide">,
  settings: LineAuthorSettings
) {
  if (commit.isZeroCommit) return NEW_COMMIT;

  const FALLBACK_COMMIT_DATE = "?";

  if (dateTimeFormatOptions === "natural language") {
    console.warn(
      "date time format options not supported",
      dateTimeFormatOptions
    );
    return FALLBACK_COMMIT_DATE;
  }

  if (commit?.author?.epochSeconds === undefined) return FALLBACK_COMMIT_DATE;

  let dateTimeFormat;

  switch (dateTimeFormatOptions) {
    case "date":
      dateTimeFormat = DATE_FORMAT;
      break;
    case "datetime":
      dateTimeFormat = DATE_TIME_FROMAT_MINUTES;
      break;
    case "custom":
      dateTimeFormat = settings.dateTimeFormatCustomString;
      break;
    default:
      return impossibleBranch(dateTimeFormatOptions);
  }

  let authoringDate = moment.unix(commit.author.epochSeconds);

  switch (settings.dateTimeTimezone) {
    case "local": // moment uses local timezone by default.
      break;
    case "utc":
      authoringDate = authoringDate.utcOffset(commit.author.tz);
      dateTimeFormat += " Z";
      break;
    default:
      return impossibleBranch(settings.dateTimeTimezone);
  }

  return authoringDate.format(dateTimeFormat);
}

function commitAuthoringAgeBasedColor(
  commit: BlameCommit,
  settings: LineAuthorSettings
): string {
  const maxAgeInDays =
    parseColoringMaxAgeDuration(settings.coloringMaxAge)?.asDays() ?? 356;

  const epochSecondsNow = Date.now() / 1000;
  const authoringEpochSeconds = commit?.author?.epochSeconds ?? 0;

  const secondsSinceCommit = commit.isZeroCommit
    ? 0
    : epochSecondsNow - authoringEpochSeconds;

  const daysSinceCommit = secondsSinceCommit / 60 / 60 / 24;

  // 0 <= x <= 1, larger means older
  // use n-th-root to make recent changes more prnounced
  const x = Math.pow(Math.clamp(daysSinceCommit / maxAgeInDays, 0, 1), 1 / 2.3);

  const color0 = { r: 255, g: 150, b:150 };
  const color1 = { r: 120, g: 160, b:255 };

  const r = lin(color0.r, color1.r, x);
  const g = lin(color0.g, color1.g, x);
  const b = lin(color0.b, color1.b, x);

  return `rgba(${r},${g},${b},0.25)`; // todo. use 0.4 in dark mode
}

function lin(z0: number, z1: number, x: number): number {
  return z0 + (z1 - z0) * x;
}

// colors were picked via:
// https://color.adobe.com/de/create/color-accessibility
