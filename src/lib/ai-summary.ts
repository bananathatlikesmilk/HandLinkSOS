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
	configured: boolean;
	summary: AiSummary | null;
	generationPending: boolean;
};
