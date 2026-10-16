import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { user, account } from '../src/lib/server/db/schema.ts';

const adminInput = z.strictObject({
	name: z.string().trim().min(1).max(100),
	email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
	password: z.string().min(12).max(128)
});

// Local provisioning only. Email ownership must still be verified through the app.
export async function createAdmin(db, input) {
	const values = adminInput.parse(input);
	const password = await hashPassword(values.password);
	return db.transaction(
		(tx) => {
			if (
				tx
					.select({ id: user.id })
					.from(user)
					.where(sql`lower(${user.email}) = ${values.email}`)
					.get()
			) {
				throw new Error('This email already has an account. No account was changed.');
			}
			const id = randomUUID();
			const now = new Date();
			tx.insert(user)
				.values({
					id,
					name: values.name,
					email: values.email,
					role: 'admin',
					emailVerified: false,
					createdAt: now,
					updatedAt: now
				})
				.run();
			tx.insert(account)
				.values({
					id: randomUUID(),
					accountId: id,
					providerId: 'credential',
					userId: id,
					password,
					createdAt: now,
					updatedAt: now
				})
				.run();
			return { id, email: values.email };
		},
		{ behavior: 'immediate' }
	);
}

async function main() {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error('Run pnpm admin:create in your terminal. Password input must be private.');
	}
	if (fs.existsSync('.env')) process.loadEnvFile('.env');
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
	const client = new Database(path.resolve(process.env.DATABASE_URL), { fileMustExist: true });
	client.pragma('foreign_keys = ON');
	client.pragma('busy_timeout = 5000');
	let hidden = false;
	const output = new Writable({
		write(chunk, encoding, callback) {
			if (!hidden) process.stdout.write(chunk, encoding);
			callback();
		}
	});
	const prompt = createInterface({ input: process.stdin, output, terminal: true });
	try {
		const name = await prompt.question('Admin name: ');
		const email = await prompt.question('Admin email: ');
		process.stdout.write('Password (12–128 characters; hidden): ');
		hidden = true;
		const password = await prompt.question('');
		process.stdout.write('\nConfirm password (hidden): ');
		const confirmation = await prompt.question('');
		hidden = false;
		process.stdout.write('\n');
		if (password !== confirmation)
			throw new Error('Passwords do not match. No account was created.');
		const created = await createAdmin(drizzle(client), { name, email, password });
		console.log('Admin account created. Email verification is still required.');
		console.log(
			`Open /user/verify?email=${encodeURIComponent(created.email)} in your app and click Resend code.`
		);
		console.log('Verify the emailed code, then sign in at /admin/login.');
	} finally {
		prompt.close();
		client.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(
			error instanceof z.ZodError
				? 'Enter a valid name, email, and password of 12–128 characters.'
				: error.message
		);
		process.exitCode = 1;
	});
}
