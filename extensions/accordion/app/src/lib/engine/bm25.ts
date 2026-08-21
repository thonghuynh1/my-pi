export interface SearchDocument {
	id: string;
	text: string;
}

export interface SearchHit {
	id: string;
	snippet: string;
	score: number;
}

const K1 = 1.2;
const B = 0.75;
const SEARCH_BUDGET_MS = 3000;

const STOP_WORDS = new Set([
	"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "he", "in",
	"is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was", "were", "will",
	"with", "you", "your",
]);

function tokenize(text: string): string[] {
	return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((term) => !STOP_WORDS.has(term)) ?? [];
}

interface IndexedDocument {
	document: SearchDocument;
	terms: string[];
	termFrequency: Map<string, number>;
}

function indexDocument(document: SearchDocument): IndexedDocument {
	const terms = tokenize(document.text);
	const termFrequency = new Map<string, number>();
	for (const term of terms) {
		termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
	}
	return { document, terms, termFrequency };
}

function extractSnippet(text: string, queryTerms: Set<string>, deadline: number): string {
	const lines = text.split("\n");
	const windows: Array<[number, number]> = [];

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		if (Date.now() >= deadline) break;
		if (!tokenize(lines[lineIndex]).some((term) => queryTerms.has(term))) continue;
		const start = Math.max(0, lineIndex - 3);
		const end = Math.min(lines.length - 1, lineIndex + 3);
		const previous = windows[windows.length - 1];
		if (previous && start <= previous[1] + 1) {
			previous[1] = Math.max(previous[1], end);
		} else {
			windows.push([start, end]);
		}
	}

	return windows.map(([start, end]) => lines.slice(start, end + 1).join("\n")).join("\n…\n");
}

export function searchBlocks(docs: SearchDocument[], query: string, maxHits = 5): SearchHit[] {
	const deadline = Date.now() + SEARCH_BUDGET_MS;
	if (maxHits <= 0) return [];

	const queryTerms = new Set(tokenize(query));
	if (queryTerms.size === 0) return [];

	const indexed: IndexedDocument[] = [];
	for (const document of docs) {
		if (Date.now() >= deadline) break;
		indexed.push(indexDocument(document));
	}
	if (indexed.length === 0) return [];

	const documentFrequency = new Map<string, number>();
	for (const document of indexed) {
		for (const term of queryTerms) {
			if (document.termFrequency.has(term)) {
				documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
			}
		}
	}
	const averageLength = indexed.reduce((sum, document) => sum + document.terms.length, 0) / indexed.length;
	const hits: SearchHit[] = [];

	for (const document of indexed) {
		if (Date.now() >= deadline) break;
		let score = 0;
		for (const term of queryTerms) {
			const frequency = document.termFrequency.get(term) ?? 0;
			if (frequency === 0) continue;
			const frequencyWeight = (frequency * (K1 + 1)) /
				(frequency + K1 * (1 - B + B * document.terms.length / averageLength));
			const idf = Math.log(1 + (indexed.length - (documentFrequency.get(term) ?? 0) + 0.5) /
				((documentFrequency.get(term) ?? 0) + 0.5));
			score += idf * frequencyWeight;
		}
		if (score > 0) {
			hits.push({
				id: document.document.id,
				snippet: extractSnippet(document.document.text, queryTerms, deadline),
				score,
			});
		}
	}

	return hits
		.sort((left, right) => right.score - left.score)
		.slice(0, maxHits);
}
