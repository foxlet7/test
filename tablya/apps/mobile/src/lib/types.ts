import type { DishData, KitchenCardData } from '../components/domain';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
export interface Category {
  id: string;
  slug: string;
  name: string;
  nameAr: string;
}
export interface Home {
  categories: Category[];
  featured: KitchenCardData[];
  nearby: KitchenCardData[];
  popular: DishData[];
  promotions: { id: string; title: string; titleAr: string; couponCode: string | null }[];
}
export interface OptionDef {
  id: string;
  name: string;
  nameAr: string | null;
  priceDeltaMinor: number;
  isAvailable: boolean;
}
export interface OptionGroup {
  id: string;
  name: string;
  nameAr: string | null;
  type: 'VARIATION' | 'ADDON';
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: OptionDef[];
}
export interface Dish extends DishData {
  kitchenId: string;
  ingredients: string[];
  allergens: string[];
  prepTimeMin: number | null;
  stock?: number | null;
  optionGroups: OptionGroup[];
}
export interface KitchenDetail extends KitchenCardData {
  description: string | null;
  descriptionAr: string | null;
  policies: string | null;
  galleryUrls: (string | null)[];
  cook: { name: string; bio: string | null; avatarUrl: string | null };
  timezone: string;
  schedule: { dayOfWeek: number; openMinute: number; closeMinute: number }[];
  zones: { id: string; name: string; maxKm: number; feeMinor: number; etaMinutes: number }[];
  menu: Dish[];
  reviews: { id: string; rating: number; text: string | null; author: string; createdAt: string }[];
}
export interface PricingResult {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  total: number;
}
export interface CartLine {
  cartItemId: string;
  menuItemId: string;
  name: string;
  nameAr: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  note: string | null;
  options: { id: string; name: string; nameAr: string | null }[];
}
export interface CartView {
  kitchenId: string | null;
  lines: CartLine[];
  pricing: PricingResult | null;
  issues: { code: string; message: string }[];
  currency: string | null;
  etaMinutes?: number | null;
}
export interface Address {
  id: string;
  label: string | null;
  line1: string;
  city: string;
  lat: number;
  lng: number;
  isDefault: boolean;
}
export interface OrderView {
  id: string;
  orderNo: number;
  status: string;
  fulfillment: 'DELIVERY' | 'PICKUP';
  paymentMethod: 'CARD' | 'CASH_ON_DELIVERY';
  currency: string;
  totalMinor: number;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  discountMinor: number;
  serviceFeeMinor: number;
  etaMinutes: number | null;
  cancelReason: string | null;
  createdAt: string;
  kitchen: { id: string; name: string; nameAr: string | null } | null;
  items: {
    id: string;
    name: string;
    quantity: number;
    lineTotalMinor: number;
    note: string | null;
  }[];
  history: { from: string | null; to: string; at: string; reason: string | null }[];
  payments: { id: string; status: string; method: string }[];
  reviewed: boolean;
  customer?: { name: string; phone: string | null };
}
