import { Extension } from "@codemirror/state";
import { Editor, EventRef, MarkdownView, Menu, TAbstractFile, TFile } from "obsidian";
import ObsidianGit from "src/main";
import { enabledLineAuthorInfoExtensions, LineAuthorInfoProvider, lineAuthoringAvailableOnCurrentPlatform } from "src/ui/editor/lineAuthorInfo/lineAuthorInfoProvider";
import { latestClickedLineAuthorGutter } from "src/ui/editor/lineAuthorInfo/model";
import { epochSecondsNow } from "src/utils";

export class LineAuthoringIntegration {

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
            this.initLineAuthorFunctionality();
        }
    }

    // todo. explain these things.
    public initLineAuthorFunctionality() {
        if (!lineAuthoringAvailableOnCurrentPlatform(this.plg)) return;

        // todo. error handling everywhere where needed, so that things run robustly.

        console.log("Enabling line author info functionality.");
        this.lineAuthorInfoProvider = new LineAuthorInfoProvider(this.plg);

        this.gutterContextMenuEvent = this.createGutterContextMenuHandler();
        this.fileOpenEvent = this.createFileOpenHandler();
        this.fileModificationEvent = this.createVaultFileModificationHandler();
        this.refreshOnCssChangeEvent = this.createCssRefreshHandler();

        this.plg.registerEvent(this.refreshOnCssChangeEvent);
        this.plg.registerEvent(this.fileOpenEvent);
        this.plg.registerEvent(this.fileModificationEvent);

        this.activateCodeMirrorLineAuthoringExtensions();

        // Handle all initially opened files
        this.plg.app.workspace.iterateAllLeaves(leaf => {
            const obsView = (<any>leaf?.view);
            const file = obsView?.file;
            if (!file || obsView?.allowNoFile || !this?.lineAuthorInfoProvider) return;

            console.log("Initially registering: ", file?.path);
            this.lineAuthorInfoProvider.trackChanged(file);
        });
    }

    public deinitLineAuthorFunctionality() {
        console.log("Disabling line author info functionality.");
        this.plg.app.workspace.offref(this.refreshOnCssChangeEvent);
        this.plg.app.workspace.offref(this.fileOpenEvent);
        this.plg.app.vault.offref(this.fileModificationEvent);
        this.plg.app.workspace.offref(this.gutterContextMenuEvent);

        this.deactivateCodeMirrorLineAuthoringExtensions();

        this.lineAuthorInfoProvider?.destroy();
        this.lineAuthorInfoProvider = undefined;
    }

    // ========================= REFRESH ==========================

    public refreshLineAuthorViews() {
        if (this.plg.settings.showLineAuthorInfo) {
            this.deinitLineAuthorFunctionality();
            this.initLineAuthorFunctionality();
        }
    }

    // ========================= CODEMIRROR EXTENSIONS ==========================

    private activateCodeMirrorLineAuthoringExtensions() {
        // Yes, we need to directly modify the array and notify the change to have
        // toggleable Codemirror extensions.
        this.codeMirrorExtensions.push(enabledLineAuthorInfoExtensions);
        this.plg.app.workspace.updateOptions();
    }

    private deactivateCodeMirrorLineAuthoringExtensions() {
        // Yes, we need to directly modify the array and notify the change to have
        // toggleable Codemirror extensions.
        for (const ext of this.codeMirrorExtensions) {
            this.codeMirrorExtensions.remove(ext);
        }
        this.plg.app.workspace.updateOptions();
    }

    // ========================= HANDLERS ==========================

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
        return this.plg.app.workspace.on("editor-menu",
            (menu: Menu, editor: Editor, _mdv: MarkdownView) => {
                // Click was inside text-editor with active curson. Don't trigger there.
                if (editor.hasFocus())
                    return;

                const lineAuthorGutterWasRecentlyClicked = epochSecondsNow()
                    .diff(latestClickedLineAuthorGutter.creationTime, "milliseconds") <= 300;

                if (!lineAuthorGutterWasRecentlyClicked)
                    return;

                // Deactivate context-menu item for the zero commit
                if (latestClickedLineAuthorGutter.commit.isZeroCommit)
                    return;

                this.addCopyHashMenuItem(menu);
            }
        );
    }

    private addCopyHashMenuItem(menu: Menu) {
        menu.addItem((item) =>
            item
                .setTitle("Copy commit hash")
                .setIcon("copy")
                .onClick((_e) => navigator.clipboard.writeText(latestClickedLineAuthorGutter.hash))
        );
    }
}
