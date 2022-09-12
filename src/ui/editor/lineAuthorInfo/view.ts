import { gutter, GutterMarker } from "@codemirror/view";
import * as moment from "moment";
import { DATE_FORMAT, DATE_TIME_FORMAT_MINUTES } from "src/constants";
import { parseColoringMaxAgeDuration } from "src/settings";
import {
    Blame,
    BlameCommit,
    LineAuthorDateTimeFormatOptions,
    LineAuthorDisplay
} from "src/types";
import { lineAuthorSettingsExtension } from "src/ui/editor/lineAuthorInfo/control";
import {
    latestClickedLineAuthorGutter, LineAuthorGutterContextMenuMetadata,
    LineAuthoring,
    LineAuthorSettings,
    lineAuthorState, OptLineAuthoring,
    zeroCommit
} from "src/ui/editor/lineAuthorInfo/model";
import { epochSecondsNow, typeCheckedUnreachable as impossibleBranch, typeCheckedUnreachable } from "src/utils";

const RESULT_AWAITING_FALLBACK = "...";
const VALUE_NOT_FOUND_FALLBACK = "-";
const UNDISPLAYED = " ";
const NEW_COMMIT = "+++";

// todo. closing a window somehow leads to an illegal access error.

// todo. opening the same note multiple times sometimes leads to unpopulated blame

/*

Document this workflow somewhere.

tracked changes within obsidian -> initiate computation | done

computation finished -> publish new value to subscribers for the finished file | done

editors subscribe to their file at startup | done

subscribed editors update their internal state | done

state/editor update -> gutter can get new value | done.


note. line authorinfo only in surce and live preview mode.

*/

/** todo. */
export const lineAuthorGutter = gutter({
    class: "gutter-wip-class",
    // todo. use this to style entire gutter v-line. i.e. styling of alignment
    
    lineMarker(view, line, _otherMarkers) {
        const lineAuthoring = view.state.field(lineAuthorState, false);
        const settings: LineAuthorSettings = view.state.field(
            lineAuthorSettingsExtension,
            false
        );

        // We have two line numbers here, because embeds, tables and co. cause
        // multiple lines to be rendered with a single gutter. Hence, we need to
        // choose the youngest commit - of which the info will be shown.
        const startLine = view.state.doc.lineAt(line.from).number;
        const endLine = view.state.doc.lineAt(line.to).number;

        const result: LineAuthoringGutter | string = getLineAuthorInfo(
            startLine,
            endLine,
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
    initialSpacer: () => new TextGutter("---"),
    updateSpacer(spacer, update) {
        const settings = update.state.field(lineAuthorSettingsExtension, false);
        if (settings?.authorDisplay === undefined) return spacer;

        let length = 0;

        if (settings.showCommitHash) length += 6;

        switch (settings.authorDisplay) {
            case "first name":
                length += 8 + 1;
                break;
            case "last name":
            case "full":
                length += 15 + 1;
                break;
            case "initials":
                length += 2 + 1;
            case "hide":
                break;
            default:
                typeCheckedUnreachable(settings.authorDisplay);
        }

        if (settings.dateTimeFormatOptions !== "hide") length += 15 + 1;

        switch (settings.dateTimeTimezone) {
            case "local":
                break;
            case "utc":
                length += 5 + 1;
                break;
            default:
                typeCheckedUnreachable(settings.dateTimeTimezone);
        }

        return new TextGutter(Array(length).fill("-").join(""));
    },
    // // todo. use a spaced based on settings to jumps in rendering less distracting.
});

/** todo. */
function getLineAuthorInfo(
    startLine: number,
    endLine: number,
    optLineAuthoring: OptLineAuthoring,
    settings: LineAuthorSettings,
    resultAwaitingFallback: string
): LineAuthoringGutter | string {
    if (optLineAuthoring === undefined) {
        return resultAwaitingFallback;
    }

    const [key, lineAuthoring] = optLineAuthoring;

    if (lineAuthoring === "untracked") {
        return newUntrackedFileGutter(key, settings);
    }

    return endLine < lineAuthoring.hashPerLine.length
        ? new LineAuthoringGutter(lineAuthoring, startLine, endLine, key, settings)
        : UNDISPLAYED;
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
        public readonly la: Exclude<LineAuthoring, "untracked">,
        public readonly startLine: number,
        public readonly endLine: number,
        public readonly key: string,
        public readonly settings: LineAuthorSettings
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
        node.onmousedown = (event) => {
            const newMetadata: LineAuthorGutterContextMenuMetadata = {
                hash,
                commit,
                start: this.startLine,
                end: this.endLine,
                creationTime: epochSecondsNow(),
            };
            Object.assign(latestClickedLineAuthorGutter, newMetadata);
        };

        // Add basic color based on commit age
        node.style.backgroundColor = commitAuthoringAgeBasedColor(
            commit,
            this.settings
        );

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

function displayHash(hash: string, commit: BlameCommit) {
    return commit.isZeroCommit ? NEW_COMMIT : hash.substring(0, 6);
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
    lineAuthoring: Blame,
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
