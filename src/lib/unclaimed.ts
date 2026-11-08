export type UnclaimedSummary = {
	count: number;
	newestReferenceNumber: string;
	oldest: { id: string; reference: string; startedAt: string } | null;
	checkedAt: string;
};

export function unclaimedWait(milliseconds: number) {
	const seconds = Math.max(0, Math.floor(milliseconds / 1000));
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
