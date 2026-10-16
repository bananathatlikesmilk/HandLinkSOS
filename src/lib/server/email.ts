import nodemailer from 'nodemailer';
import * as privateEnv from '$app/env/private';

const settings = privateEnv;
const port = Number(settings.SMTP_PORT || 587);
export const emailConfigured = Boolean(
	settings.SMTP_HOST &&
	settings.SMTP_USER &&
	settings.SMTP_PASSWORD &&
	settings.SMTP_FROM &&
	Number.isInteger(port) &&
	port > 0 &&
	port <= 65535
);
const transport = emailConfigured
	? nodemailer.createTransport({
			host: settings.SMTP_HOST,
			port,
			secure: port === 465,
			requireTLS: true,
			auth: { user: settings.SMTP_USER!, pass: settings.SMTP_PASSWORD! },
			connectionTimeout: 10000,
			greetingTimeout: 10000,
			socketTimeout: 15000
		})
	: null;

export async function sendCode(email: string, otp: string, purpose: string) {
	if (!transport) throw new Error('Email delivery is not configured.');
	try {
		const result = await transport.sendMail({
			from: settings.SMTP_FROM,
			to: email,
			subject: 'Your HandLink verification code',
			text: `Your HandLink code is ${otp}. It expires in 5 minutes. Purpose: ${purpose}. Do not share this code. If you did not request it, ignore this email.`
		});
		if (!result.accepted.length) throw new Error('Delivery rejected.');
	} catch {
		throw new Error('Email delivery failed. Please try again later.');
	}
}
