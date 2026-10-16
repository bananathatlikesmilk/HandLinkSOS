export type IncidentStatus = 'Not assigned' | 'In progress' | 'On route' | 'Resolved';
export type Incident = {
	id: string;
	name: string;
	firstName: string;
	lastName: string;
	callerName: string;
	callerPhone: string;
	callerRelation: string;
	latitude: number;
	longitude: number;
	startedAt: number;
	endedAt: number | null;
	summary: string;
	initials: string;
	age: number;
	sex: string;
	phone: string;
	location: string;
	time: string;
	priority: 'Urgent' | 'High' | 'Normal';
	status: IncidentStatus;
	dispatcher: string;
	bloodType: string;
	condition: string;
	allergies: string;
	medication: string;
	contact: string;
	relation: string;
	notes: string;
};

export const sampleIncidents: Incident[] = [
	{
		id: 'HL-1048',
		name: 'Andrea Mendoza',
		firstName: 'Andrea',
		lastName: 'Mendoza',
		callerName: 'Andrea Mendoza',
		callerPhone: '+63 917 555 0148',
		callerRelation: '',
		latitude: 14.676,
		longitude: 121.0437,
		startedAt: Date.UTC(2026, 9, 13, 2, 42),
		endedAt: null,
		summary: '',
		initials: 'AM',
		age: 28,
		sex: 'Female',
		phone: '+63 917 555 0148',
		location: 'Commonwealth Ave, Quezon City',
		time: '10:42 AM',
		priority: 'Urgent',
		status: 'Not assigned',
		dispatcher: 'Unassigned',
		bloodType: 'O+',
		condition: 'Asthma',
		allergies: 'Penicillin',
		medication: 'Salbutamol inhaler',
		contact: 'Luis Mendoza',
		relation: 'Brother',
		notes: 'Silent SOS activated. Sample incident awaiting confirmation.'
	},
	{
		id: 'HL-1047',
		name: 'Miguel Santos',
		firstName: 'Miguel',
		lastName: 'Santos',
		callerName: 'Miguel Santos',
		callerPhone: '+63 918 555 0147',
		callerRelation: '',
		latitude: 14.676,
		longitude: 121.0437,
		startedAt: Date.UTC(2026, 9, 13, 2, 38),
		endedAt: null,
		summary: '',
		initials: 'MS',
		age: 35,
		sex: 'Male',
		phone: '+63 918 555 0147',
		location: 'Katipunan Ave, Quezon City',
		time: '10:38 AM',
		priority: 'High',
		status: 'In progress',
		dispatcher: 'Jamie Reyes',
		bloodType: 'A+',
		condition: 'No conditions recorded',
		allergies: 'No known allergies',
		medication: 'None recorded',
		contact: 'Maria Santos',
		relation: 'Spouse',
		notes: 'Caller location reviewed. Awaiting response team dispatch.'
	},
	{
		id: 'HL-1046',
		name: 'Elena Garcia',
		firstName: 'Elena',
		lastName: 'Garcia',
		callerName: 'Sofia Garcia',
		callerPhone: '+63 917 555 0199',
		callerRelation: 'Daughter',
		latitude: 14.676,
		longitude: 121.0437,
		startedAt: Date.UTC(2026, 9, 13, 2, 31),
		endedAt: null,
		summary: '',
		initials: 'EG',
		age: 62,
		sex: 'Female',
		phone: '+63 919 555 0146',
		location: 'Diliman, Quezon City',
		time: '10:31 AM',
		priority: 'High',
		status: 'On route',
		dispatcher: 'Paolo Lim',
		bloodType: 'B+',
		condition: 'Type 2 diabetes',
		allergies: 'No known allergies',
		medication: 'Metformin',
		contact: 'Sofia Garcia',
		relation: 'Daughter',
		notes: 'Sample response team is on route. Contact details reviewed.'
	},
	{
		id: 'HL-1045',
		name: 'Rafael Cruz',
		firstName: 'Rafael',
		lastName: 'Cruz',
		callerName: 'Rafael Cruz',
		callerPhone: '+63 916 555 0145',
		callerRelation: '',
		latitude: 14.676,
		longitude: 121.0437,
		startedAt: Date.UTC(2026, 9, 13, 2, 24),
		endedAt: null,
		summary: '',
		initials: 'RC',
		age: 24,
		sex: 'Male',
		phone: '+63 916 555 0145',
		location: 'Cubao, Quezon City',
		time: '10:24 AM',
		priority: 'Normal',
		status: 'Not assigned',
		dispatcher: 'Unassigned',
		bloodType: 'AB+',
		condition: 'None recorded',
		allergies: 'None recorded',
		medication: 'None recorded',
		contact: 'Carmen Cruz',
		relation: 'Mother',
		notes: 'Sample SOS received. No additional information yet.'
	},
	{
		id: 'HL-1044',
		name: 'Isabel Ramos',
		firstName: 'Isabel',
		lastName: 'Ramos',
		callerName: 'Isabel Ramos',
		callerPhone: '+63 915 555 0144',
		callerRelation: '',
		latitude: 14.676,
		longitude: 121.0437,
		startedAt: Date.UTC(2026, 9, 13, 1, 56),
		endedAt: Date.UTC(2026, 9, 13, 3, 18),
		summary: '',
		initials: 'IR',
		age: 31,
		sex: 'Female',
		phone: '+63 915 555 0144',
		location: 'Eastwood, Quezon City',
		time: '9:56 AM',
		priority: 'Normal',
		status: 'Resolved',
		dispatcher: 'Jamie Reyes',
		bloodType: 'O-',
		condition: 'None recorded',
		allergies: 'None recorded',
		medication: 'None recorded',
		contact: 'David Ramos',
		relation: 'Partner',
		notes: 'Sample incident closed. Person confirmed safe.'
	}
];
