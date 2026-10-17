import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { z } from 'zod';
import { FIREBASE_SERVICE_ACCOUNT_FILE } from '$app/env/private';

function messaging() {
	const path = FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
	if (!path || !isAbsolute(path)) return null;
	try {
		const existing = getApps().find((app) => app.name === 'handlink-push');
		if (existing) return getMessaging(existing);
		const key = z
			.object({
				project_id: z.string().min(1),
				client_email: z.email(),
				private_key: z.string().min(1)
			})
			.parse(JSON.parse(readFileSync(path, 'utf8')));
		return getMessaging(
			initializeApp(
				{
					credential: cert({
						projectId: key.project_id,
						clientEmail: key.client_email,
						privateKey: key.private_key
					})
				},
				'handlink-push'
			)
		);
	} catch {
		return null;
	}
}

export const firebasePushConfigured = () => messaging() !== null;
export async function sendFirebasePush(message: Message) {
	const client = messaging();
	if (!client) throw new Error('Firebase server delivery is not configured.');
	return client.send(message);
}
