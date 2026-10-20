import { z } from 'zod';
import { OLLAMA_SUMMARY_MODEL, OLLAMA_SERVER_URL } from '$app/env/private';
import { validatedSummary, summaryDraftSchema, summarySentences } from './summary-extract.ts';
import { ollamaServerOrigin } from './ollama-config.ts';
import { readSummaryResponse, SummaryProviderError, summaryPrompt } from './summary-provider.ts';
export { SummaryProviderError as OllamaSummaryError } from './summary-provider.ts';

const localModel = OLLAMA_SUMMARY_MODEL?.trim() || 'qwen2.5:3b';
const server = ollamaServerOrigin(OLLAMA_SERVER_URL);
export const aiConfigured =
	server !== null &&
	/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,89}$/.test(localModel) &&
	!/(?:[:.-])cloud$/i.test(localModel);
export const summaryModel = `ollama:${localModel}`;

export async function requestOllamaSummary(text: string) {
	if (!aiConfigured)
		throw new SummaryProviderError(
			'Configure OLLAMA_SERVER_URL as an HTTP(S) origin and select a local Ollama model. Cloud models are not supported.',
			503
		);
	const sentences = summarySentences(text);
	const selectionSchema = summaryDraftSchema(sentences.length);
	const signal = AbortSignal.timeout(90000);
	let response: Response;
	try {
		response = await fetch(`${server}/api/chat`, {
			method: 'POST',
			signal,
			redirect: 'error',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: localModel,
				stream: false,
				options: { temperature: 0, num_predict: 500, num_ctx: 4096 },
				messages: [
					{
						role: 'system',
						content: summaryPrompt
					},
					{
						role: 'user',
						content: JSON.stringify({ sentences: sentences.map((text, id) => ({ id, text })) })
					}
				],
				format: z.toJSONSchema(selectionSchema)
			})
		});
	} catch {
		throw new SummaryProviderError(
			signal.aborted
				? 'Local Ollama took longer than 90 seconds. Keep Ollama running and try again after the model loads.'
				: 'Cannot reach local Ollama. Start Ollama on the server computer and try again.',
			503
		);
	}
	if (!response.ok) {
		await response.body?.cancel();
		if (response.status === 404)
			throw new SummaryProviderError(
				'The Ollama summary model is not installed. Download the configured model on the server computer.',
				503
			);
		throw new SummaryProviderError(
			'Local Ollama could not run the summary model. Check available memory and retry after the cooldown.'
		);
	}
	const result = z
		.object({
			done: z.literal(true),
			done_reason: z.literal('stop'),
			message: z.object({
				role: z.literal('assistant'),
				content: z.string(),
				tool_calls: z.never().optional()
			})
		})
		.parse(await readSummaryResponse(response));
	return validatedSummary(sentences, JSON.parse(result.message.content));
}
