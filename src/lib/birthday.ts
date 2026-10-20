// Eligibility uses the Philippine calendar date, not the device's timezone.
export function latestEligibleBirthday(now = new Date()) {
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Manila',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
	const [year, month, day] = today.split('-').map(Number);
	const eligibleYear = year - 2;
	const lastDay = new Date(Date.UTC(eligibleYear, month, 0)).getUTCDate();
	return `${eligibleYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function eligibleBirthday(value: string, now = new Date()) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return (
		Number.isFinite(date.getTime()) &&
		date.toISOString().slice(0, 10) === value &&
		value <= latestEligibleBirthday(now)
	);
}
