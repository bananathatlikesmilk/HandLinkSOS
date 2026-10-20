import { expect, test } from '@playwright/test';
import { headers, login, origin, privateMedical, provision, sos } from './incident-fixture';
import { addNotes, ageRequest, generation, provider, providerState } from './ai-fixture';

test('Admin selects Gemini; cloud consent, audits, failures and provider changes preserve reports', async ({
	page,
	request,
	playwright
}) => {
	test.setTimeout(150000);
	const admin = await provision('admin');
	const staff = await playwright.request.newContext({ baseURL: origin });
	const dispatcher = await provision('dispatcher');
	const endpoint = '/api/admin/ai-settings';
	expect((await request.get(endpoint)).status()).toBe(401);
	await login(request, await provision());
	expect((await request.get(endpoint)).status()).toBe(403);
	await login(staff, dispatcher);
	expect((await staff.get(endpoint)).status()).toBe(403);
	expect((await staff.put(endpoint, { headers, data: { provider: 'gemini' } })).status()).toBe(403);
	await login(page.request, admin, false);
	expect((await page.request.get(endpoint)).status()).toBe(403);
	await login(page.request, admin);
	try {
		expect((await page.request.put(endpoint, { data: { provider: 'gemini' } })).status()).toBe(403);
		expect(
			(
				await page.request.put(endpoint, {
					headers,
					data: { provider: 'gemini', apiKey: 'must-not-be-accepted' }
				})
			).status()
		).toBe(422);
		await page.goto('/admin/ai');
		await expect(page.getByRole('heading', { name: 'AI settings', exact: true })).toBeVisible();
		await page.getByLabel('AI provider', { exact: true }).selectOption('gemini');
		await expect(page.getByText(/Gemini sends dispatcher-approved notes to Google/)).toBeVisible();
		await page.getByRole('button', { name: 'Save AI provider', exact: true }).click();
		await expect(page.getByRole('status')).toContainText('AI provider saved');
		await page.reload();
		await expect(page.getByLabel('AI provider', { exact: true })).toHaveValue('gemini');
		await expect(page.locator('body')).not.toContainText('isolated-gemini-key-not-real');
		const settingsResponse = await page.request.get(endpoint);
		expect(settingsResponse.headers()['cache-control']).toBe('no-store');
		expect(await settingsResponse.text()).not.toContain('isolated-gemini-key-not-real');
		const caller = await provision();
		await login(request, caller);
		const created = await request.post('/api/incidents', { headers, data: sos(caller.profileId) });
		const id = (await created.json()).incident.id;
		expect(
			(
				await staff.post(`/api/staff/incidents/${id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(200);
		await addNotes(staff, id, 'Casey Reyes reports chest pain. Dispatch assistance requested.');
		const base = `/api/staff/reports/${id}/summary`;
		const source = await (await staff.get(base + '/preview')).json();
		expect(source.provider).toBe('gemini');
		expect(source.warnings.join(' ')).toContain('external cloud service');
		const input = {
			...generation(source),
			provider: source.provider,
			providerRevision: source.providerRevision
		};
		provider();
		expect((await staff.post(base, { headers, data: generation(source) })).status()).toBe(409);
		expect(
			(await staff.post(base, { headers, data: { ...input, provider: 'ollama' } })).status()
		).toBe(409);
		expect(
			(await staff.post(base, { headers, data: { ...input, confirmed: false } })).status()
		).toBe(422);
		expect(providerState().calls).toBe(0);
		const result = await staff.post(base, { headers, data: input });
		expect(result.status(), await result.text()).toBe(200);
		expect((await result.json()).summary.model).toBe('gemini:gemini-3.5-flash-lite');
		const sent = providerState();
		expect(sent.calls).toBe(1);
		for (const secret of [
			'Casey',
			'Reyes',
			caller.email,
			privateMedical,
			'63917',
			'120.9842',
			'isolated-gemini-key-not-real'
		])
			expect(sent.last_payload).not.toContain(secret);
		expect(JSON.parse(sent.last_payload!).contents).toHaveLength(1);
		expect((await staff.post(base, { headers, data: input })).status()).toBe(200);
		expect(providerState().calls).toBe(1);
		expect(
			(
				await staff.post(base + '/review', {
					headers,
					data: { requestId: input.requestId, confirmed: true }
				})
			).status()
		).toBe(200);
		const saved = (await (await staff.get(`/api/staff/reports/${id}`)).json()).ai.summary;
		let lastId = input.requestId;
		for (const mode of [
			'failure',
			'quota',
			'bad-key',
			'malformed',
			'incomplete',
			'invalid-selection'
		]) {
			ageRequest(lastId, 3600001);
			provider(mode);
			const attempt = { ...input, requestId: crypto.randomUUID() };
			const failed = await staff.post(base, { headers, data: attempt });
			expect([502, 503]).toContain(failed.status());
			expect((await (await staff.get(`/api/staff/reports/${id}`)).json()).ai.summary).toEqual(
				saved
			);
			expect(providerState().calls).toBe(1);
			lastId = attempt.requestId;
		}
		ageRequest(lastId, 3600001);
		provider('success', 1000);
		const pending = staff.post(base, {
			headers,
			data: { ...input, requestId: crypto.randomUUID() }
		});
		await expect.poll(() => providerState().calls).toBe(1);
		expect(
			(await page.request.put(endpoint, { headers, data: { provider: 'ollama' } })).status()
		).toBe(200);
		expect((await pending).status()).toBe(409);
		expect((await (await staff.get(`/api/staff/reports/${id}`)).json()).ai.summary).toEqual(saved);
		await page.request.put(endpoint, { headers, data: { provider: 'gemini' } });
		provider();
		expect(
			(
				await staff.post(base, { headers, data: { ...input, requestId: crypto.randomUUID() } })
			).status()
		).toBe(409);
		expect(providerState().calls).toBe(0);
	} finally {
		await page.request
			.put(endpoint, { headers, data: { provider: 'ollama' }, timeout: 10000 })
			.catch(() => {});
		await staff.dispose();
	}
});

test('Dispatcher sees Gemini cloud notice and must consent before generation', async ({
	page,
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const admin = await playwright.request.newContext({ baseURL: origin });
	await login(admin, await provision('admin'));
	await login(page.request, await provision('dispatcher'));
	const caller = await provision();
	await login(request, caller);
	try {
		await admin.put('/api/admin/ai-settings', { headers, data: { provider: 'gemini' } });
		const created = await request.post('/api/incidents', { headers, data: sos(caller.profileId) });
		const id = (await created.json()).incident.id;
		await page.request.post(`/api/staff/incidents/${id}/confirm`, {
			headers,
			data: { verballyConfirmed: true }
		});
		await addNotes(page.request, id);
		provider();
		await page.goto('/dispatch/reports');
		const panel = page.getByRole('region', { name: 'AI report summary', exact: true });
		await expect(panel).toContainText('external cloud AI service');
		await panel.getByRole('button', { name: 'Prepare notes for AI', exact: true }).click();
		const generate = panel.getByRole('button', { name: 'Generate AI draft', exact: true });
		await expect(generate).toBeDisabled();
		await panel.getByRole('checkbox', { name: /agree to send it to Google Gemini/ }).check();
		await generate.click();
		await expect(panel.getByText('AI-generated draft', { exact: true })).toBeVisible();
		expect(providerState().calls).toBe(1);
		await expect(panel).toContainText('gemini:gemini-3.5-flash-lite');
	} finally {
		await admin.put('/api/admin/ai-settings', { headers, data: { provider: 'ollama' } });
		await admin.dispose();
	}
});
