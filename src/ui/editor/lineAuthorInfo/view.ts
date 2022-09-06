import { gutter, GutterMarker } from "@codemirror/view";
import * as moment from "moment";
import { BlameCommit } from "src/types";
import {
  lineAuthorSettingsExtension
} from "src/ui/editor/lineAuthorInfo/control";
import {
  LineAuthoring,
  LineAuthorSettings,
  lineAuthorState,
  OptLineAuthoring
} from "src/ui/editor/lineAuthorInfo/model";

const RESULT_AWAITING_FALLBACK = "...";
const VALUE_NOT_FOUND_FALLBACK = "-";

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

    const hash = lineAuthoring.hashPerLine[this.line];
    const commit = lineAuthoring.commits.get(hash);
    const node = document.body.createSpan();
    const name = () =>
      (!commit.isZeroCommit &&
        formatName(commit?.committer?.name, this.settings)) ||
      VALUE_NOT_FOUND_FALLBACK;
    const optionalName =
      this.settings.authorDisplay === "hide" ? "" : ` ${name()}`;

    const commitDate =
      (!commit.isZeroCommit && formatCommitDate(commit)) ||
      VALUE_NOT_FOUND_FALLBACK;

    // Add basic color. todo. calibrate and improve.
    node.style.backgroundColor = commitAgeBasedColor(commit);
    node.style.color = "black";

    // todo. use maximum text length for each element to ensure predictable spacing
    node.innerText = `${hash.substring(0, 6)}${optionalName} ${commitDate}`;

    return node;
  }

  destroy(dom: Node): void {
    dom.parentNode.removeChild(dom);
  }
}

/** todo. */
function formatCommitDate(commit: BlameCommit) {
  let commitDate = "?";
  if (commit?.committer?.epochSeconds) {
    commitDate = moment
      .unix(commit.committer.epochSeconds)
      .utcOffset(commit.committer.tz)
      .toDate()
      .toLocaleDateString();
  }
  return commitDate;
}

/** todo. */
function formatName(name: string, settings: LineAuthorSettings) {
  const words = name.split(" ").filter((word) => word.length >= 1);
  switch (settings.authorDisplay) {
    case "initials":
      return words.map((word) => word[0].toUpperCase()).join(".");
    case "first name":
      return words.first() ?? VALUE_NOT_FOUND_FALLBACK;
    case "last name":
      return words.last() ?? VALUE_NOT_FOUND_FALLBACK;
    case "full":
      return name;
    default:
      console.warn(
        "Unknown author display setting encountered: ",
        settings.authorDisplay
      );
      // todo. telemetry?
      return VALUE_NOT_FOUND_FALLBACK; // shouldn't happen
  }
}

const MAX_AGE_IN_DAYS = 1 * 356;

function commitAgeBasedColor(commit: BlameCommit): string {
  const secondsSinceCommit = commit.isZeroCommit
    ? 0
    : Date.now() / 1000 - (commit?.committer?.epochSeconds || 0);

  const daysSinceCommit = secondsSinceCommit / 60 / 60 / 24;

  // 0 <= x <= 1, larger means older
  // use sqrt to make recent changes more prnounced
  const x = Math.sqrt(Math.clamp(daysSinceCommit / MAX_AGE_IN_DAYS, 0, 1));

  const r = 255 * (1 - x * x);
  const g = 50;
  const b = 255 * (x * x);

  return `rgba(${r},${g},${b},0.2)`;
}
