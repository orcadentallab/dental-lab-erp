import type { Doctor, Order } from '../services/db';
import { normalizeArabicText } from './searchUtils';

const normalize = (value: string) => normalizeArabicText(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const distance = (first: string, second: string): number => {
    const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
    for (let row = 1; row <= first.length; row += 1) {
        const current = [row];
        for (let column = 1; column <= second.length; column += 1) {
            current[column] = Math.min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (first[row - 1] === second[column - 1] ? 0 : 1),
            );
        }
        previous.splice(0, previous.length, ...current);
    }
    return previous[second.length];
};

const tokenScore = (queryToken: string, targetToken: string): number | null => {
    if (targetToken.includes(queryToken)) return queryToken === targetToken ? 0 : 1;
    // A single typo is common even in short Arabic names: علة → علي.
    const allowedDistance = queryToken.length >= 3 ? 1 : 0;
    const editDistance = distance(queryToken, targetToken);
    return editDistance <= allowedDistance ? editDistance + 2 : null;
};

export const scoreSmartMatch = (query: string, candidate: string): number | null => {
    const compactQuery = normalize(query).replaceAll(' ', '');
    const compactCandidate = normalize(candidate).replaceAll(' ', '');
    // Keeps Arabic compound names equivalent: عبدالله = عبد الله.
    if (compactQuery && compactCandidate.includes(compactQuery)) {
        return compactQuery === compactCandidate ? 0 : 1;
    }

    const queryTokens = normalize(query).split(' ').filter(Boolean);
    const targetTokens = normalize(candidate).split(' ').filter(Boolean);
    if (!queryTokens.length || !targetTokens.length) return null;

    let score = 0;
    for (const queryToken of queryTokens) {
        const scores = targetTokens
            .map(targetToken => tokenScore(queryToken, targetToken))
            .filter((value): value is number => value !== null);
        if (!scores.length) return null;
        score += Math.min(...scores);
    }
    return score;
};

export interface SmartSearchResults {
    activeOrders: Order[];
    deliveredOrders: Order[];
    archivedOrders: Order[];
    doctors: Array<{ doctor: Doctor; orderCount: number }>;
    suggestion?: string;
}

const getCorrectionSuggestion = (query: string, orders: Order[], doctors: Doctor[]): string | undefined => {
    const queryTokens = query.trim().split(/\s+/).filter(Boolean);
    if (!queryTokens.length) return undefined;

    const knownTokens = [...orders.map(order => order.patientName), ...doctors.map(doctor => doctor.name)]
        .flatMap(name => name.trim().split(/\s+/))
        .filter(token => token.length >= 3);

    let best: { queryIndex: number; token: string; distance: number } | undefined;
    queryTokens.forEach((queryToken, queryIndex) => {
        const normalizedQuery = normalize(queryToken);
        knownTokens.forEach(token => {
            const normalizedToken = normalize(token);
            if (!normalizedQuery || normalizedQuery === normalizedToken) return;
            const editDistance = distance(normalizedQuery, normalizedToken);
            if (editDistance > 1 || (best && editDistance >= best.distance)) return;
            best = { queryIndex, token, distance: editDistance };
        });
    });

    if (!best) return undefined;
    const corrected = [...queryTokens];
    corrected[best.queryIndex] = best.token;
    return corrected.join(' ');
};

export const buildSmartSearchResults = (
    query: string,
    orders: Order[],
    doctors: Doctor[],
): SmartSearchResults => {
    const orderMatches = orders
        .map(order => ({ order, score: Math.min(
            scoreSmartMatch(query, order.patientName) ?? Number.POSITIVE_INFINITY,
            scoreSmartMatch(query, order.caseId) ?? Number.POSITIVE_INFINITY,
        ) }))
        .filter(({ score }) => Number.isFinite(score))
        .sort((a, b) => a.score - b.score || b.order.createdAt.localeCompare(a.order.createdAt));

    const doctorMatches = doctors
        .map(doctor => ({
            doctor,
            score: Math.min(
                scoreSmartMatch(query, doctor.name) ?? Number.POSITIVE_INFINITY,
                scoreSmartMatch(query, doctor.doctorCode) ?? Number.POSITIVE_INFINITY,
            ),
        }))
        .filter((item): item is { doctor: Doctor; score: number } => Number.isFinite(item.score))
        .sort((a, b) => a.score - b.score || a.doctor.name.localeCompare(b.doctor.name));

    const topPatientMatch = orderMatches.find(({ order }) => scoreSmartMatch(query, order.patientName) !== null);
    const suggestion = getCorrectionSuggestion(query, orders, doctors)
        ?? (topPatientMatch && normalize(topPatientMatch.order.patientName) !== normalize(query)
            ? topPatientMatch.order.patientName
            : undefined);

    return {
        activeOrders: orderMatches.filter(({ order }) => !order.isArchived && order.status !== 'Delivered').map(({ order }) => order),
        deliveredOrders: orderMatches.filter(({ order }) => !order.isArchived && order.status === 'Delivered').map(({ order }) => order),
        archivedOrders: orderMatches.filter(({ order }) => order.isArchived).map(({ order }) => order),
        doctors: doctorMatches.map(({ doctor }) => ({
            doctor,
            orderCount: orders.filter(order => order.doctorId === doctor.id && !order.isDeleted).length,
        })),
        suggestion,
    };
};

/**
 * Destination search, reusing the same Arabic normalisation the record
 * search already had -- diacritics, alef and hamza variants, compound
 * names, and a one-character typo budget. Aliases carry the words people
 * actually type ("الجودة" for the issues report, "الطابور" for tasks).
 */
export interface DestinationMatch<T> { destination: T; score: number }

export function searchDestinations<T extends { labelAr: string; labelEn: string; aliases?: string[] }>(
    query: string,
    destinations: T[],
): DestinationMatch<T>[] {
    if (!query.trim()) return [];
    return destinations
        .map(destination => {
            const candidates = [destination.labelAr, destination.labelEn, ...(destination.aliases || [])];
            const score = Math.min(
                ...candidates.map(candidate => scoreSmartMatch(query, candidate) ?? Number.POSITIVE_INFINITY)
            );
            return { destination, score };
        })
        .filter(({ score }) => Number.isFinite(score))
        .sort((a, b) => a.score - b.score);
}
