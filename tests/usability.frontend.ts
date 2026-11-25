import { expect, test, type Locator, type Page } from '@playwright/test';
import { database, headers, login, password, provision } from './incident-fixture';
import { enrollStaffMfa, totp } from './mfa-fixture';
import { latestEligibleBirthday } from '../src/lib/birthday';
import { origin } from './incident-fixture';
import { installNativeBridge, type NativeTestState } from './native-fixture';

async function submitLogin(page: Page) {
	for (let attempt = 0; ; attempt++) {
		const responsePromise = page.waitForResponse((response) =>
			response.url().endsWith('/api/auth/sign-in/email')
		);
		await page.getByRole('button', { name: 'Log In', exact: true }).click();
		const response = await responsePromise;
		if (response.status() !== 429 || attempt >= 2) break;
		const seconds = Number(response.headers()['retry-after']);
		await new Promise((resolve) =>
			setTimeout(resolve, (Number.isFinite(seconds) && seconds > 0 ? seconds : 10) * 1000 + 100)
		);
	}
}

for (const scenario of [
	{ role: 'admin', office: 'central', steps: 10 },
	{ role: 'admin', office: 'legacy', steps: 7 },
	{ role: 'dispatcher', office: 'provincial-intake', steps: 10 },
	{ role: 'dispatcher', office: 'legacy', steps: 10 }
] as const) {
	test(`${scenario.office} ${scenario.role} tutorial respects scope, persists and replays safely`, async ({
		page
	}) => {
		test.setTimeout(90000);
		const actor = await provision(scenario.role, false);
		if (scenario.office !== 'central') {
			const db = database();
			try {
				db.prepare('INSERT INTO staff_lgu (user_id,lgu_id) VALUES (?,?)').run(
					actor.id,
					scenario.office
				);
			} finally {
				db.close();
			}
		}
		await login(page.request, actor, false);
		expect((await page.request.get('/api/account/tutorial')).status()).toBe(403);
		expect((await page.request.post('/api/account/tutorial', { headers, data: {} })).status()).toBe(
			403
		);
		const home = scenario.role === 'admin' ? '/admin' : '/dispatch';
		await page.goto(home);
		await expect(page).toHaveURL(`${home}/security`);
		await expect(page.locator('dialog.guided-tutorial')).toHaveCount(0);
		await enrollStaffMfa(page.request, password);
		expect(await (await page.request.get('/api/account/tutorial')).json()).toEqual({ seen: false });
		let mutations = 0;
		page.on('request', (request) => {
			if (
				['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) &&
				!request.url().endsWith('/api/account/tutorial')
			)
				mutations++;
		});
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(home);
		const guide = page.locator('dialog.guided-tutorial');
		await expect(guide).toBeVisible();
		const title = scenario.role === 'admin' ? 'Welcome, Administrator' : 'Welcome, Dispatcher';
		await expect(guide.getByRole('heading', { name: title, exact: true })).toBeFocused();
		if (scenario.office === 'central') await expect(guide).toContainText('across LGUs');
		if (scenario.office === 'legacy') await expect(guide).toContainText('assigned LGU');
		const titles: string[] = [];
		for (let index = 0; index < scenario.steps; index++) {
			titles.push(await guide.locator('h2').innerText());
			if (index === 2) {
				await expect(guide.locator('.tutorial-highlight')).toBeVisible();
				await page.setViewportSize({ width: 390, height: 844 });
				await expect(guide.locator('.tutorial-highlight')).toBeVisible();
				if (scenario.role === 'admin') {
					await expect
						.poll(async () => {
							const menu = await page.locator('.mobile-menu').boundingBox();
							const highlight = await guide.locator('.tutorial-highlight').boundingBox();
							return (
								!!menu &&
								!!highlight &&
								Math.abs(highlight.y - menu.y) <= 6 &&
								Math.abs(highlight.width - menu.width - 10) <= 2
							);
						})
						.toBe(true);
				}
				for (const theme of ['light', 'dark']) {
					await page.evaluate(
						(value) => document.documentElement.setAttribute('data-appearance', value),
						theme
					);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
					).toBe(true);
					await page.screenshot({
						path: test.info().outputPath(`${scenario.office}-${scenario.role}-${theme}.png`),
						animations: 'disabled'
					});
				}
			}
			if (index < scenario.steps - 1)
				await guide.getByRole('button', { name: 'Next', exact: true }).click();
		}
		if (scenario.role === 'admin') {
			expect(titles.includes('LGUs and routing')).toBe(scenario.office === 'central');
			expect(titles.includes('Choose the AI provider')).toBe(scenario.office === 'central');
			expect(titles.includes('Set the SOS hotline')).toBe(scenario.office === 'central');
		} else expect(titles).toContain('Confirm response progress');
		const saved = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/account/tutorial') && response.request().method() === 'POST'
		);
		await guide.getByRole('button', { name: 'Finish tutorial', exact: true }).click();
		expect((await saved).status()).toBe(200);
		await expect(guide).not.toBeVisible();
		await page.reload();
		await expect(guide).not.toBeVisible();
		await page.goto(`${home}/profile`);
		await page.getByRole('link', { name: 'Replay tutorial', exact: true }).click();
		await expect(guide).toBeVisible();
		await expect(guide.getByRole('heading', { name: title, exact: true })).toBeVisible();
		await guide.getByRole('button', { name: 'Skip tutorial', exact: true }).click();
		await expect(guide).not.toBeVisible();
		await expect(page).toHaveURL(home);
		expect(mutations).toBe(0);
	});
}

test('first User login offers a safe tutorial and remembers it across devices', async ({
	page,
	browser
}) => {
	test.setTimeout(90000);
	const account = await provision('user', false);
	await installNativeBridge(page);
	await page.setViewportSize({ width: 390, height: 844 });
	let sosRequests = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('/api/incidents')) sosRequests++;
	});
	await page.goto('/login');
	await page.getByLabel('Email', { exact: true }).fill(account.email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await submitLogin(page);
	await expect(page.getByRole('dialog', { name: 'Important safety notice' })).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Welcome to HandLink' })).toHaveCount(0);
	await page.getByRole('button', { name: 'I understand. Continue', exact: true }).click();
	const guide = page.locator('dialog.guided-tutorial');
	await expect(guide).toBeVisible();
	await expect(guide.getByRole('heading', { name: 'Welcome to HandLink' })).toBeFocused();
	expect(await guide.evaluate((node) => node.matches(':modal'))).toBe(true);
	const initialPermissions = await page.evaluate(
		() =>
			(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
				.initialRequests
	);
	await guide.getByRole('button', { name: 'Next', exact: true }).click();
	await expect(guide.getByRole('heading', { name: 'SOS for me', exact: true })).toBeFocused();
	await expect(guide.locator('.tutorial-highlight')).toBeVisible();
	const target = await page.locator('.self-sos').boundingBox();
	await page.mouse.click(target!.x + target!.width / 2, target!.y + target!.height / 2);
	await expect(page).toHaveURL('/user/dashboard');
	for (const theme of ['light', 'dark']) {
		await page.evaluate(
			(value) => document.documentElement.setAttribute('data-appearance', value),
			theme
		);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.screenshot({
			path: test.info().outputPath(`user-tutorial-${theme}.png`),
			animations: 'disabled'
		});
	}
	await guide.getByRole('button', { name: 'Previous tutorial step', exact: true }).click();
	await expect(guide.getByRole('heading', { name: 'Welcome to HandLink' })).toBeVisible();
	for (const title of [
		'SOS for me',
		'Help someone else',
		'You press Call',
		'Manage your profiles',
		'Share your location',
		'Check your updates',
		'Settings and permissions',
		'Find your SOS history'
	]) {
		await guide.getByRole('button', { name: 'Next', exact: true }).click();
		await expect(guide.getByRole('heading', { name: title, exact: true })).toBeFocused();
		if (title === 'Manage your profiles') {
			await expect(guide.locator('.tutorial-highlight')).toBeVisible();
			await page.setViewportSize({ width: 320, height: 568 });
			const card = await guide.locator('.tutorial-card').boundingBox();
			expect(card!.x).toBeGreaterThanOrEqual(0);
			expect(card!.y + card!.height).toBeLessThanOrEqual(568);
			await page.setViewportSize({ width: 390, height: 844 });
		}
	}
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/account/tutorial') && response.request().method() === 'POST'
	);
	await guide.getByRole('button', { name: 'Finish tutorial', exact: true }).click();
	expect((await saved).status()).toBe(200);
	await expect(guide).not.toBeVisible();
	await expect(page.locator('.self-sos')).toBeEnabled();
	expect(sosRequests).toBe(0);
	const native = await page.evaluate(
		() => (globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
	);
	expect(native.dialerAttempts).toBe(0);
	expect(native.initialRequests).toBe(initialPermissions);
	await page.reload();
	await expect(guide).not.toBeVisible();
	const secondDevice = await browser.newContext({ baseURL: origin });
	try {
		await login(secondDevice.request, account);
		const secondPage = await secondDevice.newPage();
		await secondPage.goto('/user/dashboard');
		await expect(secondPage.locator('.self-sos')).toBeEnabled();
		await expect(secondPage.locator('dialog.guided-tutorial')).not.toBeVisible();
	} finally {
		await secondDevice.close();
	}
});

test('tutorial can be skipped during a save failure and replayed from Settings', async ({
	page
}) => {
	const account = await provision('user', false);
	await login(page.request, account);
	await page.route('**/api/account/tutorial', (route) =>
		route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({ message: 'Unavailable' })
		})
	);
	await page.goto('/user/dashboard');
	const guide = page.locator('dialog.guided-tutorial');
	await expect(guide).toBeVisible();
	await guide.getByRole('button', { name: 'Skip tutorial', exact: true }).click();
	await expect(guide).not.toBeVisible();
	await expect(
		page.getByText('Tutorial closed. Your preference could not be saved, so it may appear again.')
	).toBeVisible();
	await expect(page.locator('.self-sos')).toBeEnabled();
	await page.unroute('**/api/account/tutorial');
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/account/tutorial') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Retry saving tutorial preference' }).click();
	expect((await saved).status()).toBe(200);
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByRole('link', { name: 'Replay tutorial', exact: true }).click();
	await expect(guide).toBeVisible();
	await expect(guide.getByRole('heading', { name: 'Welcome to HandLink' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(guide).not.toBeVisible();
	await expect(page).toHaveURL('/user/dashboard');
	await page.reload();
	await expect(guide).not.toBeVisible();
});

test('tutorial preference requires the current User and rejects forged writes', async ({
	request,
	playwright
}) => {
	expect((await request.get('/api/account/tutorial')).status()).toBe(401);
	const first = await provision('user', false);
	await login(request, first);
	expect(await (await request.get('/api/account/tutorial')).json()).toEqual({ seen: false });
	expect((await request.post('/api/account/tutorial', { data: {} })).status()).toBe(403);
	expect(
		(
			await request.post('/api/account/tutorial', { headers, data: { userId: 'another-account' } })
		).status()
	).toBe(422);
	for (let attempt = 0; attempt < 2; attempt++)
		expect((await request.post('/api/account/tutorial', { headers, data: {} })).status()).toBe(200);
	const response = await request.get('/api/account/tutorial');
	expect(response.headers()['cache-control']).toContain('no-store');
	expect(await response.json()).toEqual({ seen: true });
	const other = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(other, await provision('user', false));
		expect(await (await other.get('/api/account/tutorial')).json()).toEqual({ seen: false });
		await login(other, await provision('dispatcher'), false);
		expect((await other.get('/api/account/tutorial')).status()).toBe(403);
		expect((await other.post('/api/account/tutorial', { headers, data: {} })).status()).toBe(403);
	} finally {
		await other.dispose();
	}
});

test('welcome and registration share the login animation and readable mobile light theme', async ({
	page
}) => {
	await page.addInitScript(() => localStorage.setItem('handlink:appearance', 'light'));
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/user');
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
	await expect(page.locator('.auth-shell')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Log In', exact: true })).toBeVisible();
	const pause = page.getByRole('button', { name: 'Pause background animation', exact: true });
	await pause.click();
	await expect(page.locator('.auth-shell')).toHaveClass(/background-paused/);
	await expect
		.poll(() =>
			page
				.locator('.auth-shell')
				.evaluate((element) => getComputedStyle(element, '::before').animationPlayState)
		)
		.toBe('paused');
	await page.screenshot({
		path: test.info().outputPath('welcome-light-mobile.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await page.getByRole('link', { name: 'Create Account', exact: true }).click();
	await expect(page).toHaveURL('/user/register');
	await expect(page.locator('.auth-shell')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Create Account', exact: true })).toBeVisible();
	await expectLightSurface(page.getByLabel('First name', { exact: true }));
	await expectLightSurface(page.getByLabel('Sex', { exact: true }));
	await expect(page.getByRole('button', { name: 'Switch to dark mode', exact: true })).toHaveCount(
		1
	);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({
		path: test.info().outputPath('register-light-mobile.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
	await page.screenshot({
		path: test.info().outputPath('register-dark-mobile.png'),
		fullPage: true,
		animations: 'disabled'
	});
});

async function expectLightSurface(locator: Locator) {
	await expect(locator.page().locator('html')).toHaveAttribute('data-appearance', 'light');
	await expect(locator).toBeVisible();
	const colors = await locator.evaluate((element) => {
		const style = getComputedStyle(element);
		return { background: style.backgroundColor, foreground: style.color };
	});
	const rgb = (value: string) =>
		value
			.match(/[\d.]+/g)!
			.slice(0, 3)
			.map(Number);
	const luminance = (value: string) =>
		rgb(value)
			.map((channel) => {
				const normalized = channel / 255;
				return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
			})
			.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
	const background = luminance(colors.background);
	const foreground = luminance(colors.foreground);
	expect(background, JSON.stringify(colors)).toBeGreaterThan(0.7);
	expect((background + 0.05) / (foreground + 0.05), JSON.stringify(colors)).toBeGreaterThanOrEqual(
		4.5
	);
}

test('light login and User feature panels keep readable colors', async ({ page }) => {
	test.setTimeout(90000);
	await page.addInitScript(() => {
		localStorage.setItem('handlink:appearance', 'light');
		localStorage.setItem('handlink:initial-device-permissions:v1', 'attempted');
	});
	await page.goto('/login');
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
	await expectLightSurface(page.getByLabel('Email', { exact: true }));
	await expectLightSurface(page.getByLabel('Password', { exact: true }));
	await expect
		.poll(() =>
			page
				.locator('.auth-shell')
				.evaluate((element) => getComputedStyle(element, '::before').opacity)
		)
		.toBe('0.32');
	await page.screenshot({
		path: test.info().outputPath('login-light.png'),
		animations: 'disabled'
	});
	await login(page.request, await provision());
	await page.goto('/user/profiles');
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
	const avatar = page.locator('.profile-avatar').first();
	await expect(avatar).toHaveCSS('color', 'rgb(255, 255, 255)');
	await expect(avatar).toHaveCSS('background-color', 'rgb(20, 103, 86)');
	await page.locator('.qr-action').first().hover();
	await expectLightSurface(page.locator('.qr-action').first());
	await page.goto('/user/profiles/scan');
	await expectLightSurface(page.locator('.camera-frame'));
	await expect(page.locator('.camera-placeholder')).toHaveCSS('color', 'rgb(24, 45, 52)');
	await page.screenshot({
		path: test.info().outputPath('scanner-light.png'),
		animations: 'disabled'
	});
	await page.goto('/user/sharing');
	await expect(page.locator('.share-button')).toHaveCSS('color', 'rgb(20, 103, 86)');
});

test('light staff security uses readable inputs, messages and text', async ({ page }) => {
	test.setTimeout(90000);
	await page.addInitScript(() => localStorage.setItem('handlink:appearance', 'light'));
	await login(page.request, await provision('admin'));
	await page.goto('/admin/security');
	await expect(page.locator('.security')).toHaveCSS('color', 'rgb(24, 45, 52)');
	await expectLightSurface(page.getByLabel('Current password', { exact: true }).first());
	await expectLightSurface(page.locator('.security .message').first());
	await page.screenshot({
		path: test.info().outputPath('security-light.png'),
		animations: 'disabled'
	});
});

test('one login page routes Users and protects staff destinations with MFA', async ({ page }) => {
	test.setTimeout(120000);
	await page.addInitScript(() => {
		localStorage.setItem('handlink:initial-device-permissions:v1', 'attempted');
		localStorage.setItem('handlink:appearance', 'light');
	});
	const user = await provision();
	await page.goto('/user/login');
	await expect(page).toHaveURL('/login');
	await page.getByLabel('Email', { exact: true }).fill(user.email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Show password', exact: true }).click();
	await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
	await expect(page.getByRole('heading', { name: 'Important safety notice' })).toHaveCount(0);
	await submitLogin(page);
	const memo = page.getByRole('dialog', { name: 'Important safety notice' });
	await expect(memo).toBeVisible();
	await expect(memo).toContainText(
		'Send SOS only for real emergencies, including when helping someone else.'
	);
	await expect(memo).toContainText('No pranks, false reports, or test alerts.');
	await expect(memo).toContainText('Share accurate information and location.');
	await expect(memo).toContainText('False alerts can delay help for someone in danger.');
	expect(await memo.evaluate((node) => node.matches(':modal'))).toBe(true);
	await expect(page.getByRole('heading', { name: 'Important safety notice' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(memo).toBeVisible();
	await page.mouse.click(2, 2);
	await expect(memo).toBeVisible();
	await page.keyboard.press('Tab');
	await expect(
		memo.getByRole('button', { name: 'I understand. Continue', exact: true })
	).toBeFocused();
	await expect(page).toHaveURL('/login');
	await expectLightSurface(memo);
	await page.setViewportSize({ width: 390, height: 844 });
	for (const theme of ['light', 'dark']) {
		await page.evaluate(
			(value) => document.documentElement.setAttribute('data-appearance', value),
			theme
		);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.screenshot({
			path: test.info().outputPath(`emergency-memo-${theme}.png`),
			fullPage: true,
			animations: 'disabled'
		});
	}
	await page.setViewportSize({ width: 320, height: 568 });
	const bounds = await memo.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.y).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
	expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await expect(memo).toHaveCSS('animation-name', 'none');
	await page.getByRole('button', { name: 'I understand. Continue', exact: true }).click();
	await expect(page).toHaveURL('/user/dashboard');
	await page.request.post('/api/auth/sign-out', { headers, data: {} });
	for (const role of ['admin', 'dispatcher']) {
		const staff = await provision(role);
		await login(page.request, staff, false);
		await page.goto('/login');
		await expect(page).toHaveURL(role === 'admin' ? '/admin/security' : '/dispatch/security');
		const setup = await enrollStaffMfa(page.request, password);
		expect(setup).not.toBeNull();
		await page.request.post('/api/auth/sign-out', { headers, data: {} });
		await page.goto('/login');
		await page.getByLabel('Email', { exact: true }).fill(staff.email);
		await page.getByLabel('Password', { exact: true }).fill(password);
		// Preview shares one IP bucket across accounts. Honor the real limiter without disabling it.
		await submitLogin(page);
		await expect(page.getByLabel('Authenticator code', { exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Important safety notice' })).toHaveCount(0);
		await expect(page).toHaveURL('/login');
		await page.getByLabel('Authenticator code', { exact: true }).fill(totp(setup!.totpURI));
		await page.getByRole('button', { name: 'Verify code', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Important safety notice' })).toBeVisible();
		await expect(page).toHaveURL('/login');
		await page.getByRole('button', { name: 'I understand. Continue', exact: true }).click();
		await expect(page).toHaveURL(role === 'admin' ? '/admin' : '/dispatch');
		await page.request.post('/api/auth/sign-out', { headers, data: {} });
	}
});

test('registration blocks incomplete personal fields and limits local phone to 11 digits', async ({
	page
}) => {
	await page.goto('/user/register');
	await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('09');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('First name: This field is required.');
	await expect(page.getByLabel('First name', { exact: true })).toHaveAttribute(
		'aria-invalid',
		'true'
	);
	await expect(
		page.getByRole('group', { name: 'Personal information', exact: true })
	).toBeVisible();
	await page.getByLabel('First name', { exact: true }).fill('   ');
	await page.getByLabel('Last name', { exact: true }).fill('Reyes');
	await page.getByLabel('Birthday', { exact: true }).fill('2000-01-01');
	await page.getByLabel('Sex', { exact: true }).selectOption('Female');
	await page.getByLabel('Phone number', { exact: true }).fill('09987654321');
	await page.getByLabel('Phone number', { exact: true }).press('End');
	await page.getByLabel('Phone number', { exact: true }).pressSequentially('999');
	await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('09987654321');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(
		page.getByRole('group', { name: 'Personal information', exact: true })
	).toBeVisible();
	await page.getByLabel('First name', { exact: true }).fill('Casey');
	await expect(page.getByLabel('First name', { exact: true })).not.toHaveAttribute(
		'aria-invalid',
		'true'
	);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('group', { name: /Medical information/ })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('combobox', { name: 'Relationship', exact: true })).toBeVisible();
	await page.getByRole('combobox', { name: 'Relationship', exact: true }).selectOption('Friend');
	await expect(page.getByRole('combobox', { name: 'Relationship', exact: true })).toHaveValue(
		'Friend'
	);
});

test('registration rejects birthdays under age two and accepts the exact cutoff', async ({
	page
}) => {
	await page.goto('/user/register');
	const birthday = page.getByLabel('Birthday', { exact: true });
	await expect(birthday).toHaveAttribute('max', latestEligibleBirthday());
	await page.getByLabel('First name', { exact: true }).fill('Casey');
	await page.getByLabel('Last name', { exact: true }).fill('Reyes');
	await page.getByLabel('Sex', { exact: true }).selectOption('Female');
	await page.getByLabel('Phone number', { exact: true }).fill('09911223344');
	await birthday.fill(new Date().toISOString().slice(0, 10));
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Birthday: Must be at least 2 years old.');
	await expect(birthday).toHaveAttribute('aria-invalid', 'true');
	await birthday.fill(latestEligibleBirthday());
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('group', { name: /Medical information/ })).toBeVisible();
});

test('registration shows duplicate phone and email feedback before submission', async ({
	page
}) => {
	const owner = await provision();
	await page.goto('/user/register');
	await page.getByLabel('First name', { exact: true }).fill('Casey');
	await page.getByLabel('Last name', { exact: true }).fill('Reyes');
	await page.getByLabel('Birthday', { exact: true }).fill('2000-01-01');
	await page.getByLabel('Sex', { exact: true }).selectOption('Female');
	const phone = page.getByLabel('Phone number', { exact: true });
	await phone.fill('09171234567');
	await phone.press('Tab');
	await expect(page.getByRole('alert')).toHaveText(
		'This phone number is already registered. Use another number.'
	);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(
		page.getByRole('group', { name: 'Personal information', exact: true })
	).toBeVisible();
	await phone.fill('09976543210');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('group', { name: /Medical information/ })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	const email = page.getByLabel('Your email', { exact: true });
	await email.fill(owner.email.toUpperCase());
	await email.press('Tab');
	await expect(page.getByRole('alert')).toHaveText(
		'This email is already registered. Log in or use another email.'
	);
	await expect(page).toHaveURL('/user/register');
});

test('profile errors identify the rejected field, preserve edits, and explain network failures', async ({
	page
}) => {
	await login(page.request, await provision());
	await page.goto('/user/profiles/edit');
	const allergies = page.getByLabel('Allergies', { exact: true });
	await allergies.fill('Draft allergy note');
	await page.route('**/api/profile', (route) =>
		route.request().method() === 'PUT'
			? route.fulfill({
					status: 422,
					contentType: 'application/json',
					body: JSON.stringify({
						message: 'Emergency contact 1 - Email: Enter a valid email, such as name@example.com.'
					})
				})
			: route.continue()
	);
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText(
		'Emergency contact 1 - Email: Enter a valid email'
	);
	await expect(allergies).toHaveValue('Draft allergy note');
	await expect(page).toHaveURL('/user/profiles/edit');
	await page.unroute('**/api/profile');
	await page.route('**/api/profile', (route) =>
		route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue()
	);
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText(
		'Cannot reach the server. Check your internet connection'
	);
	await expect(allergies).toHaveValue('Draft allergy note');
});

test('User navigation stays visible and chosen theme persists across pages', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.addInitScript(() =>
		localStorage.setItem('handlink:initial-device-permissions:v1', 'attempted')
	);
	await login(page.request, await provision());
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/user/dashboard');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
	await expect(nav).toBeInViewport();
	const desired = page.getByRole('button', { name: 'Switch to light mode', exact: true });
	await desired.click();
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
	await page.screenshot({
		path: test.info().outputPath('user-dashboard-light.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await nav.getByRole('link', { name: 'Settings', exact: true }).click();
	await expect(page).toHaveURL('/user/settings');
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
	await page.reload();
	await expect(page).toHaveURL('/user/settings');
	await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
	await page.screenshot({
		path: test.info().outputPath('user-settings-light.png'),
		fullPage: true,
		animations: 'disabled'
	});
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
});

test('Admin dashboard shows real summary and usable mobile sidebar', async ({ page }) => {
	test.setTimeout(60000);
	await page.emulateMedia({ colorScheme: 'dark' });
	await login(page.request, await provision('admin'));
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/admin');
	await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
	await expect(page.getByRole('region', { name: 'System summary', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).not.toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({
		path: test.info().outputPath('admin-dashboard-mobile.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await page.setViewportSize({ width: 1440, height: 1000 });
	const light = page.getByRole('button', { name: 'Switch to light mode', exact: true });
	if (await light.count()) await light.click();
	await page.screenshot({
		path: test.info().outputPath('admin-dashboard-light.png'),
		fullPage: true,
		animations: 'disabled'
	});
});
