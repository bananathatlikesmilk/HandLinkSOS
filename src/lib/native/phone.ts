import { Capacitor, registerPlugin } from '@capacitor/core';

const phone = registerPlugin<{ openDialer(): Promise<void> }>('HandLinkPhone');
// Request Android's dial screen explicitly; generic tel links can invoke a calling handler.
export const PHONE_DIALER_HREF =
	'intent:911#Intent;scheme=tel;action=android.intent.action.DIAL;end';
export const nativeDialerAvailable = () => Capacitor.getPlatform() === 'android';
export const dialerHandoffKey = (accountId: string, incidentId: string) =>
	`handlink:sos:dialer:${accountId}:${incidentId}`;

export async function openPhoneDialer(): Promise<void> {
	if (!nativeDialerAvailable()) throw new Error('Open your Phone app manually on this device.');
	await phone.openDialer();
}
