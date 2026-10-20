// Only server configuration chooses the host. Request input never selects an AI destination.
export function ollamaServerOrigin(value: string | undefined): string | null {
	if (value === undefined) return 'http://127.0.0.1:11434';
	try {
		const address = value.trim();
		if (!/^https?:\/\//i.test(address)) return null;
		const url = new URL(address);
		if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
		return url.origin;
	} catch {
		return null;
	}
}
