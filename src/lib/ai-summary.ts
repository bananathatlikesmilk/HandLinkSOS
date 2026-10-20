export type AiProvider = 'ollama' | 'gemini';
export type AiProviderChoice = {
	provider: AiProvider;
	revision: string;
	configured: boolean;
	model: string;
};
export type AiSummary = {
	requestId: string | null;
	summary: string;
	generatedAt: string;
	reviewedAt: string | null;
	reviewedByUserId: string | null;
	model: string | null;
	isStale: boolean;
};
export type AiSummaryState = {
	provider: AiProvider;
	providerRevision: string;
	configured: boolean;
	summary: AiSummary | null;
	generationPending: boolean;
};
