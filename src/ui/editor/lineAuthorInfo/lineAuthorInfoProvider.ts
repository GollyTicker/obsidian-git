import { Extension } from "@codemirror/state";
import { TFile } from "obsidian";
import ObsidianGit from "src/main";
import { subscribeNewEditor } from "src/ui/editor/lineAuthorInfo/control";
import { eventsPerFilePathSingleton } from "src/ui/editor/lineAuthorInfo/eventsPerFilepath";
import {
  LineAuthoring,
  lineAuthoringId,
  LineAuthoringId,
  lineAuthorState,
} from "src/ui/editor/lineAuthorInfo/model";
import { lineAuthorGutter } from "src/ui/editor/lineAuthorInfo/view";

/** todo. */
export class LineAuthorInfoProvider {
  private lineAuthorings: Map<LineAuthoringId, LineAuthoring> = new Map();

  constructor(private plugin: ObsidianGit) {}

  public async trackChanged(file: TFile) {
    if (!file) return; // called in a context without a file

    if (file.path === undefined) {
      console.warn(
        "Attempted to track change of undefined filepath. Likely a bug."
      );
      // todo. this would be good for telemetry.
      return;
    }

    this.computeLineAuthorInfo(file);
  }

  public destroy() {
    this.lineAuthorings.clear();
    eventsPerFilePathSingleton.clear();
  }

  /** todo. */
  private async computeLineAuthorInfo(file: TFile) {
    const headRevision = await this.plugin.gitManager.headRevision();

    const fileHash = await this.plugin.gitManager.hashObject(file.path);

    const key = lineAuthoringId(headRevision, fileHash, file.path);

    if (key === undefined) {
      return;
    }

    if (this.lineAuthorings.has(key)) {
      // already computed. just tell the editor to update to the key's state
      console.log(`Already have ${key} so nothing to compute.`);
    } else {
      const gitAuthorResult = await this.plugin.gitManager.blame(file.path);
      this.lineAuthorings.set(key, gitAuthorResult);
      console.log("timed: 1 Computed git blame for recent", file.path);
    }

    console.log("timed: 2. Notifying new state.");

    eventsPerFilePathSingleton.ifFilepathDefinedTransformSubscribers(
      file.path,
      (subs) =>
        subs.forEach((sub) => sub.run(key, this.lineAuthorings.get(key)))
    );
  }
}

// =========================================================

export function enabledLineAuthorInfoExtensions(): Extension {
  return [subscribeNewEditor, lineAuthorState, lineAuthorGutter()];
}
