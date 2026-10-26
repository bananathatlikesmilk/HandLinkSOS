const matchingRelationships: Readonly<Record<string, string>> = {
	Parent: 'Child',
	Child: 'Parent',
	Sibling: 'Sibling',
	'Spouse/Partner': 'Spouse/Partner',
	Grandparent: 'Grandchild',
	Grandchild: 'Grandparent',
	Relative: 'Relative',
	Friend: 'Friend',
	Caregiver: 'Care recipient',
	'Care recipient': 'Caregiver',
	Teacher: 'Student',
	Student: 'Teacher',
	Other: 'Other'
};

export const relationshipOptions = Object.keys(matchingRelationships);

export function matchingRelationship(relationship: string): string {
	return Object.hasOwn(matchingRelationships, relationship)
		? matchingRelationships[relationship]
		: relationship;
}
