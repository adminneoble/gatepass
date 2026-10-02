import { z } from 'zod';
import { bad } from './errors.js';

export const mobile = z.string().trim().regex(/^\d{10}$/, 'Enter a 10-digit mobile number.');
export const name = z.string().trim().min(1, 'Enter a name.').max(80);
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
export const unitId = z.string().trim().min(1).max(20).transform(s => s.toUpperCase());
/** Small inline image (resized on device). ~600 KB cap. */
export const dataUrlImage = z.string().regex(/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/, 'Upload an image.').max(800_000, 'Image is too large.');

export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw bad(r.error.issues[0]?.message ?? 'Invalid request.');
  return r.data;
}
export { z };
