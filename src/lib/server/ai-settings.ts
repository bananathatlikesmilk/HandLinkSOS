import { eq } from 'drizzle-orm';
import { error, type RequestEvent } from '@sveltejs/kit';
import type { AiProvider, AiProviderChoice } from '../ai-summary.ts';
import { db } from './db/index.ts';
import { aiProviderSetting } from './db/schema.ts';
import { requireAdmin } from './api.ts';
import { summaryProviders } from './summary-providers.ts';

export function selectedAiProvider(): AiProviderChoice {
	const saved = db
		.select()
		.from(aiProviderSetting)
		.where(eq(aiProviderSetting.id, 'summary'))
		.get();
	const provider = saved?.provider ?? 'ollama';
	return { provider, revision: saved?.revision ?? 'default', ...summaryProviders[provider] };
}
export function adminAiSettings(event: RequestEvent) {
	requireAdmin(event);
	return { selected: selectedAiProvider(), providers: summaryProviders };
}
export function saveAiSettings(event: RequestEvent, provider: AiProvider) {
	return db.transaction(
		() => {
			const actor = requireAdmin(event);
			if (!summaryProviders[provider].configured)
				error(
					503,
					provider === 'gemini'
						? 'Set GEMINI_API_KEY and a valid GEMINI_SUMMARY_MODEL on the server, then restart the app.'
						: 'Configure the server Ollama address and model first.'
				);
			if (selectedAiProvider().provider !== provider) {
				const values = {
					provider,
					revision: crypto.randomUUID(),
					updatedByUserId: actor.id,
					updatedAt: new Date()
				};
				db.insert(aiProviderSetting)
					.values({ id: 'summary', ...values })
					.onConflictDoUpdate({ target: aiProviderSetting.id, set: values })
					.run();
			}
			return adminAiSettings(event);
		},
		{ behavior: 'immediate' }
	);
}
