import { EditorState, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as deepEqual from "deep-equal";
import { editorEditorField, editorViewField } from "obsidian";
import { eventsPerFilePathSingleton } from "src/ui/editor/lineAuthorInfo/eventsPerFilepath";
import {
    latestSettings,
    LineAuthoring,
    LineAuthoringId,
    LineAuthorSettings,
    LineAuthorSettingsAvailableType,
    newComputationResultAsTransaction,
    newSettingsAsTransaction
} from "src/ui/editor/lineAuthorInfo/model";

// todo. handle rename event and refresh views. it should work reliably

/** 
 * Subscribes to changes in the files on a specific filepath.
 * It knows its corresponding editor and initiates editor view changes.
*/
export class LineAuthoringSubscriber {
    constructor(private state: EditorState) {
        this.subscribeMe();
    }

    public async notifyLineAuthoring(id: LineAuthoringId, la: LineAuthoring) {
        if (this.view === undefined) {
            console.warn(`View is not defined for editor cache key. Unforeseen situation. id: ${id}`);
            return;
        }

        // using "this.state" directly here leads to some problems when closing panes. Hence, "this.view.state"
        const state = this.view.state;
        const transaction = newComputationResultAsTransaction(id, la, state);
        this.view.dispatch(transaction);
    }

    public async notifySettings(settings: LineAuthorSettings) {
        if (this.view === undefined) {
            console.warn("View is not defined for editor cache key. Unforeseen situation.");
            return;
        }

        const transaction = newSettingsAsTransaction(settings, this.view.state);
        this.view.dispatch(transaction);
    }

    public updateToNewState(state: EditorState) {
        // if filepath has changed, then re-subcribe.
        const oldpath = this.filepath;
        this.state = state;
        if (this.filepath !== oldpath) {
            // todo. can this scenario even happen?
            console.warn("Resubscribed due to file path change.");
            this.unsubscribeMe(oldpath);
            this.subscribeMe();
        }
        return this;
    }

    private subscribeMe() {
        eventsPerFilePathSingleton
            .ifFilepathDefinedTransformSubscribers(this.filepath, (subs) => subs.add(this));
    }

    private unsubscribeMe(oldFilepath: string) {
        eventsPerFilePathSingleton
            .ifFilepathDefinedTransformSubscribers(oldFilepath, (subs) => subs.delete(this));
    }

    private get filepath(): string | undefined {
        return this.state.field(editorViewField)?.file?.path;
    }

    private get view(): EditorView | undefined {
        return this.state.field(editorEditorField);
    }
}

export type LineAuthoringSubscribers = Set<LineAuthoringSubscriber>;

/**
 * The Codemirror {@link Extension} used to make each editor subscribe itself to this pub-sub.
*/
export const subscribeNewEditor: StateField<LineAuthoringSubscriber> =
    StateField.define<LineAuthoringSubscriber>({
        create: (state) => new LineAuthoringSubscriber(state),
        update: (v, transaction) => v.updateToNewState(transaction.state),
        compare: (a, b) => a === b,
    });

// ======================================================================

export const settingsStateField: StateField<LineAuthorSettings> =
    StateField.define<LineAuthorSettings>({
        // use the most recent encountered settings
        create: (_state) => latestSettings,
        update: (v, t) => {
            const providedSettings = t.annotation(LineAuthorSettingsAvailableType);
            providedSettings && Object.assign(latestSettings, providedSettings);
            return providedSettings ?? v;
        },
        compare: (a, b) => deepEqual.default(a, b, { strict: true }),
    });
