import { Capacitor, registerPlugin } from '@capacitor/core';

const phone = registerPlugin<{ openDialer(): Promise<void> }>('HandLinkPhone');
export const PHONE_DIALER_HREF = 'tel:';
export const nativeDialerAvailable = () => Capacitor.getPlatform() === 'android';
export const dialerHandoffKey = (accountId: string, incidentId: string) =>
	`handlink:sos:dialer:${accountId}:${incidentId}`;

export async function openPhoneDialer(): Promise<void> {
	if (!nativeDialerAvailable()) throw new Error('Use the phone dialer link on this device.');
	await phone.openDialer();
}
