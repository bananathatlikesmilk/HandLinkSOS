import { Capacitor, registerPlugin } from '@capacitor/core';

import { DEFAULT_SOS_PHONE, SOS_PHONE_PATTERN, phoneDialerHref } from '../emergency-phone.ts';

const phone = registerPlugin<{
	openDialer(): Promise<void>;
	openDialerWithNumber(options: { number: string }): Promise<void>;
}>('HandLinkPhone');
// Request Android's dial screen explicitly; generic tel links can invoke a calling handler.
export const PHONE_DIALER_HREF = phoneDialerHref(DEFAULT_SOS_PHONE);
export const nativeDialerAvailable = () => Capacitor.getPlatform() === 'android';
export const dialerHandoffKey = (accountId: string, incidentId: string) =>
	`handlink:sos:dialer:${accountId}:${incidentId}`;

export async function openPhoneDialer(number = DEFAULT_SOS_PHONE): Promise<void> {
	if (!nativeDialerAvailable()) throw new Error('Open your Phone app manually on this device.');
	if (!SOS_PHONE_PATTERN.test(number)) throw new Error('Invalid SOS phone number.');
	// Old APKs support only the unchanged 911 method. Never let them silently ignore a custom number.
	if (number === DEFAULT_SOS_PHONE) await phone.openDialer();
	else await phone.openDialerWithNumber({ number });
}
