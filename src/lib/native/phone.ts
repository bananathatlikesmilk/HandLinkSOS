import { Capacitor, registerPlugin } from '@capacitor/core';

const phone = registerPlugin<{ openDialer(): Promise<void> }>('HandLinkPhone');
export const PHONE_DIALER_HREF = 'tel:911';
export const nativeDialerAvailable = () => Capacitor.getPlatform() === 'android';
export const dialerHandoffKey = (accountId: string, incidentId: string) =>
	`handlink:sos:dialer:${accountId}:${incidentId}`;

export async function openPhoneDialer(): Promise<void> {
	if (nativeDialerAvailable()) {
		await phone.openDialer();
		return;
	}
	// Browsers may require a fresh user gesture; the call page also keeps a manual link.
	const link = document.createElement('a');
	link.href = PHONE_DIALER_HREF;
	link.click();
}
