export type Product = {
  id: number;
  name: string;
  slug: string;
  category_id: number;
  category: string;
  price: number;
  compare_price: number | null;
  stock: number;
  image: string;
  description: string;
  flowers: string;
  care: string;
  badge: string;
  active: number;
};
export type Category = {
  id: number;
  name: string;
  slug: string;
  description: string;
};
export type Post = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  image: string;
  published: number;
  created_at: string;
};
export type Promotion = {
  id: number;
  name: string;
  code: string;
  type: string;
  value: number;
  min_order: number;
  starts_at: string;
  ends_at: string;
  usage_limit: number;
  used: number;
  active: number;
};
export type Event = {
  id: number;
  name: string;
  description: string;
  starts_at: string;
  ends_at: string;
  active: number;
};
export type User = {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: string;
  birthday: string | null;
  address: string;
  marketing_consent: number;
};
export type Catalog = {
  products: Product[];
  categories: Category[];
  posts: Post[];
  events: Event[];
};
export type CartItem = { productId: number; quantity: number; size: string };
