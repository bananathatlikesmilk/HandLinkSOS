export class ApiRequestError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}

export async function apiRequest<T>(
	url: string,
	init?: RequestInit,
	timeoutMs = 20000
): Promise<T> {
	const timeout = AbortSignal.timeout(timeoutMs);
	const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
	const response = await fetch(url, { ...init, signal, cache: 'no-store' });
	const body = await response.json().catch(() => null);
	if (!response.ok)
		throw new ApiRequestError(
			body?.message || `Request failed (${response.status}). Please try again.`,
			response.status
		);
	if (!body) throw new Error('Server returned an unreadable response. Please try again.');
	return body as T;
}
