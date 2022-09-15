import { Extension } from "@codemirror/state";
import { EventRef, Platform, TAbstractFile, TFile } from "obsidian";
import ObsidianGit from "src/main";
import { SimpleGit } from "src/simpleGit";
import { handleContextMenu } from "src/ui/editor/lineAuthorInfo/contextMenu";
import { enabledLineAuthorInfoExtensions, LineAuthorInfoProvider } from "src/ui/editor/lineAuthorInfo/lineAuthorInfoProvider";

// todo. error handling everywhere where needed, so that things run robustly

/**
 * Manages the interaction between Obsidian (file-open event, modification event, etc.)
 * and the line authoring feature. It also manages the (de-) activation of the
 * line authoring functionality.
 */
export class LineAuthoringFeature {

    private lineAuthorInfoProvider: LineAuthorInfoProvider;
    private fileOpenEvent: EventRef;
    private fileModificationEvent: EventRef;
    private refreshOnCssChangeEvent: EventRef;
    private gutterContextMenuEvent: EventRef;
    private codeMirrorExtensions: Extension[] = [];

    constructor(private plg: ObsidianGit) {
    }

    // ========================= INIT and DE-INIT ==========================

    public onLoadPlugin() {
        this.plg.registerEditorExtension(this.codeMirrorExtensions);
    }

    public conditionallyActivateBySettings() {
        if (this.plg.settings.showLineAuthorInfo) {
            this.activateFeature();
        }
    }

    public activateFeature() {
        if (!this.isAvailableOnCurrentPlatform()) return;

        console.log("Enabling line author info functionality.");

        this.lineAuthorInfoProvider = new LineAuthorInfoProvider(this.plg);

        this.createEventHandlers();

        this.activateCodeMirrorExtensions();
    }

    public deactivateFeature() {
        console.log("Disabling line author info functionality.");

        this.destroyEventHandlers();

        this.deactivateCodeMirrorExtensions();

        this.lineAuthorInfoProvider?.destroy();
        this.lineAuthorInfoProvider = undefined;
    }

    public isAvailableOnCurrentPlatform(): { available: boolean; gitManager: SimpleGit } {
        return {
            available: this.plg.useSimpleGit && Platform.isDesktopApp,
            gitManager: this.plg.gitManager instanceof SimpleGit ? this.plg.gitManager : undefined,
        };
    }

    // ========================= REFRESH ==========================

    public refreshLineAuthorViews() {
        if (this.plg.settings.showLineAuthorInfo) {
            this.deactivateFeature();
            this.activateFeature();
        }
    }

    // ========================= CODEMIRROR EXTENSIONS ==========================

    private activateCodeMirrorExtensions() {
        // Yes, we need to directly modify the array and notify the change to have
        // toggleable Codemirror extensions.
        this.codeMirrorExtensions.push(enabledLineAuthorInfoExtensions);
        this.plg.app.workspace.updateOptions();

        // Handle all already opened files
        this.plg.app.workspace.iterateAllLeaves(leaf => {
            // todo. is this the best way to access this?
            const obsView = (<any>leaf?.view);
            const file = obsView?.file;
            if (!file || obsView?.allowNoFile || !this?.lineAuthorInfoProvider) return;

            console.log("Initially registering: ", file?.path);
            this.lineAuthorInfoProvider.trackChanged(file);
        });
    }

    private deactivateCodeMirrorExtensions() {
        // Yes, we need to directly modify the array and notify the change to have
        // toggleable Codemirror extensions.
        for (const ext of this.codeMirrorExtensions) {
            this.codeMirrorExtensions.remove(ext);
        }
        this.plg.app.workspace.updateOptions();
    }

    // ========================= HANDLERS ==========================

    private createEventHandlers() {
        this.gutterContextMenuEvent = this.createGutterContextMenuHandler();
        this.fileOpenEvent = this.createFileOpenHandler();
        this.fileModificationEvent = this.createVaultFileModificationHandler();
        this.refreshOnCssChangeEvent = this.createCssRefreshHandler();

        this.plg.registerEvent(this.refreshOnCssChangeEvent);
        this.plg.registerEvent(this.fileOpenEvent);
        this.plg.registerEvent(this.fileModificationEvent);
    }

    private destroyEventHandlers() {
        this.plg.app.workspace.offref(this.refreshOnCssChangeEvent);
        this.plg.app.workspace.offref(this.fileOpenEvent);
        this.plg.app.vault.offref(this.fileModificationEvent);
        this.plg.app.workspace.offref(this.gutterContextMenuEvent);
    }

    private createFileOpenHandler(): EventRef {
        return this.plg.app.workspace.on("file-open", (file: TFile) => {
            this.lineAuthorInfoProvider?.trackChanged(file);
        });
    }

    private createVaultFileModificationHandler() {
        return this.plg.app.vault.on("modify", (anyPath: TAbstractFile) => {
            if (anyPath instanceof TFile) {
                this.lineAuthorInfoProvider?.trackChanged(anyPath);
            }
        });
    }

    private createCssRefreshHandler(): EventRef {
        return this.plg.app.workspace.on("css-change", () => this.refreshLineAuthorViews());
    }

    private createGutterContextMenuHandler() {
        return this.plg.app.workspace.on("editor-menu", handleContextMenu);
    }
}