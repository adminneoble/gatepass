export const fmtMobile = (m?: string | null) => (m && m.length === 10 ? `+91 ${m.slice(0, 5)} ${m.slice(5)}` : m ?? '');
export const tel = (m: string) => 'tel:+91' + m;
export const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
export const firstName = (n: string) => n.split(/\s+/)[0];
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Local YYYY-MM-DD for the browser (society and device share a timezone in practice; server is authoritative). */
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number); return isoDay(new Date(y, m - 1, d + n)); };
export const dayLabel = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
