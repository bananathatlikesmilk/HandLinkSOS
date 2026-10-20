import { z } from 'zod';
import { SummaryProviderError } from './summary-provider.ts';

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

export function summaryDraftSchema(sentenceCount: number) {
	return z.strictObject({
		summary: z.string().trim().min(1).max(1500),
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

export function validatedSummary(sentences: string[], draft: unknown) {
	const { sentenceIds, summary } = summaryDraftSchema(sentences.length).parse(draft);
	if (new Set(sentenceIds).size !== sentenceIds.length)
		throw new Error('AI returned duplicate source references.');
	// References identify source material; they do not prove that a paraphrase is accurate.
	if (summary.split(/\s+/).length > 150) throw new Error('AI draft exceeded summary limits.');
	const source = sentences.join(' ').replace(/\s+/g, ' ').trim();
	if (source.split(/\s+/).length > 40 && summary.replace(/\s+/g, ' ').trim() === source)
		throw new SummaryProviderError(
			'AI copied the full notes instead of summarizing. Generate a new draft after the cooldown.'
		);
	if (containsSummaryInstructions(summary)) throw new Error('AI returned embedded instructions.');
	// Reject common added clinical/operational language seen in earlier model quality checks.
	// This is a narrow regression guard, not a semantic fact checker. Dispatcher review is required.
	for (const match of summary.matchAll(
		/\b(?:immediate|immediately|urgent|urgently|recommend\w*|prescrib\w*|diagnos\w*)\b/gi
	)) {
		if (!new RegExp(`\\b${match[0]}\\b`, 'i').test(source))
			throw new Error('AI added clinical or operational interpretation absent from the notes.');
	}
	return summary;
}
