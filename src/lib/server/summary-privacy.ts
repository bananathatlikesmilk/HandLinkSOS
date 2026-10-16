const marker = '[redacted]';
const normalize = (text: string) =>
	text
		.normalize('NFKC')
		.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();

export function redactIncidentText(text: string, identifiers: string[]) {
	let result = normalize(text)
		.replace(/\b(?:https?:\/\/|www\.)\S+/giu, marker)
		.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu, marker);
	const values = [...new Set(identifiers.map(normalize).filter((value) => value.length >= 2))].sort(
		(a, b) => b.length - a.length
	);
	for (const value of values) {
		const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const expression = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
		result = result
			.split(marker)
			.map((part) => part.replace(expression, marker))
			.join(marker);
	}
	return result
		.replace(/\b(?:https?:\/\/|www\.)\S+/giu, marker)
		.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu, marker)
		.replace(/(?<![\p{L}\p{N}])\+?\d[\d(). -]{6,}\d(?![\p{L}\p{N}])/gu, marker)
		.replace(/[+-]?\d{1,3}\.\d{3,}/g, marker)
		.replace(/(?:\[redacted\]\s*){2,}/g, marker + ' ')
		.trim();
}

export function isDeletionOnly(original: string, approved: string) {
	let index = 0;
	for (const character of original) if (character === approved[index]) index++;
	return index === approved.length;
}

export function hasSummaryContent(text: string) {
	return text.replaceAll(marker, '').replace(/[^\p{L}]/gu, '').length >= 10;
}
