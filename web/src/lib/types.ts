export type Role = 'admin' | 'security' | 'member';
export type Brand = { name: string; logo: string | null; initials: string };
export type User = { id: number; name: string; mobile: string; roles: Role[]; units: string[] };
export type Society = Brand & {
  gatePhone: string; supervisorName: string; supervisorPhone: string;
  otpRequired: boolean; autoSharePass: boolean; passValidity: '4 hours' | '24 hours' | '3 days';
};

export type VisitStatus = 'pending' | 'approved' | 'denied' | 'inside' | 'exited';
export type Visit = {
  id: number; name: string; mobile: string; unitId: string; purpose: string; status: VisitStatus; via: 'Walk-in' | 'Pass';
  day: string; time: string; enteredAt: string | null; exitedAt: string | null; photoUrl: string | null;
};
export type PassState = 'valid' | 'used' | 'expired' | 'upcoming' | 'revoked';
export type Pass = {
  id: number; code: string; name: string; mobile: string; unitId: string; purpose: string;
  validLabel: string; validUntil: string; reusable: boolean; sent: boolean; state: PassState; usedAt: string | null; revokedAt: string | null; token: string; url: string;
};
export type Recipient = { name: string; role: 'Owner' | 'Tenant'; phone: string };
export type GateAlert = { id: number; type: string; note: string; unitId: string; status: 'new' | 'ack'; time: string; name: string; mobile: string };
export type MyAlert = { id: number; type: string; unitId: string; status: 'new' | 'ack'; time: string };
export type PersonRef = { name: string; mobile: string };
export type MyUnit = {
  id: string; type: string; isOwner: boolean;
  owner: PersonRef & { isMe: boolean }; tenant: (PersonRef & { isMe: boolean }) | null;
  divertToTenant: boolean; ccOwner: boolean; goesTo: string;
  pendingAdd: (PersonRef & { id: number }) | null; pendingRemove: (PersonRef & { id: number }) | null;
};
export type AdminUnit = { id: string; type: string; owner: PersonRef; tenant: PersonRef | null; divertToTenant: boolean; ccOwner: boolean; goesTo: string };
export type TenantRequest = { id: number; unitId: string; kind: 'add' | 'remove'; name: string; mobile: string; requestedBy: string; time: string };
export type EventKind = 'request' | 'approved' | 'denied' | 'entry' | 'exit' | 'pass' | 'extend' | 'tenant' | 'profile' | 'alert' | 'revoke';
export type ActivityItem = {
  id: number; day: string; time: string; unitId: string; name: string; kind: EventKind; detail: string;
  // Admin-only audit record
  stamp?: string; actor?: { name: string; mobile: string | null; role: string | null } | null;
  fields?: [string, string][]; changes?: { field: string; from: string; to: string }[];
};
export type Notification = { id: number; text: string; link: string | null; read: boolean; day: string; time: string };

export const PURPOSES = ['Guest', 'Delivery', 'Cab', 'Service', 'Other'] as const;
export const ALERT_TYPES = ['Medical emergency', 'Suspicious person', 'Need help at home', 'Fire or smoke', 'Lift stuck', 'Other'] as const;
