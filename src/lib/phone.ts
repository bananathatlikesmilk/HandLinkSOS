// Forms show 11 local digits; API and stored values use the equivalent +63 format.
export function localPhone(value: string) {
	const digits = value.replace(/\D/g, '');
	return digits.startsWith('63') ? `0${digits.slice(2)}` : digits;
}

export function canonicalPhone(value: string) {
	const cleaned = value.trim().replace(/[\s()-]/g, '');
	if (/^09\d{9}$/.test(cleaned)) return `+63${cleaned.slice(1)}`;
	if (/^\+?639\d{9}$/.test(cleaned)) return `+${cleaned.replace(/^\+/, '')}`;
	return cleaned;
}
