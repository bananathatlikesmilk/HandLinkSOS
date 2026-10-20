import { expect, test } from '@playwright/test';
import { headers, login, origin, provision, sos } from './incident-fixture';
import { invitation } from './trusted-fixture';

test('mutual request stays pending until separate approval; beneficiary sees SOS and dispatcher decision', async ({
	page,
	browser
}) => {
	test.setTimeout(120000);
	const person = await provision(),
		caller = await provision(),
		dispatcher = await provision('dispatcher');
	await login(page.request, person);
	const callerContext = await browser.newContext({ baseURL: origin });
	const staffContext = await browser.newContext({ baseURL: origin });
	try {
		await login(callerContext.request, caller);
		await login(staffContext.request, dispatcher);
		const qr = await invitation(page.request, person.id);
		expect(
			(
				await callerContext.request.post('/api/trusted/scan', {
					headers,
					data: { token: qr.token, relationship: 'Sibling' }
				})
			).status()
		).toBe(201);
		await page.goto('/user/profiles');
		const incoming = page.getByRole('article', { name: 'Request from Casey Reyes' });
		const mutual = incoming.getByRole('checkbox', {
			name: 'Also request permission to send SOS for them'
		});
		await expect(mutual).not.toBeChecked();
		await mutual.check();
		await incoming.getByLabel('Your relationship to this person').selectOption('Sibling');
		await incoming.getByRole('button', { name: 'Approve', exact: true }).click();
		await expect(
			page.getByText('Waiting for approval. You cannot send SOS for this person yet.')
		).toBeVisible();
		const callerPage = await callerContext.newPage();
		await callerPage.goto('/user/profiles');
		const reverse = callerPage.getByRole('article', { name: 'Request from Casey Reyes' });
		await expect(reverse.getByRole('checkbox')).not.toBeChecked();
		await reverse.getByRole('button', { name: 'Approve', exact: true }).click();
		await expect(reverse).toHaveCount(0);
		await page.goto('/user/dashboard');
		const created = await callerContext.request.post('/api/incidents', {
			headers,
			data: sos(person.profileId)
		});
		expect(created.status()).toBe(201);
		const { id, reference } = (await created.json()).incident;
		await expect(page.getByRole('link', { name: 'Updates, 1 unread' })).toBeVisible({
			timeout: 15000
		});
		await page.getByRole('link', { name: 'Updates, 1 unread' }).click();
		await expect(
			page.getByRole('heading', { name: 'Casey Reyes sent an SOS for you' })
		).toBeVisible();
		await expect(page.getByText(`Incident reference: ${reference}`, { exact: true })).toBeVisible();
		await expect(page.getByText(id, { exact: false })).toHaveCount(0);
		await page.getByRole('button', { name: 'Mark as read' }).click();
		await page.getByLabel('Reason for cancellation').fill('I am safe now. Please confirm with me.');
		await page.getByRole('button', { name: 'Request cancellation', exact: true }).click();
		await expect(page.getByText('Awaiting dispatcher review', { exact: true })).toBeVisible();
		expect(
			(
				await staffContext.request.post(`/api/staff/incidents/${id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(200);
		const staff = await staffContext.newPage();
		await staff.goto('/dispatch/reports');
		await staff.getByRole('button').filter({ hasText: reference }).click();
		await expect(staff.getByRole('region', { name: 'Cancellation request' })).toContainText(
			'I am safe now. Please confirm with me.'
		);
		staff.once('dialog', (dialog) => dialog.accept());
		await staff.getByRole('button', { name: 'Approve cancellation', exact: true }).click();
		await expect(
			staff.getByRole('heading', { name: 'Cancellation approved', exact: true })
		).toBeVisible();
		await expect(page.getByText('Cancellation approved', { exact: true })).toBeVisible({
			timeout: 15000
		});
		await expect(page.getByRole('link', { name: 'Updates, 1 unread' })).toBeVisible({
			timeout: 15000
		});
		await page.route('**/api/notifications?*', (route) =>
			route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Sign in first.' })
			})
		);
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect(
			page.getByRole('heading', { name: 'Casey Reyes sent an SOS for you' })
		).toHaveCount(0);
		await expect(page.getByRole('alert')).toContainText('Sign in first.');
	} finally {
		await callerContext.close();
		await staffContext.close();
	}
});

test('assigned dispatcher can reject cancellation in SOS workspace', async ({
	page,
	playwright
}) => {
	test.setTimeout(90000);
	const person = await provision(),
		caller = await provision();
	const owner = await playwright.request.newContext({ baseURL: origin }),
		scanner = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(owner, person);
		await login(scanner, caller);
		await login(page.request, await provision('dispatcher'));
		const qr = await invitation(owner, person.id);
		const connection = (
			await (
				await scanner.post('/api/trusted/scan', {
					headers,
					data: { token: qr.token, relationship: 'Sibling' }
				})
			).json()
		).connection;
		expect(
			(
				await owner.patch(`/api/trusted/${connection.id}`, {
					headers,
					data: { action: 'approve', invitationId: qr.invitationId }
				})
			).status()
		).toBe(200);
		const { id, reference } = (
			await (await scanner.post('/api/incidents', { headers, data: sos(person.profileId) })).json()
		).incident;
		expect(
			(
				await page.request.post(`/api/staff/incidents/${id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(200);
		expect(
			(
				await owner.post(`/api/incidents/${id}/cancellation`, {
					headers,
					data: { reason: 'Please check' }
				})
			).status()
		).toBe(200);
		await page.goto('/dispatch');
		await page.getByRole('button').filter({ hasText: reference }).click();
		await page.getByRole('button', { name: 'Reject cancellation', exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Cancellation rejected', exact: true })
		).toBeVisible();
		expect(
			(await (await page.request.get(`/api/staff/reports/${id}`)).json()).incident.status
		).toBe('In progress');
	} finally {
		await owner.dispose();
		await scanner.dispose();
	}
});
