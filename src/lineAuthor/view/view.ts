import { Extension, Range, RangeSet } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import { start } from "repl";
import {
    latestSettings, LineAuthoringWithId, lineAuthorState
} from "src/lineAuthor/model";
import { getLongestRenderedGutter } from "src/lineAuthor/view/cache";
import { LineAuthoringGutter, lineAuthoringGutterMarker, TextGutter } from "src/lineAuthor/view/gutter/gutter";
import { initialLineAuthoringGutter, initialSpacingGutter } from "src/lineAuthor/view/gutter/initial";
import { newUntrackedFileGutter } from "src/lineAuthor/view/gutter/untrackedFile";

/*
================== VIEW ======================
Contains classes, variables and functions describing
how the MODEL is rendered to a view.
*/

const UNDISPLAYED = new TextGutter("");

/**
 * The line author gutter as a Codemirror {@link Extension}.
 * 
 * It simply renderes the line authoring state from the {@link lineAuthorState} state-field.
*/
export const lineAuthorGutter: Extension = gutter({
    class: "line-author-gutter-container",
    markers(view) {
        const lineAuthoring = view.state.field(lineAuthorState, false);
        console.log("markers");
        const result = lineAuthoringGuttersRangeSet(view, lineAuthoring);
        const cursor = result.iter();
        for (; cursor.value !== null; cursor.next()) {
            const v = cursor.value;
            // console.log("range:", v instanceof LineAuthoringGutter ? `${v.startLine},${v.endLine}` : `text: ${(v as TextGutter).text}`);
        }
        return result;
    },
    lineMarker(view, line, markers) {
        // console.log("lineMarker", markers);
        const startLine = view.state.doc.lineAt(line.from).number;
        const endLine = view.state.doc.lineAt(line.to).number;
        if (startLine !== endLine) console.log("block lines:", startLine, endLine);
        return null;

        // const lineAuthoring = view.state.field(lineAuthorState, false);

        // // We have two line numbers here, because embeds, tables and co. cause
        // // multiple lines to be rendered with a single gutter. Hence, we need to
        // // choose the youngest commit - of which the info will be shown.
        // const startLine = view.state.doc.lineAt(line.from).number;
        // const endLine = view.state.doc.lineAt(line.to).number;
        // const docLastLine = view.state.doc.lines;
        // const isEmptyLine = view.state.doc.iterLines(startLine, endLine + 1).next().value === "";

        // return createLineAuthorGutter(
        //     startLine,
        //     endLine,
        //     docLastLine,
        //     isEmptyLine,
        //     lineAuthoring,
        // );
    },
    // // Rerender, when we have any state change.
    // // Unfortunately, when the cursor moves, the re-render will happen anyways :/
    // lineMarkerChange(update) {
    //     const newLineAuthoringId = update.state.field(lineAuthorState)?.key;
    //     const oldLineAuthoringId = update.startState.field(lineAuthorState)?.key;
    //     return oldLineAuthoringId !== newLineAuthoringId;
    // },
    renderEmptyElements: true,
    // initialSpacer: (_v) => initialSpacingGutter(),
    // updateSpacer: (_sp, _u) => getLongestRenderedGutter()?.gutter ?? initialSpacingGutter()
});

function lineAuthoringGuttersRangeSet(
    view: EditorView, optLA?: LineAuthoringWithId
): RangeSet<GutterMarker> {
    const doc = view.state.doc;
    const docLastLine = doc.lines;
    const settings = latestSettings.get();

    const ranges: Range<GutterMarker>[] = [];

    if (doc.length === 0) {
        ranges.push(UNDISPLAYED.range(0));
        return RangeSet.of(ranges);
    }

    // todo. explain
    const lastLineIsEmpty = doc.iterLines(docLastLine, docLastLine + 1).next().value === "";
    const lastLineWithDisplayedLA = docLastLine - (lastLineIsEmpty ? 1 : 0);
    const lastPosWithDisplayedLA = doc.line(lastLineWithDisplayedLA).to;

    if (lastLineIsEmpty) {
        const { from, to } = doc.line(docLastLine);
        ranges.push(UNDISPLAYED.range(from, to));
    }

    if (!optLA) {
        // todo. need to define range for each line
        ranges.push(initialLineAuthoringGutter(settings).range(0, lastPosWithDisplayedLA));
        return RangeSet.of(ranges, true /* sort */);
    }

    const { key, la } = optLA;
    if (la === "untracked") {
        // todo. need to define range for each line
        ranges.push(newUntrackedFileGutter(la, settings).range(0, lastPosWithDisplayedLA));
        return RangeSet.of(ranges, true /* sort */);
    }

    // find out groups of consecutively equal line authoring
    const groups = la.groupSizePerStartingLine;
    for (let li = 1; li <= lastLineWithDisplayedLA;) {
        // todo.
        const groupSize = groups.get(li);
        if (groupSize === undefined) {
            console.warn("shouldnt happen", li, groups);
            break;
        }
        const lend = li + groupSize - 1;

        // how can we assign a range for a set of lines and not just one line?
        for (let l = li; l <= lend; l++) {
            const { from, to } = doc.line(l);
            if (lend < la.hashPerLine.length) {
                // todo. block render are not taken care of yet.
                const gutter = lineAuthoringGutterMarker([la, l, l, key, settings]);
                ranges.push(gutter.range(from, to));
            }
            else {
                ranges.push(UNDISPLAYED.range(from, to));
            }
        }
        li = lend + 1;
    }

    // a facet doesn't make sense here, as it would need to be re-configured as an extension
    // every time the line authoring changes.
    // return view.state.facet(guttersRangeSet);
    return RangeSet.of(ranges, true /* sort */);
}

function createLineAuthorGutter(
    startLine: number,
    endLine: number,
    docLastLine: number,
    isEmptyLine: boolean,
    optLineAuthoring: LineAuthoringWithId | undefined,
): LineAuthoringGutter | TextGutter {
    if (startLine === docLastLine && isEmptyLine) {
        // last empty line has no git-blame defined.
        return UNDISPLAYED;
    }

    const settings = latestSettings.get();

    if (optLineAuthoring === undefined) {
        return initialLineAuthoringGutter(settings);
    }

    const { key, la } = optLineAuthoring;

    if (la === "untracked") {
        return newUntrackedFileGutter(key, settings);
    }

    if (endLine >= la.hashPerLine.length) return UNDISPLAYED;

    return lineAuthoringGutterMarker([la, startLine, endLine, key, settings])
}
