import { aiConfigured, summaryModel, requestOllamaSummary } from './ollama-summary.ts';
import { geminiConfigured, geminiModel, requestGeminiSummary } from './gemini-summary.ts';
import type { AiProvider } from '../ai-summary.ts';

export const summaryProviders = {
	ollama: { configured: aiConfigured, model: summaryModel },
	gemini: { configured: geminiConfigured, model: geminiModel }
};
export function requestSummary(provider: AiProvider, text: string) {
	return provider === 'gemini' ? requestGeminiSummary(text) : requestOllamaSummary(text);
}
