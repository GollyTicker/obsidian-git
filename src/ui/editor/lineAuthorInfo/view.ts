import { gutter, GutterMarker } from "@codemirror/view";
import * as moment from "moment";
import { DATE_FORMAT, DATE_TIME_FORMAT_MINUTES } from "src/constants";
import { parseColoringMaxAgeDuration } from "src/settings";
import {
    BlameCommit,
    GitTimestamp,
    LineAuthorDateTimeFormatOptions,
    LineAuthorDisplay,
    UserEmail
} from "src/types";
import { registerLastClickedGutterHandler } from "src/ui/editor/lineAuthorInfo/contextMenu";
import { settingsStateField } from "src/ui/editor/lineAuthorInfo/control";
import {
    LineAuthoring,
    LineAuthorSettings,
    lineAuthorState, OptLineAuthoring,
    zeroCommit
} from "src/ui/editor/lineAuthorInfo/model";
import { currentMoment, median, momentToEpochSeconds, typeCheckedUnreachable as impossibleBranch } from "src/utils";


const VALUE_NOT_FOUND_FALLBACK = "-";
const NEW_COMMIT = "+++";

const NON_WHITESPACE_REGEXP = /\S/g;
const UNINTRUSIVE_CHARACTER_FOR_INITIAL_DUMMY_RENDERING = "%";

/**
 * This fallback for the spacing of a view only happens, when Obsidian
 * is opened. For every subsequent opened file, the view uses {@link longestRenderedGutter}
 * to avoid distracting spacing updates.
 */
const SPACING_FALLBACK = 5;
// todo. can we somehow cache the longest gutter across restarts in the filesystem or so?
// what is the Obsidian API for that?

const ADAPTIVE_INITIAL_COLORING_AGE_CACHE_SIZE = 50;

type LongestGutterCache = { gutter: LineAuthoringGutter, length: number; text: string; };
let longestRenderedGutter: LongestGutterCache | undefined = undefined;

let renderedAgeInDaysForAdaptiveInitialColoring: number[] = [];
let ageIdx = 0;
function recordRenderedAgeInDays(age: number) {
    renderedAgeInDaysForAdaptiveInitialColoring[ageIdx] = age;
    ageIdx = (ageIdx + 1) % ADAPTIVE_INITIAL_COLORING_AGE_CACHE_SIZE;
}
function computeAdaptiveInitialColoringAgeInDays(): number | undefined {
    return median(renderedAgeInDaysForAdaptiveInitialColoring);
}

export function clearViewCache() {
    longestRenderedGutter = undefined;
    renderedAgeInDaysForAdaptiveInitialColoring = [];
    ageIdx = 0;
}

// todo. closing a window somehow leads to an illegal access error.

// todo. opening the same note multiple times sometimes leads to unpopulated blame

// todo. while navigating with the line authoring view, I saw, that
// re-opening previously closed files, the gutter still appears delayed.
// I'd expect, that it is shown immediately without a delay.
// How might we compute/retrieve it earlier?

/** todo. */
export const lineAuthorGutter = gutter({
    class: "gutter-wip-class",
    // todo. use this to style entire gutter v-line. i.e. styling of alignment

    lineMarker(view, line, _otherMarkers) {
        const lineAuthoring = view.state.field(lineAuthorState, false);
        const settings: LineAuthorSettings = view.state.field(
            settingsStateField,
            false
        );

        // We have two line numbers here, because embeds, tables and co. cause
        // multiple lines to be rendered with a single gutter. Hence, we need to
        // choose the youngest commit - of which the info will be shown.
        const startLine = view.state.doc.lineAt(line.from).number;
        const endLine = view.state.doc.lineAt(line.to).number;
        const totalLines = view.state.doc.lines;

        return getLineAuthorInfo(
            startLine,
            endLine,
            totalLines,
            lineAuthoring,
            settings
        );
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
    initialSpacer(_v) {
        return new TextGutter(new Array(SPACING_FALLBACK).fill("-").join(""));
    },
    updateSpacer(spacer, update) {
        const settings = update.state.field(settingsStateField, false);
        if (settings?.authorDisplay === undefined) return spacer;

        // todo. give the line authoring the background color, so that it doesn't quickly jump from white to red/blue.
        // Alternatively, we can color it by the half of bothconfigured colors.

        return longestRenderedGutter?.gutter ?? new TextGutter(Array(SPACING_FALLBACK).fill("-").join(""));
    },
});

/** todo. */
function getLineAuthorInfo(
    startLine: number,
    endLine: number,
    totalLines: number,
    optLineAuthoring: OptLineAuthoring,
    settings: LineAuthorSettings
): LineAuthoringGutter | TextGutter {
    if (startLine === totalLines) { // don't display on last empty newline
        return UNDISPLAYED;
    }

    if (optLineAuthoring === undefined) {
        return fallbackLineAuthoringGutter(settings);
    }

    const [key, lineAuthoring] = optLineAuthoring;

    if (lineAuthoring === "untracked") {
        return newUntrackedFileGutter(key, settings);
    }

    return endLine < lineAuthoring.hashPerLine.length
        ? new LineAuthoringGutter(lineAuthoring, startLine, endLine, key, settings)
        : UNDISPLAYED;
}

function fallbackLineAuthoringGutter(settings: LineAuthorSettings) {
    return new LineAuthoringGutter(fallbackLineAuthoring(settings), 1, 1, "undefined", settings, "dummy-data")
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

const UNDISPLAYED = new TextGutter("");

/** todo. */
class LineAuthoringGutter extends GutterMarker {
    constructor(
        public readonly la: Exclude<LineAuthoring, "untracked">,
        public readonly startLine: number,
        public readonly endLine: number,
        public readonly key: string,
        public readonly settings: LineAuthorSettings,
        public readonly options?: "dummy-data",
    ) {
        super();
    }

    eq(other: GutterMarker): boolean {
        return (
            this.key === (<LineAuthoringGutter>other)?.key &&
            this.startLine === (<LineAuthoringGutter>other)?.startLine &&
            this.endLine === (<LineAuthoringGutter>other)?.endLine
        );
    }

    elementClass: string = "obs-git-blame-gutter";

    toDOM() {
        const lineAuthoring = this.la;

        // todo. show * if comitter and author date and time are different?

        const { hash, commit } = chooseNewestCommitHash(
            lineAuthoring,
            this.startLine,
            this.endLine
        );

        const optionalShortHash = this.settings.showCommitHash
            ? displayHash(hash, commit)
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

        // save this gutters info on mousedown so that the corresponding
        // right-click / context-menu has access to this commit info.
        registerLastClickedGutterHandler(node, hash, commit);

        // Add basic color based on commit age
        node.style.backgroundColor = commitAuthoringAgeBasedColor(
            commit?.author?.epochSeconds,
            commit?.isZeroCommit,
            this.settings
        );

        let toBeRenderedText = [
            optionalShortHash,
            optionalAuthorName,
            optionalAuthoringDate,
        ].join("");

        if (this.options !== "dummy-data" &&
            toBeRenderedText.length > (longestRenderedGutter?.length ?? 0)
        ) {
            longestRenderedGutter = { gutter: this, length: toBeRenderedText.length, text: toBeRenderedText };
        }

        if (this.options === "dummy-data") {
            const original = longestRenderedGutter?.text ?? toBeRenderedText;
            toBeRenderedText = original.replace(NON_WHITESPACE_REGEXP, UNINTRUSIVE_CHARACTER_FOR_INITIAL_DUMMY_RENDERING);
        }

        node.innerText = toBeRenderedText;

        return node;
    }

    destroy(dom: Node): void {
        dom.parentNode.removeChild(dom);
    }
}

function displayHash(hash: string, commit: BlameCommit) {
    return commit.isZeroCommit ? NEW_COMMIT : hash.substring(0, 6);
}

/**
 * Renders the author of the commit into a string.
 * 
 * <b>When chaging this, please also update {@link spac}
 */
function authorName(
    commit: BlameCommit,
    authorDisplay: Exclude<LineAuthorDisplay, "hide">
): string {
    if (commit.isZeroCommit) return NEW_COMMIT;

    const name = commit.author.name;
    const words = name.split(" ").filter((word) => word.length >= 1);

    switch (authorDisplay) {
        case "unique initials":
            // todo.
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
            dateTimeFormat = DATE_TIME_FORMAT_MINUTES;
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

export function previewColor(which: "older" | "recent", settings: LineAuthorSettings) {
    return which === "older" ?
        commitAuthoringAgeBasedColor(0 /* epoch time: 1970 */, false, settings) :
        commitAuthoringAgeBasedColor(undefined, true, settings)
}

function commitAuthoringAgeBasedColor(
    commitAuthorEpochSeonds: GitTimestamp["epochSeconds"],
    isZeroCommit: boolean,
    settings: LineAuthorSettings
): string {
    const maxAgeInDays = maxAgeInDaysFromSettings(settings);

    const epochSecondsNow = Date.now() / 1000;
    const authoringEpochSeconds = commitAuthorEpochSeonds ?? 0;

    const secondsSinceCommit = isZeroCommit
        ? 0
        : epochSecondsNow - authoringEpochSeconds;

    const daysSinceCommit = secondsSinceCommit / 60 / 60 / 24;

    recordRenderedAgeInDays(daysSinceCommit);

    // 0 <= x <= 1, larger means older
    // use n-th-root to make recent changes more prnounced
    const x = Math.pow(Math.clamp(daysSinceCommit / maxAgeInDays, 0, 1), 1 / 2.3);

    const dark = isDarkMode();

    const color0 = settings.colorNew;
    const color1 = settings.colorOld;

    const scaling = dark ? 0.4 : 1;
    const r = lin(color0.r, color1.r, x) * scaling;
    const g = lin(color0.g, color1.g, x) * scaling;
    const b = lin(color0.b, color1.b, x) * scaling;
    const a = dark ? 0.75 : 0.25;

    return `rgba(${r},${g},${b},${a})`;
}

// todo. small tooltip widget when hovering on line author gutter with author/hash, etc.
// -> write into issue for future

function lin(z0: number, z1: number, x: number): number {
    return z0 + (z1 - z0) * x;
}

function chooseNewestCommitHash(
    lineAuthoring: Exclude<LineAuthoring, "untracked">,
    startLine: number,
    endLine: number
) {
    const startHash = lineAuthoring.hashPerLine[startLine];

    let newest = {
        hash: startHash,
        commit: lineAuthoring.commits.get(startHash),
    };

    if (startLine === endLine) return newest;

    for (let line = startLine + 1; line <= endLine; line++) {
        const currentHash = lineAuthoring.hashPerLine[line];
        const currentCommit = lineAuthoring.commits.get(currentHash);

        if (
            currentCommit.isZeroCommit ||
            isNewerThan(currentCommit, newest.commit)
        ) {
            newest = { hash: currentHash, commit: currentCommit };
        }
    }

    return newest;
}

function getAbsoluteAuthoringMoment(commit: BlameCommit) {
    // todo. does this case even ever happen?
    if (commit?.author?.epochSeconds === undefined)
        return moment.unix(Date.now() / 1000);

    return moment.unix(commit.author.epochSeconds).utcOffset(commit.author.tz);
}

function isNewerThan(left: BlameCommit, right: BlameCommit): boolean {
    const l = getAbsoluteAuthoringMoment(left);
    const r = getAbsoluteAuthoringMoment(right);
    const diff = l.diff(r, "minutes"); // l - r > 0  <=>  l > r  <=>  l is newer
    return diff > 0;
}

function newUntrackedFileGutter(key: string, settings: LineAuthorSettings) {
    const untrackedDummyLineAuthoring = untrackedFileLineAuthoring();
    return new LineAuthoringGutter(
        untrackedDummyLineAuthoring,
        1,
        1,
        key,
        settings
    );
}

// todo. explain render age coloring
function fallbackLineAuthoring(settings: LineAuthorSettings): Exclude<LineAuthoring, "untracked"> {
    const ageForInitialRender = computeAdaptiveInitialColoringAgeInDays() ?? maxAgeInDaysFromSettings(settings) * 0.5;
    const slightlyOlderAgeForInitialRender = currentMoment().add(-ageForInitialRender, "days");

    const author: UserEmail & GitTimestamp = {
        name: "",
        email: "",
        epochSeconds: momentToEpochSeconds(slightlyOlderAgeForInitialRender),
        tz: "+0000",
    };
    const unknownCommit: BlameCommit = {
        hash: VALUE_NOT_FOUND_FALLBACK,
        summary: "",
        author: author,
        committer: author,
        isZeroCommit: false
    };
    return {
        hashPerLine: [undefined, VALUE_NOT_FOUND_FALLBACK],
        originalFileLineNrPerLine: undefined,
        groupSizePerStartingLine: undefined,
        finalFileLineNrPerLine: undefined,
        commits: new Map([[VALUE_NOT_FOUND_FALLBACK, unknownCommit]]),
    }
}

function untrackedFileLineAuthoring(): Exclude<LineAuthoring, "untracked"> {
    return {
        hashPerLine: [undefined, "000000"],
        originalFileLineNrPerLine: undefined,
        groupSizePerStartingLine: undefined,
        finalFileLineNrPerLine: undefined,
        commits: new Map([["000000", zeroCommit]]),
    };
}

function isDarkMode() {
    const obsidian = (<any>window)?.app;
    // Otherwise it's 'moonstone'
    return obsidian?.getTheme() === "obsidian";
}

function maxAgeInDaysFromSettings(settings: LineAuthorSettings) {
    return parseColoringMaxAgeDuration(settings.coloringMaxAge)?.asDays() ?? 356;
}
