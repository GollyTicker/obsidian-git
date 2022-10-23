import * as cssColorConverter from "css-color-converter";
import deepEqual from "deep-equal";
import { Moment } from "moment";
import { moment, Keymap, RGB, WorkspaceLeaf } from "obsidian";

export const worthWalking = (filepath: string, root?: string) => {
    if (filepath === '.' || root == null || root.length === 0 || root === '.') {
        return true;
    }
    if (root.length >= filepath.length) {
        return root.startsWith(filepath);
    } else {
        return filepath.startsWith(root);
    }
};

export function getNewLeaf(event?: MouseEvent): WorkspaceLeaf | undefined {
    let leaf: WorkspaceLeaf | undefined;
    if (event) {
        if ((event.button === 0 || event.button === 1)) {
            const type = Keymap.isModEvent(event);
            leaf = app.workspace.getLeaf(type);
        }
    } else {
        leaf = app.workspace.getLeaf(false);

    }
    return leaf;
}

/**
 * Creates a type-error, if this function is in a possible branch.
 *
 * Use this to ensure exhaustive switch cases.
 *
 * During runtime, an error will be thrown, if executed.
 */
export function impossibleBranch(x: never): never {
    throw new Error("Impossible branch: " + x);
}

export function currentMoment(): Moment {
    return moment.unix(Date.now() / 1000);
}

export function rgbToString(rgb: RGB): string {
    return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
}

export function convertToRgb(str: string): RGB | undefined {
    const color = cssColorConverter.fromString(str)?.toRgbaArray();
    if (color === undefined) {
        return undefined;
    }
    const [r, g, b] = color;
    return { r, g, b };
}

export function momentToEpochSeconds(instant: Moment): number {
    return instant.diff(moment.unix(0), "seconds");
}

export function median(array: number[]): number | undefined {
    if (array.length === 0) return undefined;
    return array.slice().sort()[Math.floor(array.length / 2)];
}

export function strictDeepEqual<T>(a: T, b: T): boolean {
    return deepEqual(a, b, { strict: true });
}

export function resizeToLength(original: string, desiredLength: number, fillChar: string): string {
    if (original.length <= desiredLength) {
        const prefix = new Array(desiredLength - original.length).fill(fillChar).join("");
        return prefix + original;
    }
    else {
        return original.substring(original.length - desiredLength);
    }
}

export function between(l: number, x: number, r: number) {
    return l <= x && x <= r;
}