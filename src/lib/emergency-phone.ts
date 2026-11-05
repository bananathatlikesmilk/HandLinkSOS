export const DEFAULT_SOS_PHONE = '911';
// Digits with an optional leading + only. Exclude extensions, USSD and URI/intent syntax.
export const SOS_PHONE_PATTERN = /^\+?[0-9]{3,15}$/;

export function phoneDialerHref(number: string) {
	if (!SOS_PHONE_PATTERN.test(number)) throw new Error('Invalid SOS phone number.');
	return `intent:${number}#Intent;scheme=tel;action=android.intent.action.DIAL;end`;
}
