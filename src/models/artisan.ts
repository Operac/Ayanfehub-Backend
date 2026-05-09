export interface Artisan {
  id: string;
  name: string;
  category: string; // 'Personal & Fashion', 'Home & Property', 'Food & Lifestyle'
  portfolio_images: string[];
  is_available: boolean;
  starting_price: number;
  created_at: Date;
}

export interface ArtisanService {
  id: string;
  artisan_id: string;
  service_name: string;
  price: number;
}
