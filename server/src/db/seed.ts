import { insert, run, tx } from './db.js';
import { addDays, localDay, nowIso, startOfDay } from '../lib/time.js';
import { upsertPerson } from '../domain.js';
import { passToken } from '../lib/crypto.js';
import { config } from '../config.js';

/** Instant for a society-local day offset and HH:MM. */
const at = (offset: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(startOfDay(addDays(localDay(), -offset)).getTime() + (h * 60 + m) * 60e3);
};

/** Demo society matching the design prototype. */
export async function seed() {
  await tx(async () => {
    await run(`INSERT INTO society (id, name, gate_phone, supervisor_name, supervisor_phone, otp_required, auto_share_pass, pass_validity, updated_at)
         VALUES (1, 'Palm Grove Residency', '9800012345', 'Ramesh Patil', '9800012346', 0, 1, '24 hours', ?)`, nowIso());

    const P = async (name: string, mobile: string) => (await upsertPerson(name, mobile)).id;
    const admin = await P('Kavita Desai', '9800000001');
    const gate = await P('Gate desk', '9800012345');
    const sup = await P('Ramesh Patil', '9800012346');
    await run("INSERT INTO staff (person_id, role) VALUES (?, 'admin'), (?, 'security'), (?, 'security')", admin, gate, sup);

    const ananya = await P('Ananya Rao', '9811100001');
    const units: [string, string, number, number | null, number][] = [
      ['A-101', 'Flat', await P('Suresh Menon', '9811100011'), null, 0],
      ['A-304', 'Flat', await P('Farah Khan', '9811100012'), await P('Arjun Das', '9811100013'), 1],
      ['B-402', 'Flat', ananya, null, 0],
      ['C-110', 'Flat', ananya, await P('Vikas Iyer', '9811100002'), 1],
      ['C-203', 'Flat', await P('Meera Pillai', '9811100014'), null, 0],
      ['OFF-12', 'Office', await P('Lexicon Legal LLP', '9811100015'), null, 0],
    ];
    for (const [id, type, owner, tenant, divert] of units)
      await run('INSERT INTO units (id, type, owner_id, tenant_id, divert_to_tenant) VALUES (?, ?, ?, ?, ?)', id, type, owner, tenant, divert);

    const events: [number, string, string, string, string, string][] = [
      [0, '09:20', 'A-101', 'Suresh Kumar', 'exit', ''], [0, '10:15', 'B-402', 'Priya Nair', 'entry', 'Pass · Guest'],
      [0, '09:05', 'B-402', 'Rahul Mehta', 'pass', 'Guest · Today'], [0, '08:42', 'A-101', 'Suresh Kumar', 'entry', 'Walk-in · Delivery'],
      [1, '18:30', 'B-402', 'Imran (Zomato)', 'entry', 'Walk-in · Delivery'], [1, '18:28', 'B-402', 'Imran (Zomato)', 'approved', ''],
      [2, '11:10', 'C-203', 'Meena (Urban Co.)', 'entry', 'Walk-in · Service'], [3, '20:05', 'B-402', 'Karan Shah', 'denied', ''],
      [5, '17:15', 'B-402', 'Neha Joshi', 'entry', 'Pass · Guest'], [5, '16:40', 'B-402', 'Neha Joshi', 'pass', 'Guest · Today'],
      [8, '09:30', 'A-304', 'Vikram (Ola)', 'entry', 'Walk-in · Cab'], [12, '19:45', 'B-402', 'Rahul Mehta', 'exit', ''],
      [12, '14:00', 'B-402', 'Rahul Mehta', 'entry', 'Pass · Guest'], [18, '10:00', 'C-110', 'Ravi (Amazon)', 'entry', 'Walk-in · Delivery'],
      [25, '15:22', 'B-402', 'Ganesh (Plumber)', 'entry', 'Walk-in · Service'], [25, '15:20', 'B-402', 'Ganesh (Plumber)', 'approved', ''],
      [40, '12:00', 'B-402', 'Priya Nair', 'pass', 'Guest'],
    ];
    await run(
      `INSERT INTO events (day, at, unit_id, name, kind, detail) VALUES ${events.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
      ...events.flatMap(([o, t, unit, name, kind, detail]) => { const d = at(o, t); return [localDay(d), d.toISOString(), unit, name, kind, detail]; }),
    );

    const today = localDay();
    await run(`INSERT INTO visits (name, mobile, unit_id, purpose, status, via, day, created_at, entered_at, exited_at, logged_by)
         VALUES ('Suresh Kumar', '9876500011', 'A-101', 'Delivery', 'exited', 'Walk-in', ?, ?, ?, ?, ?)`, today, at(0, '08:42').toISOString(), at(0, '08:44').toISOString(), at(0, '09:20').toISOString(), gate);
    await run(`INSERT INTO visits (name, mobile, unit_id, purpose, status, via, day, created_at, entered_at, logged_by)
         VALUES ('Priya Nair', '9876500022', 'B-402', 'Guest', 'inside', 'Pass', ?, ?, ?, ?)`, today, at(0, '10:15').toISOString(), at(0, '10:15').toISOString(), gate);

    const from = at(0, '09:05');
    const passId = await insert(`INSERT INTO passes (code, name, mobile, unit_id, purpose, validity, valid_from, valid_until, sent, created_by, created_at)
         VALUES ('482913', 'Rahul Mehta', '9820011223', 'B-402', 'Guest', '24 hours', ?, ?, 1, ?, ?)`, from.toISOString(), new Date(from.getTime() + 864e5).toISOString(), ananya, from.toISOString());
    await run(`INSERT INTO sms_outbox (to_mobile, body, link, status, created_at) VALUES ('9820011223', 'Palm Grove Residency: B-402 has invited you (today). Entry code 482913. Open your pass:', ?, 'sent', ?)`,
      `${config.publicUrl}/p/${passToken(passId)}`, from.toISOString());

    // One walk-in waiting at the gate so the member and security screens have something live.
    const waiting = new Date(Date.now() - 2 * 60e3);
    await run(`INSERT INTO visits (name, mobile, unit_id, purpose, status, via, day, created_at, logged_by)
         VALUES ('Imran Shaikh', '9876500033', 'B-402', 'Delivery', 'pending', 'Walk-in', ?, ?, ?)`, localDay(waiting), waiting.toISOString(), gate);
    await run('INSERT INTO events (day, at, unit_id, name, kind, detail) VALUES (?, ?, ?, ?, ?, ?)', localDay(waiting), waiting.toISOString(), 'B-402', 'Imran Shaikh', 'request', 'Walk-in · Delivery');
  });
}
