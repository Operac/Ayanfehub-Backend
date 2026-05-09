export interface Market {
  id: string;
  name: string;
  delivery_day: string;
  cutoff_time: string;
  image_url: string;
  created_at: Date;
}

export interface Item {
  id: string;
  market_id: string;
  name: string;
  price: number;
  unit: string;
  image_url: string;
  created_at: Date;
}
