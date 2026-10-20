import { z } from 'zod';
import { GEMINI_API_KEY, GEMINI_SUMMARY_MODEL } from '$app/env/private';
import { selectedSummary, summarySentences } from './summary-extract.ts';
import { readSummaryResponse, SummaryProviderError, summaryPrompt } from './summary-provider.ts';

const key = GEMINI_API_KEY?.trim();
const model = GEMINI_SUMMARY_MODEL?.trim() || 'gemini-3.5-flash-lite';
export const geminiConfigured = Boolean(key) && /^gemini-[a-zA-Z0-9._-]{1,90}$/.test(model);
export const geminiModel = `gemini:${model}`;

export async function requestGeminiSummary(text: string) {
	if (!geminiConfigured)
		throw new SummaryProviderError('Configure the server Gemini API key and model.', 503);
	const sentences = summarySentences(text);
	const signal = AbortSignal.timeout(90000);
	let response: Response;
	try {
		response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
			{
				method: 'POST',
				signal,
				redirect: 'error',
				headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key! },
				body: JSON.stringify({
					systemInstruction: { parts: [{ text: summaryPrompt }] },
					contents: [
						{
							role: 'user',
							parts: [
								{ text: JSON.stringify({ sentences: sentences.map((text, id) => ({ id, text })) }) }
							]
						}
					],
					generationConfig: {
						temperature: 0,
						maxOutputTokens: 2048,
						responseMimeType: 'application/json',
						responseSchema: {
							type: 'OBJECT',
							properties: { sentenceIds: { type: 'ARRAY', items: { type: 'INTEGER' } } },
							required: ['sentenceIds']
						}
					}
				})
			}
		);
	} catch {
		throw new SummaryProviderError(
			signal.aborted
				? 'Gemini took longer than 90 seconds. Try again later.'
				: 'Cannot reach Gemini. Check the server connection.',
			503
		);
	}
	if (!response.ok) {
		await response.body?.cancel();
		if (response.status === 401 || response.status === 403)
			throw new SummaryProviderError(
				'Gemini did not accept the server API key or access permissions.',
				503
			);
		if (response.status === 429)
			throw new SummaryProviderError(
				'Gemini quota or rate limit reached. Check the Google project and retry later.',
				503
			);
		if (response.status === 400 || response.status === 404)
			throw new SummaryProviderError(
				'Gemini model or request configuration is unavailable. Check GEMINI_SUMMARY_MODEL.',
				503
			);
		throw new SummaryProviderError('Gemini could not generate a summary. Try again later.');
	}
	const result = z
		.object({
			candidates: z
				.array(
					z.object({
						finishReason: z.literal('STOP'),
						content: z.object({
							role: z.literal('model'),
							parts: z.array(z.object({ text: z.string(), thought: z.boolean().optional() })).min(1)
						})
					})
				)
				.length(1)
		})
		.parse(await readSummaryResponse(response));
	const content = result.candidates[0].content.parts
		.filter((part) => !part.thought)
		.map((part) => part.text)
		.join('');
	return selectedSummary(sentences, JSON.parse(content));
}
