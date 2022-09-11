import { Platform } from "obsidian";
import { ObsidianGitSettings } from "./types";

export const DATE_FORMAT = "YYYY-MM-DD";
export const DATE_TIME_FROMAT_MINUTES = `${DATE_FORMAT} HH:mm`;
export const DATE_TIME_FROMAT_SECONDS = `${DATE_FORMAT} HH:mm:ss`;

export const DEFAULT_SETTINGS: ObsidianGitSettings = {
    commitMessage: "vault backup: {{date}}",
    autoCommitMessage: undefined, // default undefined for settings migration
    commitDateFormat: DATE_TIME_FROMAT_SECONDS,
    autoSaveInterval: 0,
    autoPushInterval: 0,
    autoPullInterval: 0,
    autoPullOnBoot: false,
    disablePush: false,
    pullBeforePush: true,
    disablePopups: false,
    listChangedFilesInMessageBody: false,
    showStatusBar: true,
    updateSubmodules: false,
    syncMethod: 'merge',
    customMessageOnAutoBackup: false,
    autoBackupAfterFileChange: false,
    treeStructure: false,
    refreshSourceControl: Platform.isDesktopApp,
    basePath: "",
    differentIntervalCommitAndPush: false,
    changedFilesInStatusBar: false,
    username: "",
    showedMobileNotice: false,
    refreshSourceControlTimer: 7000,
    showLineAuthorInfo: false,
    authorDisplayLineAuthorInfo: "full",
    showCommitHashLineAuthorInfo: false,
    dateTimeFormatOptionsLineAuthorInfo: "date",
    dateTimeFormatCustomStringLineAuthorInfo: DATE_TIME_FROMAT_MINUTES,
    dateTimeTimezoneLineAuthorInfo: "local",
    coloringMaxAgeLineAuthorInfo: "1y",
};

export const GIT_VIEW_CONFIG = {
    type: 'git-view',
    name: 'Source Control',
    icon: 'git-pull-request'
};

export const DIFF_VIEW_CONFIG = {
    type: 'diff-view',
    name: 'Diff View',
    icon: 'git-pull-request'
};
