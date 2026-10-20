type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function clearFieldValidation(event: Event) {
	const field = event.target;
	if (
		field instanceof HTMLInputElement ||
		field instanceof HTMLSelectElement ||
		field instanceof HTMLTextAreaElement
	) {
		field.setCustomValidity('');
		field.removeAttribute('aria-invalid');
	}
}

export function validateForm(form: HTMLFormElement) {
	const problems: string[] = [];
	let first: FormField | undefined;
	for (const field of form.querySelectorAll<FormField>('input, select, textarea')) {
		if (!field.willValidate) continue;
		field.setCustomValidity('');
		if (field.required && !field.value.trim()) field.setCustomValidity('This field is required.');
		const validity = field.validity;
		if (validity.valid) {
			field.removeAttribute('aria-invalid');
			continue;
		}
		field.setAttribute('aria-invalid', 'true');
		first ??= field;
		const label =
			field.getAttribute('aria-label') ||
			field.labels?.[0]?.textContent?.replaceAll('*', '').replace(/\s+/g, ' ').trim() ||
			'Field';
		const contact = field.closest('.contact-fields')?.getAttribute('aria-label');
		const name = `${contact ? `${contact} - ` : ''}${label}`;
		let message = 'Check this value.';
		if (validity.valueMissing || validity.customError) message = 'This field is required.';
		else if (field instanceof HTMLInputElement && field.type === 'tel')
			message = 'Use 11 digits starting with 09, such as 09171234567.';
		else if (field instanceof HTMLInputElement && field.type === 'email')
			message = 'Enter a valid email, such as name@example.com.';
		else if (validity.rangeOverflow && field instanceof HTMLInputElement && field.type === 'date')
			message =
				field.getAttribute('aria-label') === 'Birthday'
					? 'Must be at least 2 years old. Choose an earlier birthday.'
					: `Choose a date on or before ${field.max}.`;
		else if (validity.tooShort)
			message = `Use at least ${(field as HTMLInputElement).minLength} characters.`;
		else if (validity.tooLong)
			message = `Use at most ${(field as HTMLInputElement).maxLength} characters.`;
		else if (validity.badInput) message = 'Enter a valid number or date.';
		problems.push(`${name}: ${message}`);
	}
	first?.focus();
	return problems.slice(0, 8).join('\n');
}
