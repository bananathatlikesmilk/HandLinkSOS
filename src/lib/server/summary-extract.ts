import { z } from 'zod';

// This catches common embedded prompts, not every possible instruction or private detail.
export function containsSummaryInstructions(text: string) {
	const normalized = text.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, ' ');
	return /\bignore\s+(?:(?:all|the|any)\s+)?(?:previous|prior|above|system)\s+(?:instructions?|prompts?|rules?)|\b(?:reveal|disclose|print|output)\b.{0,80}\b(?:medical records?|system prompt|api key|password)|\b(?:system|developer|assistant)\s*(?:message|prompt)\s*:|<\|(?:im_start|system|assistant)\|>/iu.test(
		normalized
	);
}

export function summarySentences(text: string) {
	return [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)]
		.map((part) => part.segment.trim())
		.filter(Boolean);
}

export function summarySelectionSchema(sentenceCount: number) {
	return z.strictObject({
		sentenceIds: z
			.array(
				z
					.number()
					.int()
					.min(0)
					.max(sentenceCount - 1)
			)
			.min(1)
			.max(sentenceCount)
	});
}

export function selectedSummary(sentences: string[], selection: unknown) {
	const { sentenceIds } = summarySelectionSchema(sentences.length).parse(selection);
	if (sentenceIds.some((id, index) => index > 0 && id <= sentenceIds[index - 1]))
		throw new Error('AI selected duplicate or reordered sentences.');
	// Reconstruct from approved source, never from model-authored prose.
	const summary = sentenceIds.map((id) => sentences[id]).join(' ');
	if (!summary || summary.length > 1500 || summary.split(/\s+/).length > 150)
		throw new Error('AI selection exceeded summary limits.');
	return summary;
}
