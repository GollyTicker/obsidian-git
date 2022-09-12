import {
    LineAuthoringSubscriber,
    LineAuthoringSubscribers
} from "src/ui/editor/lineAuthorInfo/control";

/** todo. */
class EventsPerFilePath {
    private eventsPerFilepath: Map<string, LineAuthoringSubscribers> = new Map();

    constructor() { }

    /** todo. */
    public ifFilepathDefinedTransformSubscribers<T>(
        filepath: string | undefined,
        fn: (las: LineAuthoringSubscribers) => T
    ): T | undefined {
        if (filepath === undefined) {
            return undefined;
        }

        this.eventsPerFilepath.get(filepath) ||
            this.eventsPerFilepath.set(filepath, new Set());

        return fn(this.eventsPerFilepath.get(filepath));
    }

    public forEachSubscriber(fn: (las: LineAuthoringSubscriber) => void): void {
        this.eventsPerFilepath.forEach((subs) => subs.forEach(fn));
    }

    public clear() {
        this.eventsPerFilepath.clear();
    }
}

export const eventsPerFilePathSingleton = new EventsPerFilePath();
