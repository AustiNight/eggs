import { AppSettings } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  radius: 5,
  maxStores: 3,
  curbsideDistance: 5,
  includeDelivery: true,
};

export const MOCK_SAVINGS_PERCENTAGE = 0.15; // Used for estimation visual

// Sample placeholders if location fails
export const DEFAULT_LOCATION = {
  lat: 40.7128,
  lng: -74.0060
};