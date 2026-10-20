import type { z } from 'zod';

export type InputProblem = { field: string; message: string };
const labels: Record<string, string> = {
	firstName: 'First name',
	lastName: 'Last name',
	name: 'Full name',
	email: 'Email',
	phone: 'Phone number',
	password: 'Password',
	birthday: 'Birthday',
	sex: 'Sex',
	relationship: 'Relationship',
	mutualRelationship: 'Your relationship',
	bloodType: 'Blood type',
	chronicCondition: 'Chronic condition',
	allergies: 'Allergies',
	currentMedications: 'Current medications',
	additionalInformation: 'Additional information',
	emergencyContacts: 'Emergency contacts',
	notes: 'Dispatcher notes',
	summary: 'Summary',
	approvedText: 'Notes approved for AI',
	code: 'Verification code',
	confirmed: 'Confirmation',
	verballyConfirmed: 'Verbal confirmation',
	durationMinutes: 'Sharing duration',
	recipientUserIds: 'Recipients',
	latitude: 'Latitude',
	longitude: 'Longitude',
	accuracy: 'Location accuracy',
	recordedAt: 'Location time',
	role: 'Account role',
	status: 'Status',
	action: 'Action',
	decision: 'Decision',
	reason: 'Reason',
	provider: 'AI provider',
	search: 'Search',
	page: 'Page',
	active: 'Account status',
	favorite: 'Favorite',
	token: 'QR code'
};

function describe(issue: z.ZodError['issues'][number]): InputProblem {
	const key = String(issue.path.at(-1) ?? '');
	const contactIndex = issue.path.indexOf('emergencyContacts');
	const number = contactIndex >= 0 ? issue.path[contactIndex + 1] : undefined;
	const field = `${typeof number === 'number' ? `Emergency contact ${number + 1} - ` : ''}${labels[key] ?? 'Form'}`;
	let message = 'Check this value and try again.';
	if (issue.code === 'unrecognized_keys')
		message = 'Unsupported fields were submitted. Refresh the page and try again.';
	else if (issue.code === 'invalid_type')
		message =
			issue.expected === 'number'
				? 'Enter a number.'
				: issue.expected === 'boolean'
					? 'Choose on or off.'
					: 'Complete this required field.';
	else if (issue.code === 'too_small') {
		message =
			issue.origin === 'string'
				? Number(issue.minimum) === 1
					? 'This field is required.'
					: `Use at least ${issue.minimum} characters.`
				: issue.origin === 'array'
					? `Choose at least ${issue.minimum} item(s).`
					: `Enter ${issue.minimum} or more.`;
	} else if (issue.code === 'too_big') {
		message =
			issue.origin === 'string'
				? `Use at most ${issue.maximum} characters.`
				: issue.origin === 'array'
					? `Choose no more than ${issue.maximum} items.`
					: `Enter ${issue.maximum} or less.`;
	} else if (issue.code === 'invalid_format') {
		message =
			key === 'phone'
				? 'Use 11 digits starting with 09, such as 09171234567.'
				: issue.format === 'email'
					? 'Enter a valid email, such as name@example.com.'
					: key === 'code'
						? 'Enter the 6-digit verification code.'
						: key === 'birthday'
							? 'Enter a valid date.'
							: issue.format === 'uuid'
								? 'This reference is invalid. Reload the page and try again.'
								: 'Use the required format.';
	} else if (issue.code === 'invalid_value' || issue.code === 'invalid_union')
		message =
			key === 'confirmed' || key === 'verballyConfirmed'
				? 'Tick the confirmation checkbox to continue.'
				: 'Choose a valid option.';
	else if (issue.code === 'custom') message = issue.message;
	return { field, message };
}

export function inputProblems(issues: z.ZodError['issues']): InputProblem[] {
	const expanded = issues.flatMap((issue) =>
		issue.code === 'invalid_union' && issue.errors.length
			? [...issue.errors].sort((a, b) => a.length - b.length)[0]
			: [issue]
	);
	// Only return field labels and rules, never submitted values, raw Zod diagnostics or unknown keys.
	const problems = expanded.map(describe);
	return [
		...new Map(problems.map((problem) => [`${problem.field}:${problem.message}`, problem])).values()
	].slice(0, 8);
}

export function inputProblemMessage(problems: InputProblem[]) {
	return problems.map((problem) => `${problem.field}: ${problem.message}`).join('\n');
}
