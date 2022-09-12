import { EditorState, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorEditorField, editorViewField } from "obsidian";
import { eventsPerFilePathSingleton } from "src/ui/editor/lineAuthorInfo/eventsPerFilepath";
import {
    LineAuthoring,
    LineAuthoringId,
    LineAuthorSettings,
    LineAuthorSettingsAvailableType,
    newComputationResultAsTransaction,
    newSettingsAsTransaction
} from "src/ui/editor/lineAuthorInfo/model";

/** todo. */
export class LineAuthoringSubscriber {
    constructor(private state: EditorState) {
        this.subscribeMe();
    }

    public get filepath(): string {
        return this.state.field(editorViewField)?.file?.path;
    }

    // todo. handle rename event and refresh views. it should work reliably
    // perhaps use the -M and -C options of git blame as well?

    public newState(state: EditorState) {
        // if filepath has changed, then re-subcribe.
        const oldpath = this.filepath;
        this.state = state;
        if (this.filepath !== oldpath) {
            console.log("E. Resubscribed due to file path change."); // todo. can this scenario even happen?
            this.unsubscribeMe(oldpath);
            this.subscribeMe();
        }
        return this;
    }

    public notifySettings(settings: LineAuthorSettings): void {
        if (this.view === undefined) {
            console.warn("View is not defined for editor cache key. Likely a bug.");
            // todo. telemetry? alternatively beta-testers via BRAT plugin
            return;
        }

        const transaction = newSettingsAsTransaction(settings, this.view.state);
        this.view.dispatch(transaction);
    }

    public notifyLineAuthoring(id: LineAuthoringId, la: LineAuthoring): void {
        if (this.view === undefined) {
            console.warn(
                "View is not defined for editor cache key. Likely a bug. id: " + id
            );
            // todo. telemetry?
            return;
        }

        // using "this.state" directly here leads to some problems when closing panes. Hence, "this.view.state"
        const state = this.view.state;
        const transaction = newComputationResultAsTransaction(id, la, state);
        this.view.dispatch(transaction);
    }

    private get view(): EditorView | undefined {
        return this.state.field(editorEditorField);
    }

    private subscribeMe() {
        eventsPerFilePathSingleton.ifFilepathDefinedTransformSubscribers(
            this.filepath,
            (subs) => {
                subs.add(this);
            }
        );
    }

    private unsubscribeMe(oldFilepath: string) {
        eventsPerFilePathSingleton.ifFilepathDefinedTransformSubscribers(
            oldFilepath,
            (subs) => subs.delete(this)
        );
    }
}

/** todo. */
export type LineAuthoringSubscribers = Set<LineAuthoringSubscriber>;

/** todo. */
export const subscribeNewEditor: StateField<LineAuthoringSubscriber> =
    StateField.define<LineAuthoringSubscriber>({
        create: (state) => {
            return new LineAuthoringSubscriber(state);
        },
        update: (v, transaction) => {
            return v.newState(transaction.state);
        },
        compare: (a, b) => a === b,
    });

// ======================================================================

export const lineAuthorSettingsExtension: StateField<LineAuthorSettings> =
    StateField.define<LineAuthorSettings>({
        create: (_state) => <LineAuthorSettings>{}, // todo. could this cause problems here?
        update: (v, t) => {
            return t.annotation(LineAuthorSettingsAvailableType) ?? v;
        },
    });
