export type Barber = { name: string; alias: string | null; description: string | null; photoUrl: string | null };
export type Context = {
  barberia: {
    name: string;
    description: string;
    address?: string;
    hours?: string;
    whatsappUrl?: string;
    instagramHandle?: string;
    instagramUrl?: string;
  };
  barbers: Barber[];
};
export type Catalog = {
  services: {
    name: string;
    durationMinutes: number;
    price: number;
    description?: string | null;
  }[];
};
export type PublicError = { error: { code: string; message: string; retryable: boolean } };
