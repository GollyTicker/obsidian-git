import * as moment from "moment";
import { Moment } from "moment";
import { RGB } from "obsidian";
import * as cssColorConverter from "css-color-converter";

export const worthWalking = (filepath: string, root: string) => {
    if (filepath === "." || root == null || root.length === 0 || root === ".") {
        return true;
    }
    if (root.length >= filepath.length) {
        return root.startsWith(filepath);
    } else {
        return filepath.startsWith(root);
    }
};

/**
 * Creates a type-error, if this function is in a possible branch.
 *
 * Use this to ensure exhaustive switch cases.
 *
 * During runtime, an error will be thrown, if executed.
 */
export function typeCheckedUnreachable(x: never): never {
    throw new Error("Impossible branch: " + x);
}

export function currentMoment(): Moment {
    return moment.unix(Date.now() / 1000);
}

export function rgbToString(rgb: RGB): string {
    return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
}

export function convertToRgb(str: string): RGB {
    const color = cssColorConverter.fromString(str)?.toRgbaArray();
    if (color === undefined) {
        return undefined;
    }
    const [r, g, b, _a] = color;
    return { r, g, b };
}

export function momentToEpochSeconds(instant: Moment): number {
    return instant.diff(moment.unix(0), "seconds");
}

export function median(array: number[]) {
    if (array.length === 0) return undefined;
    return array.slice().sort()[Math.floor(array.length / 2)];
}