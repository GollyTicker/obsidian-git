export const worthWalking = (filepath: string, root: string) => {
    if (filepath === '.' || root == null || root.length === 0 || root === '.') {
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
    throw new Error("Imposible branch: " + x);
}