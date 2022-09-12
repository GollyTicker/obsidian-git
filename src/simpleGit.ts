import { spawnSync } from "child_process";
import { FileSystemAdapter, normalizePath, Notice } from "obsidian";
import * as path from "path";
import { sep } from "path";
import * as simple from "simple-git";
import simpleGit, { DefaultLogFields } from "simple-git";
import { GitManager } from "./gitManager";
import ObsidianGit from "./main";
import { Blame, BlameCommit, BranchInfo, FileStatusResult, PluginState, Status } from "./types";

export class SimpleGit extends GitManager {
    git: simple.SimpleGit;
    constructor(plugin: ObsidianGit) {
        super(plugin);
    }

    async setGitInstance(ignoreError: boolean = false): Promise<void> {
        if (this.isGitInstalled()) {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            const path = adapter.getBasePath();
            let basePath = path;
            // Because the basePath setting is a relative path, a leading `/` must
            // be appended before concatenating with the path.
            if (this.plugin.settings.basePath) {
                const exists = await adapter.exists(normalizePath(this.plugin.settings.basePath));
                if (exists) {
                    basePath = path + sep + this.plugin.settings.basePath;
                } else if (!ignoreError) {
                    new Notice("ObsidianGit: Base path does not exist");
                }
            }

            this.git = simpleGit({
                baseDir: basePath,
                binary: this.plugin.localStorage.getGitPath() || undefined,
                config: ["core.quotepath=off"]
            });
            this.git.cwd(await this.git.revparse("--show-toplevel"));
        }
    }

    async status(): Promise<Status> {
        this.plugin.setState(PluginState.status);
        const status = await this.git.status((err) => this.onError(err));
        this.plugin.setState(PluginState.idle);
        return {
            changed: status.files.filter((e) => e.working_dir !== " ").map((e) => {
                const res = this.formatPath(e);

                return <FileStatusResult>{
                    path: res.path,
                    from: res.from,
                    working_dir: e.working_dir === "?" ? "U" : e.working_dir,
                    vault_path: this.getVaultPath(res.path),
                };
            }),
            staged: status.files.filter((e) => e.index !== " " && e.index != "?").map((e) => {
                const res = this.formatPath(e, e.index === "R");
                return <FileStatusResult>{
                    path: res.path,
                    from: res.from,
                    index: e.index,
                    vault_path: this.getVaultPath(res.path),
                };
            }),
            conflicted: status.conflicted.map((e) => this.formatPath({
                path: e,
                from: undefined,
                index: undefined,
                working_dir: undefined
            }).path),
        };
    }

    async headRevision(): Promise<string> {
        return this.git.revparse("HEAD");
    }

    //Remove wrong `"` like "My file.md"
    formatPath(path: simple.FileStatusResult, renamed: boolean = false): { path: string, from?: string; } {
        function format(path?: string): string {
            if (path == undefined) return undefined;

            if (path.startsWith('"') && path.endsWith('"')) {
                return path.substring(1, path.length - 1);
            } else {
                return path;
            }
        }
        if (renamed) {
            return {
                from: format(path.from),
                path: format(path.path),
            };
        } else {
            return {
                path: format(path.path)
            };
        }
    }

    // todo. submodules are not supported! do in a future release?
    async blame(path: string): Promise<Blame | "untracked"> {
        path = this.getPath(path, true);

        if (!await this.isTracked(path)) return "untracked";

        const inSubmodule = await this.getSubmoduleOfFile(path);
        const args = inSubmodule ? ["-C",inSubmodule.submodule] : [];
        const relativePath = inSubmodule ? inSubmodule.relativeFilepath : path;

        args.push("blame","--porcelain","--",relativePath);
        return this.git.raw(args, err => err && console.warn("git-blame", err))
            .then(parseBlame);
    }

    async isTracked(path: string): Promise<boolean> {
        const inSubmodule = await this.getSubmoduleOfFile(path);
        const args = inSubmodule ? ["-C",inSubmodule.submodule] : [];
        const relativePath = inSubmodule ? inSubmodule.relativeFilepath : path;

        args.push("ls-files","--",relativePath);
        return this.git.raw(args, err => err && console.warn("ls-files", err))
            .then(x => x.trim() !== "");
    }

    async commitAll({ message }: { message: string; }): Promise<number> {
        if (this.plugin.settings.updateSubmodules) {
            this.plugin.setState(PluginState.commit);

            await new Promise<void>(async (resolve, reject) => {

                this.git.outputHandler(async (cmd, stdout, stderr, args) => {

                    // Do not run this handler on other commands
                    if (!(args.contains("submodule") && args.contains("foreach"))) return;

                    let body = "";
                    let root = (this.app.vault.adapter as FileSystemAdapter).getBasePath() + (this.plugin.settings.basePath ? "/" + this.plugin.settings.basePath : "");
                    stdout.on('data', (chunk) => {
                        body += chunk.toString('utf8');
                    });
                    stdout.on('end', async () => {
                        let submods = body.split('\n');

                        // Remove words like `Entering` in front of each line and filter empty lines
                        submods = submods.map(i => {
                            let submod = i.match(/'([^']*)'/);
                            if (submod != undefined) {
                                return root + "/" + submod[1] + sep;
                            }
                        });

                        submods.reverse();
                        for (const item of submods) {
                            // Catch empty lines
                            if (item != undefined) {
                                await this.git.cwd({ path: item, root: false }).add("-A", (err) => this.onError(err));
                                await this.git.cwd({ path: item, root: false }).commit(await this.formatCommitMessage(message), (err) => this.onError(err));
                            }
                        }
                        resolve();
                    });
                });


                await this.git.subModule(["foreach", "--recursive", '']);
                this.git.outputHandler(() => { });
            });

        }
        this.plugin.setState(PluginState.add);

        await this.git.add("-A", (err) => this.onError(err));

        this.plugin.setState(PluginState.commit);

        return (await this.git.commit(await this.formatCommitMessage(message), (err) => this.onError(err))).summary.changes;
    }

    async commit(message: string): Promise<number> {
        this.plugin.setState(PluginState.commit);

        const res = (await this.git.commit(await this.formatCommitMessage(message), (err) => this.onError(err))).summary.changes;
        this.plugin.setState(PluginState.idle);
        return res;

    }

    async stage(path: string, relativeToVault: boolean): Promise<void> {
        this.plugin.setState(PluginState.add);

        path = this.getPath(path, relativeToVault);
        await this.git.add(["--", path], (err) => this.onError(err));

        this.plugin.setState(PluginState.idle);
    }

    async stageAll({ dir }: { dir?: string; }): Promise<void> {
        this.plugin.setState(PluginState.add);
        await this.git.add(
            dir ?? "-A", (err) => this.onError(err)
        );
        this.plugin.setState(PluginState.idle);
    }

    async unstageAll(): Promise<void> {
        this.plugin.setState(PluginState.add);
        await this.git.reset([], (err) => this.onError(err));
        this.plugin.setState(PluginState.idle);
    }

    async unstage(path: string, relativeToVault: boolean): Promise<void> {
        this.plugin.setState(PluginState.add);

        path = this.getPath(path, relativeToVault);
        await this.git.reset(["--", path], (err) => this.onError(err));

        this.plugin.setState(PluginState.idle);
    }

    async discard(filepath: string): Promise<void> {
        this.plugin.setState(PluginState.add);
        await this.git.checkout(
            ["--", filepath], (err) => this.onError(err)
        );
        this.plugin.setState(PluginState.idle);
    }

    async hashObject(filepath: string): Promise<string> {
        // Need to use raw command here to ensure filenames are literally used.
        // Perhaps we could file a PR? https://github.com/steveukx/git-js/blob/main/simple-git/src/lib/tasks/hash-object.ts
        filepath = this.getPath(filepath, true);
        const inSubmodule = await this.getSubmoduleOfFile(filepath);
        const args = inSubmodule ? ["-C", inSubmodule.submodule] : [];
        const relativeFilepath = inSubmodule ? inSubmodule.relativeFilepath : filepath;

        args.push("hash-object", "--", relativeFilepath);

        const revision = this.git.raw(args);
        revision.catch(err =>
            err && console.warn("obsidian-git. hash-object failed:", err?.message)
        );
        return revision;
    }

    async pull(): Promise<FileStatusResult[]> {
        this.plugin.setState(PluginState.pull);
        if (this.plugin.settings.updateSubmodules)
            await this.git.subModule(["update", "--remote", "--merge", "--recursive"], (err) => this.onError(err));

        const branchInfo = await this.branchInfo();
        const localCommit = await this.git.revparse([branchInfo.current], (err) => this.onError(err));

        await this.git.fetch((err) => this.onError(err));
        const upstreamCommit = await this.git.revparse([branchInfo.tracking], (err) => this.onError(err));

        if (localCommit !== upstreamCommit) {
            if (this.plugin.settings.syncMethod === 'merge' || this.plugin.settings.syncMethod === 'rebase') {
                try {
                    switch (this.plugin.settings.syncMethod) {
                        case 'merge':
                            await this.git.merge([branchInfo.tracking]);
                            break;
                        case 'rebase':
                            await this.git.rebase([branchInfo.tracking]);

                    }
                } catch (err) {
                    this.plugin.displayError(`Pull failed (${this.plugin.settings.syncMethod}): ${err.message}`);
                    return;
                }

            } else if (this.plugin.settings.syncMethod === 'reset') {
                try {
                    await this.git.raw(['update-ref', `refs/heads/${branchInfo.current}`, upstreamCommit], (err) => this.onError(err));
                    await this.unstageAll();
                } catch (err) {
                    this.plugin.displayError(`Sync failed (${this.plugin.settings.syncMethod}): ${err.message}`);
                }
            }
            const afterMergeCommit = await this.git.revparse([branchInfo.current], (err) => this.onError(err));

            const filesChanged = await this.git.diff([`${localCommit}..${afterMergeCommit}`, '--name-only']);

            return filesChanged.split(/\r\n|\r|\n/).filter((value) => value.length > 0).map((e) => {
                return <FileStatusResult>{
                    path: e,
                    working_dir: 'P',
                    vault_path: this.getVaultPath(e),
                };
            });
        } else {
            return [];
        }
    }

    async push(): Promise<number> {
        this.plugin.setState(PluginState.status);
        const status = await this.git.status();
        const trackingBranch = status.tracking;
        const currentBranch = status.current;
        const remoteChangedFiles = (await this.git.diffSummary([currentBranch, trackingBranch], (err) => this.onError(err))).changed;

        this.plugin.setState(PluginState.push);
        if (this.plugin.settings.updateSubmodules) {
            await this.git.env({ ...process.env, "OBSIDIAN_GIT": 1 }).subModule(["foreach", "--recursive", `tracking=$(git for-each-ref --format='%(upstream:short)' "$(git symbolic-ref -q HEAD)"); echo $tracking; if [ ! -z "$(git diff --shortstat $tracking)" ]; then git push; fi`], (err) => this.onError(err));

        }
        await this.git.env({ ...process.env, "OBSIDIAN_GIT": 1 }).push((err) => this.onError(err));

        return remoteChangedFiles;
    }


    async canPush(): Promise<boolean> {
        // allow pushing in submodules even if the root has no changes.
        if (this.plugin.settings.updateSubmodules === true) {
            return true;
        }
        const status = await this.git.status((err) => this.onError(err));
        const trackingBranch = status.tracking;
        const currentBranch = status.current;
        const remoteChangedFiles = (await this.git.diffSummary([currentBranch, trackingBranch])).changed;

        return remoteChangedFiles !== 0;
    }

    async checkRequirements(): Promise<"valid" | "missing-repo" | "missing-git"> {
        if (!this.isGitInstalled()) {
            return "missing-git";
        }
        if (!(await this.git.checkIsRepo())) {
            return "missing-repo";
        }
        return "valid";
    }

    async branchInfo(): Promise<BranchInfo> {
        const status = await this.git.status((err) => this.onError(err));
        const branches = await this.git.branch(["--no-color"], (err) => this.onError(err));

        return {
            current: status.current,
            tracking: status.tracking,
            branches: branches.all,
        };
    }

    async getRemoteUrl(remote: string): Promise<string> {
        return await this.git.remote(["get-url", remote], (err, url) => this.onError(err)) || undefined;
    }


    // https://github.com/kometenstaub/obsidian-version-history-diff/issues/3
    async log(file?: string, relativeToVault: boolean = true): Promise<ReadonlyArray<DefaultLogFields>> {
        const path = this.getPath(file, relativeToVault);

        const res = await this.git.log({ file: path, }, (err) => this.onError(err));
        return res.all;
    }

    async show(commitHash: string, file: string, relativeToVault: boolean = true): Promise<string> {
        const path = this.getPath(file, relativeToVault);

        return this.git.show([commitHash + ":" + path], (err) => this.onError(err));
    }

    async checkout(branch: string): Promise<void> {
        await this.git.checkout(branch, (err) => this.onError(err));
    }

    async init(): Promise<void> {
        await this.git.init(false, (err) => this.onError(err));
    }

    async clone(url: string, dir: string): Promise<void> {
        await this.git.clone(url, path.join((this.app.vault.adapter as FileSystemAdapter).getBasePath(), dir), [], (err) => this.onError(err));
    }

    async setConfig(path: string, value: any): Promise<void> {
        await this.git.addConfig(path, value, (err) => this.onError(err));
    }

    async getConfig(path: string): Promise<any> {
        const config = await this.git.listConfig((err) => this.onError(err));
        return config.all[path];
    }

    async fetch(remote?: string): Promise<void> {
        await this.git.fetch(remote != undefined ? [remote] : [], (err) => this.onError(err));
    }

    async setRemote(name: string, url: string): Promise<void> {
        if ((await this.getRemotes()).includes(name))
            await this.git.remote(["set-url", name, url], (err) => this.onError(err));

        else {
            await this.git.remote(["add", name, url], (err) => this.onError(err));
        }
    }

    async getRemoteBranches(remote: string): Promise<string[]> {
        const res = await this.git.branch(["-r", "--list", `${remote}*`], (err) => this.onError(err));
        console.log(remote);
        console.log(res);

        const list = [];
        for (var item in res.branches) {
            list.push(res.branches[item].name);
        }
        return list;
    }

    async getRemotes() {
        const res = await this.git.remote([], (err) => this.onError(err));
        if (res) {
            return res.trim().split("\n");
        } else {
            return [];
        }
    }

    async removeRemote(remoteName: string) {
        await this.git.removeRemote(remoteName);
    }

    async updateUpstreamBranch(remoteBranch: string) {
        try {
            // git 1.8+
            await this.git.branch(['--set-upstream-to', remoteBranch]);
        } catch (e) {
            console.error(e);
            try {
                // git 1.7 - 1.8
                await this.git.branch(['--set-upstream', remoteBranch]);
            } catch (e) {
                console.error(e);
                // fallback
                await this.git.push(["--set-upstream", ...remoteBranch.split("/")], (err) => this.onError(err));
            }
        }

    }

    updateGitPath(gitPath: string) {
        this.setGitInstance();
    }

    updateBasePath(basePath: string) {
        this.setGitInstance(true);
    }

    async getDiffString(filePath: string, stagedChanges = false): Promise<string> {
        if (stagedChanges)
            return (await this.git.diff(["--cached", "--", filePath]));
        else
            return (await this.git.diff(["--", filePath]));
    }

    async diff(file: string, commit1: string, commit2: string): Promise<string> {
        return (await this.git.diff([`${commit1}..${commit2}`, "--", file]));
    }

    async getSubmoduleOfFile(filepath: string): Promise<{submodule: string; relativeFilepath: string; } | undefined> {
        // git -C <dir-of-file> rev-parse --show-superproject-working-tree
        // returns the parent git repository, if the file is in a submodule - otherwise empty.
        // git -C <dir-of-file> rev-parse --show-toplevel
        // returns the submodules repository root as an absolute path
        // https://git-scm.com/docs/git-rev-parse#Documentation/git-rev-parse.txt---show-superproject-working-tree
        let root = await this.git.raw(
                ["-C", path.dirname(filepath),"rev-parse","--show-toplevel"],
            (err) => err && console.warn("get-submodule-of-file", err?.message));
        root = root.trim();

        const superProject = await this.git.raw(
            ["-C", path.dirname(filepath),"rev-parse","--show-superproject-working-tree"],
            (err) => err && console.warn("get-submodule-of-file", err?.message));

        if (superProject.trim() === "") {
            return undefined; // not in submodule
        }

        const fsAdapter = this.app.vault.adapter as FileSystemAdapter;
        const absolutePath = fsAdapter.getFullPath(path.normalize(filepath));
        const newRelativePath = path.relative(root, absolutePath);

        return {submodule: root, relativeFilepath: newRelativePath};
    }

    private isGitInstalled(): boolean {
        // https://github.com/steveukx/git-js/issues/402
        const command = spawnSync(this.plugin.localStorage.getGitPath() || 'git', ['--version'], {
            stdio: 'ignore'
        });

        if (command.error) {
            console.error(command.error);
            return false;
        }
        return true;
    }

    private onError(error: Error | null) {
        if (error) {
            let networkFailure = error.message.contains("Could not resolve host") || error.message.match(/ssh: connect to host .*? port .*?: Operation timed out/);
            if (!networkFailure) {
                this.plugin.displayError(error.message);
                this.plugin.setState(PluginState.idle);
            } else if (!this.plugin.offlineMode) {
                this.plugin.displayError("Git: Going into offline mode. Future network errors will no longer be displayed.", 2000);
            }

            if (networkFailure) {
                this.plugin.offlineMode = true;
                this.plugin.setState(PluginState.idle);
            }
        }
    }
}

// Parse git blame porcelain format: https://git-scm.com/docs/git-blame#_the_porcelain_format
function parseBlame(blameOutputUnnormalized: string): Blame {
    const blameOutput = blameOutputUnnormalized.replace("\r\n","\n");

    const blameLines = blameOutput.split("\n")
    
    const result: Blame = {
        commits: new Map(),
        hashPerLine: [undefined], // one-based indices
        originalFileLineNrPerLine: [undefined],
        finalFileLineNrPerLine: [undefined],
        groupSizePerStartingLine: new Map(),
    };
    
    let line = 1;
    for (let bi=0; bi<blameLines.length;) {

        if (startsWithNonWhitespace(blameLines[bi])) {
            const lineInfo = blameLines[bi].split(" ");

            const commitHash = parseLineInfoInto(lineInfo, line, result);
            bi++;

            // parse header values until a tab is encountered
            for (; startsWithNonWhitespace(blameLines[bi]); bi++) {
                const spaceSeparatedHeaderValues = blameLines[bi].split(" ");
                parseHeaderInto(spaceSeparatedHeaderValues, result, line);
            }
            finalizeBlameCommitInfo(result.commits.get(commitHash));

            // skip tab prefixed line
            line += 1;
        }
        else if (blameLines[bi] === "" && bi === blameLines.length-1 ) {
            // EOF
        }
        else {
            throw Error(`Expected non-whitespace line or EOF, but found: ${blameLines[bi]}`);
        }
        bi++;
    }
    return result;
}

function parseLineInfoInto(lineInfo: string[], line: number, result: Blame) {
    const hash = lineInfo[0];
    result.hashPerLine.push(hash);
    result.originalFileLineNrPerLine.push(parseInt(lineInfo[1]));
    result.finalFileLineNrPerLine.push(parseInt(lineInfo[2]));
    (lineInfo.length >= 4) && result.groupSizePerStartingLine.set(line, parseInt(lineInfo[3]));

    if (parseInt(lineInfo[2]) !== line) {
        throw Error(`git-blame output is out of order: ${line} vs ${lineInfo[2]}`);
    }

    return hash;
}

function parseHeaderInto(header: string[], out: Blame, line: number) {
    const key = header[0];
    const commitHash = out.hashPerLine[line];
    const commit = out.commits.get(commitHash) || 
        <BlameCommit>{hash: commitHash, author: {}, committer: {}, previous: {}};

    switch(key) {
        case "summary": commit.summary = header.slice(1).join(" "); break;

        case "author": commit.author.name = header[1]; break;
        case "author-mail": commit.author.email = removeEmailBrackets(header[1]); break;
        case "author-time": commit.author.epochSeconds = parseInt(header[1]); break;
        case "author-tz": commit.author.tz = header[1]; break;

        case "committer": commit.committer.name = header[1]; break;
        case "committer-mail": commit.committer.email = removeEmailBrackets(header[1]); break;
        case "committer-time": commit.committer.epochSeconds = parseInt(header[1]); break;
        case "committer-tz": commit.committer.tz = header[1]; break;

        case "previous": commit.previous.commitHash = header[1]; break;
        case "filename": commit.previous.filename = header[1]; break;
    }
    out.commits.set(commitHash, commit);
}

function finalizeBlameCommitInfo(commit: BlameCommit) {
    if (commit.summary === undefined) {
        throw Error(`Summary not provided for commit: ${commit.hash}`);
    }

    if (isUndefinedOrEmptyObject(commit.author)) {
        commit.author = undefined;
    }
    if (isUndefinedOrEmptyObject(commit.committer)) {
        commit.committer = undefined;
    }
    if (isUndefinedOrEmptyObject(commit.previous)) {
        commit.previous = undefined;
    }

    commit.isZeroCommit = Boolean(commit.hash.match(/^0*$/));
}

function isUndefinedOrEmptyObject(obj: object): boolean {
    return !obj || Object.keys(obj).length === 0;
}

function startsWithNonWhitespace(str: string): boolean {
    return str.length > 0 && str[0].trim() === str[0];
}

function removeEmailBrackets(gitEmail: string) {
    const prefixCleaned = gitEmail.startsWith("<") ? gitEmail.substring(1) : gitEmail;
    return prefixCleaned.endsWith(">") ? prefixCleaned.substring(0,prefixCleaned.length-1) : prefixCleaned;
}