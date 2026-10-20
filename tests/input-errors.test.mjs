import test from 'node:test';
import assert from 'node:assert/strict';
import { profileInput, staffAccountInput } from '../src/lib/server/validation.ts';
import { inputProblems, inputProblemMessage } from '../src/lib/server/input-errors.ts';
import { apiRequest, ApiRequestError } from '../src/lib/client/request.ts';

test('validation identifies nested fields and safe rules without echoing input values or unknown keys', () => {
	const result = profileInput.safeParse({
		firstName: ' ',
		lastName: 'Reyes',
		birthday: '2099-01-01',
		sex: 'Female',
		phone: 'PRIVATE-BAD-PHONE',
		medical: {
			bloodType: null,
			chronicCondition: '',
			allergies: '',
			currentMedications: '',
			additionalInformation: ''
		},
		emergencyContacts: [
			{
				firstName: 'Robin',
				lastName: 'Reyes',
				phone: '09171234567',
				email: 'PRIVATE-BAD-EMAIL',
				relationship: 'Friend'
			}
		],
		'PRIVATE-UNKNOWN-KEY': 'PRIVATE-INPUT'
	});
	assert.equal(result.success, false);
	const problems = inputProblems(result.error.issues);
	const text = inputProblemMessage(problems);
	assert.match(text, /First name: This field is required/);
	assert.match(text, /Phone number: Use 11 digits starting with 09/);
	assert.match(text, /Emergency contact 1 - Email: Enter a valid email/);
	assert.match(text, /Birthday: Enter a real birthday for someone at least 2 years old/);
	assert.doesNotMatch(JSON.stringify(problems), /PRIVATE|input|stack|received/);
	const staff = staffAccountInput.safeParse({
		name: 'Casey',
		email: 'name@example.com',
		password: 'SECRET',
		role: 'dispatcher'
	});
	assert.equal(staff.success, false);
	assert.equal(
		inputProblemMessage(inputProblems(staff.error.issues)),
		'Password: Use at least 12 characters.'
	);
});

test('request helper preserves precise input errors, masks internal errors and explains connection failures', async () => {
	const original = globalThis.fetch;
	try {
		globalThis.fetch = async () =>
			Response.json(
				{ message: 'Emergency contact 1 - Email: Enter a valid email.' },
				{ status: 422 }
			);
		await assert.rejects(
			apiRequest('/test'),
			(error) =>
				error instanceof ApiRequestError &&
				error.status === 422 &&
				error.message.includes('Emergency contact 1 - Email')
		);
		globalThis.fetch = async () =>
			Response.json({ message: 'PRIVATE-DATABASE-ERROR' }, { status: 500 });
		await assert.rejects(
			apiRequest('/test'),
			(error) => error.status === 500 && !error.message.includes('PRIVATE')
		);
		globalThis.fetch = async () => {
			throw new TypeError('PRIVATE-NETWORK-DETAIL');
		};
		await assert.rejects(
			apiRequest('/test'),
			(error) =>
				error.status === 0 &&
				error.message.includes('Check your internet connection') &&
				!error.message.includes('PRIVATE')
		);
		globalThis.fetch = async (_url, { signal }) =>
			new Promise((_resolve, reject) =>
				signal.addEventListener('abort', () => reject(signal.reason), { once: true })
			);
		const keepAlive = setTimeout(() => {}, 100);
		try {
			await assert.rejects(
				apiRequest('/test', undefined, 5),
				(error) =>
					error.status === 408 && error.message.includes('Check whether your change was saved')
			);
		} finally {
			clearTimeout(keepAlive);
		}
	} finally {
		globalThis.fetch = original;
	}
});
