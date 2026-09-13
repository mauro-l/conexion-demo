export type Barber = { name: string; alias: string | null; description: string | null; photoUrl: string | null };
export type Context = { barberia: { name: string; description: string }; barbers: Barber[] };
export type Catalog = { services: { name: string; durationMinutes: number; price: number }[] };
export type PublicError = { error: { code: string; message: string; retryable: boolean } };
