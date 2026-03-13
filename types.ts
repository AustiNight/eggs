export enum AppStatus {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  CLARIFYING = 'CLARIFYING',
  SEARCHING = 'SEARCHING',
  OPTIMIZING = 'OPTIMIZING',
  RESULTS = 'RESULTS',
  ERROR = 'ERROR'
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number;
  unit?: string;
  clarifiedName?: string;
  category?: string;
  lastPurchased?: string; // ISO Date string
}

export interface AppSettings {
  radius: number; // in miles
  maxStores: number;
  curbsideDistance: number; // in miles
  includeDelivery: boolean;
}

export interface GeoLocation {
  lat: number;
  lng: number;
}

export interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  address: string;
  avatar: string; // Emoji char
  avoidStores: string[];
  avoidBrands: string[];
}

export interface AuthState {
  isAuthenticated: boolean;
  user: UserProfile | null;
}

export interface ClarificationRequest {
  itemId: string;
  originalName: string;
  question: string;
  options: string[];
}

export interface StoreItemPrice {
  name: string;
  price: number; // The logic price (member price if available)
  nonMemberPrice?: number; // For display comparison
  isLoyaltyPrice: boolean;
  quantity: number;
  total: number;
  confidence: 'high' | 'estimated';
  // Deterministic Automation Fields
  productId?: string; // SKU or unique ID
  productUrl?: string; // Actionable Shopping Link (e.g. Search Query)
  proofUrl?: string;   // Source of Truth (e.g. Specific Product Page/Ad)
  automationAction?: string; // Script instruction e.g., "click(#add-to-cart-SKU123)"
}

export interface StorePlan {
  storeName: string;
  storeAddress?: string;
  storeType: 'Physical' | 'Delivery';
  items: StoreItemPrice[];
  subtotal: number;
  estimatedTax: number;
  grandTotal: number;
  distance?: string;
  link?: string;
}

export interface ShoppingPlan {
  id: string;
  stores: StorePlan[];
  totalCost: number; // Pre-tax
  totalTax: number;
  finalTotal: number; // With tax
  totalSavings: number; // Estimated savings vs average
  summary: string;
  analysisMetadata: {
    totalStoresScanned: number;
    radiusSearched: number;
    dealsAnalyzed: number;
  };
}