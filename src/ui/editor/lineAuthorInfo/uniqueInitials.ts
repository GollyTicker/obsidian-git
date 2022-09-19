import { Blame } from "src/types";
import { nonEmptyWords } from "src/utils";

export function getAuthors(gitResult: Blame) {
    const authors: Set<string> = new Set();
    for (const commit of gitResult.commits.values()) {
        !commit.isZeroCommit && commit?.author?.name !== undefined && authors.add(commit.author.name);
    }
    return authors;
}

export function preComputeUniqueInitials(authors: Set<string>): Map<string, string> {
    const incrementalInitials: Map<string, string[]> = new Map();
    for (const author of authors) {
        incrementalInitials.set(author, nonEmptyWords(author).map(words => words[0]));
    }

    let lastNameInitialsLength = 1;

    // as long as the incremental initials are not yet unique
    // add a new letter in the last name until it becomes unique
    let hasDuplicates = revMapHasDuplicates(reverseMapping(incrementalInitials));
    while (!hasDuplicates) {
        const revMap = reverseMapping(incrementalInitials);
        for (const [initialsStr, authors] of incrementalInitials.entries()) {
            // add one letter to the initials for these authors

        }
    }

    return incrementalInitials;
}

function reverseMapping(incrementalInitials: Map<string, string[]>): Map<string, string[]> {
    const reverse: Map<string/* initials as string */, string[] /* authors*/> = new Map();
    for (const [author, initials] of incrementalInitials.entries()) {
        const initialsStr = initials.join("");
        reverse.get(initialsStr) ?? reverse.set(initialsStr, []);
        reverse.get(initialsStr).push(author);
    }
    return reverse;
}



function revMapHasDuplicates(reverseMapping: Map<string, string[]>): boolean {
    for (const [_, authors] of reverseMapping.entries()) {
        if (authors.length > 1) return true;
    }
    return false;
}

/* 
    const authorsToBeShortened = new Set(authors);
    while (authorsToBeShortened.size >= 1) {
        const authorTBS: string = authors.values().next().value;

        for (const otherAuthor of authors) {
            if (authorTBS === otherAuthor) continue;

            const lInits = incrementalUniqueInitials.get(authorTBS);
            const rInits = incrementalUniqueInitials.get(otherAuthor);

        }
    }

    Joa Jserer  => Joa Jse => J Jse => (fin) JJse
    Jie Jsoerr  => Jie Jso => J Jso => (fin) JJso
                         ^    ^
                         remove longest suffix, so that the rest remains different
*/