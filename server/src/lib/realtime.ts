import type { Response } from 'express';

/** Query groups the web client caches; a change event tells clients which to refetch. */
export type Topic = 'visits' | 'passes' | 'alerts' | 'units' | 'requests' | 'society' | 'events' | 'notifications' | 'me' | 'sms' | 'notices';

type Client = { res: Response; personId: number; roles: Set<string> };
const clients = new Set<Client>();

export function subscribe(res: Response, personId: number, roles: string[]) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const c: Client = { res, personId, roles: new Set(roles) };
  clients.add(c);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => { clearInterval(ping); clients.delete(c); });
}

const send = (c: Client, event: string, data: unknown) => c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** Tell every connected client which cached data changed. Payload carries no data, so it is safe to broadcast. */
export function invalidate(...topics: Topic[]) {
  for (const c of clients) send(c, 'invalidate', topics);
}

/** Ephemeral banner for specific people (members). */
export function pushToPeople(personIds: number[], payload: { text: string; tone?: 'info' | 'alert'; link?: string }) {
  const ids = new Set(personIds);
  for (const c of clients) if (ids.has(c.personId)) send(c, 'notify', payload);
}

/** Ephemeral banner for everyone holding a staff role (e.g. all security devices). */
export function pushToRole(role: 'security' | 'admin', payload: { text: string; tone?: 'info' | 'alert'; link?: string }) {
  for (const c of clients) if (c.roles.has(role)) send(c, 'notify', payload);
}

/** Force-refresh sessions for a person whose identity/roles changed. */
export function refreshPerson(personId: number) {
  for (const c of clients) if (c.personId === personId) send(c, 'invalidate', ['me']);
}
