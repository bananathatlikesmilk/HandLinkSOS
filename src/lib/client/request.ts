export class ApiRequestError extends Error {
	public status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export async function apiFetch(url: string, init?: RequestInit, timeoutMs = 20000) {
	const timeout = AbortSignal.timeout(timeoutMs);
	const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
	try {
		return await fetch(url, { ...init, signal, cache: 'no-store' });
	} catch (cause) {
		if (init?.signal?.aborted) throw cause;
		throw new ApiRequestError(
			timeout.aborted
				? 'The server took too long to respond. Check whether your change was saved before retrying.'
				: 'Cannot reach the server. Check your internet connection and try again.',
			timeout.aborted ? 408 : 0
		);
	}
}

export async function readApiResponse(response: Response): Promise<unknown> {
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		const fallback: Record<number, string> = {
			401: 'Your session expired. Log in again.',
			403: 'Your account cannot perform this action. Check your access or sign in again.',
			404: 'This item is no longer available. Refresh the page.',
			409: 'This information changed or is already in use. Refresh and check your details.',
			413: 'Too much information was submitted. Shorten the text and try again.',
			422: 'Check the required fields and their formats.',
			429: 'Too many attempts. Wait before trying again.',
			500: 'The server could not complete this action. Please try again later.'
		};
		const message =
			response.status !== 500 && typeof body?.message === 'string' && body.message.trim()
				? body.message
				: (fallback[response.status] ?? `Request failed (${response.status}). Please try again.`);
		throw new ApiRequestError(message, response.status);
	}
	if (body === null)
		throw new Error('Server returned an unreadable response. Refresh the page and try again.');
	return body;
}

export async function apiRequest<T>(
	url: string,
	init?: RequestInit,
	timeoutMs = 20000
): Promise<T> {
	return (await readApiResponse(await apiFetch(url, init, timeoutMs))) as T;
}
