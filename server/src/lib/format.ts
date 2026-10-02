export const fmtMobile = (m: string) => (m && m.length === 10 ? `+91 ${m.slice(0, 5)} ${m.slice(5)}` : m);
export const firstName = (n: string) => n.split(/\s+/)[0];

export const PURPOSES = ['Guest', 'Delivery', 'Cab', 'Service', 'Other'] as const;
export const ALERT_TYPES = ['Medical emergency', 'Suspicious person', 'Need help at home', 'Fire or smoke', 'Lift stuck', 'Other'] as const;
