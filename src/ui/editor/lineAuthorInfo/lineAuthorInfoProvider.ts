import { Extension, Prec } from "@codemirror/state";
import { Platform, TFile } from "obsidian";
import ObsidianGit from "src/main";
import { SimpleGit } from "src/simpleGit";
import {
    lineAuthorSettingsExtension,
    subscribeNewEditor
} from "src/ui/editor/lineAuthorInfo/control";
import { eventsPerFilePathSingleton } from "src/ui/editor/lineAuthorInfo/eventsPerFilepath";
import {
    LineAuthoring,
    lineAuthoringId,
    LineAuthoringId,
    LineAuthorSettings,
    lineAuthorState,
    settingsFrom
} from "src/ui/editor/lineAuthorInfo/model";
import { lineAuthorGutter } from "src/ui/editor/lineAuthorInfo/view";
import { previewColor as previewColor2 } from "src/ui/editor/lineAuthorInfo/view";
export const previewColor = previewColor2;

/** todo. */
export class LineAuthorInfoProvider {
    private lineAuthorings: Map<LineAuthoringId, LineAuthoring> = new Map();

    constructor(private plugin: ObsidianGit) { }

    public async trackChanged(file: TFile) {
        if (!file) return; // called in a context without a file

        if (file.path === undefined) {
            console.warn(
                "Attempted to track change of undefined filepath. Likely a bug."
            );
            // todo. this would be good for telemetry.
            return;
        }

        this.notifySettingsToSubscribers(settingsFrom(this.plugin.settings));

        this.computeLineAuthorInfo(file);
    }

    private notifySettingsToSubscribers(settings: LineAuthorSettings) {
        eventsPerFilePathSingleton.forEachSubscriber((las) =>
            las.notifySettings(settings)
        );
    }

    public destroy() {
        this.lineAuthorings.clear();
        eventsPerFilePathSingleton.clear();
    }

    /** todo. */
    private async computeLineAuthorInfo(file: TFile) {
        const gitManager = lineAuthoringAvailableOnCurrentPlatform(this.plugin).gitManager;

        const headRevision = await gitManager.headRevision();

        const fileHash = await gitManager.hashObject(file.path);

        const key = lineAuthoringId(headRevision, fileHash, file.path);

        if (key === undefined) {
            return;
        }

        if (this.lineAuthorings.has(key)) {
            // already computed. just tell the editor to update to the key's state
        } else {
            const gitAuthorResult = await gitManager.blame(file.path, this.plugin.settings.followMovementLineAuthorInfo);
            this.lineAuthorings.set(key, gitAuthorResult);
        }

        eventsPerFilePathSingleton.ifFilepathDefinedTransformSubscribers(
            file.path,
            (subs) =>
                subs.forEach((sub) =>
                    sub.notifyLineAuthoring(key, this.lineAuthorings.get(key))
                )
        );
    }
}

// =========================================================

export const enabledLineAuthorInfoExtensions: Extension = Prec.high([
    subscribeNewEditor,
    lineAuthorSettingsExtension,
    lineAuthorState,
    lineAuthorGutter,
]);

export function lineAuthoringAvailableOnCurrentPlatform(plugin: ObsidianGit): { available: boolean; gitManager: SimpleGit } {
    return {
        available: plugin.useSimpleGit && Platform.isDesktopApp,
        gitManager: plugin.gitManager instanceof SimpleGit ? plugin.gitManager : undefined,
    };
}