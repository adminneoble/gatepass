export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export const bad = (msg: string, code?: string) => new HttpError(400, msg, code);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const forbidden = (msg = 'You do not have access to this.') => new HttpError(403, msg);
export const conflict = (msg: string) => new HttpError(409, msg);
