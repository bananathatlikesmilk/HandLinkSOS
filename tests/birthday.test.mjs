import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleBirthday, latestEligibleBirthday } from '../src/lib/birthday.ts';

test('minimum age includes the second birthday and excludes one day younger', () => {
	const now = new Date('2026-10-21T04:00:00Z');
	assert.equal(latestEligibleBirthday(now), '2024-10-21');
	assert.equal(eligibleBirthday('2024-10-21', now), true);
	assert.equal(eligibleBirthday('2024-10-20', now), true);
	assert.equal(eligibleBirthday('2024-10-22', now), false);
	assert.equal(eligibleBirthday('2025-01-01', now), false);
	assert.equal(eligibleBirthday('2027-01-01', now), false);
});

test('eligibility follows Philippine midnight and handles leap-year birthdays', () => {
	assert.equal(latestEligibleBirthday(new Date('2026-10-20T16:00:00Z')), '2024-10-21');
	assert.equal(latestEligibleBirthday(new Date('2028-02-29T04:00:00Z')), '2026-02-28');
	assert.equal(eligibleBirthday('2024-02-29', new Date('2026-02-28T04:00:00Z')), false);
	assert.equal(eligibleBirthday('2024-02-29', new Date('2026-03-01T04:00:00Z')), true);
	for (const date of ['2024-02-30', '2023-02-29', 'invalid', '2024-1-01'])
		assert.equal(eligibleBirthday(date, new Date('2026-10-21T04:00:00Z')), false);
});
