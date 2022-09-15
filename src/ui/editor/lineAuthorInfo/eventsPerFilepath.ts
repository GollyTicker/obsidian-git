import {
    LineAuthoringSubscriber,
    LineAuthoringSubscribers
} from "src/ui/editor/lineAuthorInfo/control";

/**
 * * stores the subscribers/editors interested in changed per filepath
 * * We need this pub-sub design, because a filepath may be opened in multiple editors
 *   and each editor should be updated asynchronously and independently.
 * * Subscribers can be cleared when the feature is deactivated
*/
class EventsPerFilePath {
    private eventsPerFilepath: Map<string, LineAuthoringSubscribers> = new Map();

    constructor() { }

    /** 
     * Run the {@link handler} on the subscribers to {@link filepath}.
    */
    public ifFilepathDefinedTransformSubscribers<T>(
        filepath: string | undefined,
        handler: (las: LineAuthoringSubscribers) => T
    ): T | undefined {
        if (!filepath) return;

        this.ensureInitialized(filepath);

        return handler(this.eventsPerFilepath.get(filepath));
    }

    public forEachSubscriber(handler: (las: LineAuthoringSubscriber) => void): void {
        this.eventsPerFilepath.forEach((subs) => subs.forEach(handler));
    }

    private ensureInitialized(filepath: string) {
        if (!this.eventsPerFilepath.get(filepath))
            this.eventsPerFilepath.set(filepath, new Set());
    }

    public clear() {
        this.eventsPerFilepath.clear();
    }
}

export const eventsPerFilePathSingleton = new EventsPerFilePath();
