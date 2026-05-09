export interface Apartment {
  id: string;
  name: string;
  location: string;
  rate_per_night: number;
  images: string[];
  is_available: boolean;
  created_at: Date;
}
