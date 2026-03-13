import { ShoppingItem, UserProfile } from "../types";

const HISTORY_KEY = 'eggs_shopping_history_v2';
const PROFILE_KEY = 'eggs_user_profile_v1';

export const saveToHistory = (items: ShoppingItem[]) => {
  try {
    const existingJson = localStorage.getItem(HISTORY_KEY);
    const existingHistory: ShoppingItem[] = existingJson ? JSON.parse(existingJson) : [];

    // Map by name to deduplicate
    const historyMap = new Map(existingHistory.map(i => [(i.clarifiedName || i.name).toLowerCase(), i]));

    items.forEach(item => {
      const key = (item.clarifiedName || item.name).toLowerCase();
      historyMap.set(key, {
        ...item,
        lastPurchased: new Date().toISOString()
      });
    });

    // Convert back to array and sort by date desc
    const updatedHistory = Array.from(historyMap.values()).sort((a, b) => {
      return new Date(b.lastPurchased || 0).getTime() - new Date(a.lastPurchased || 0).getTime();
    });

    localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
  } catch (e) {
    console.error("Failed to save history", e);
  }
};

export const getHistory = (): ShoppingItem[] => {
  try {
    const json = localStorage.getItem(HISTORY_KEY);
    return json ? JSON.parse(json) : [];
  } catch (e) {
    return [];
  }
};

export const removeFromHistory = (itemId: string) => {
  try {
    const history = getHistory();
    const newHistory = history.filter(h => h.id !== itemId);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    return newHistory;
  } catch (e) {
    return [];
  }
};

export const saveProfile = (profile: UserProfile) => {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
};

export const getProfile = (): UserProfile | null => {
  const json = localStorage.getItem(PROFILE_KEY);
  return json ? JSON.parse(json) : null;
};

export const clearProfile = () => {
  localStorage.removeItem(PROFILE_KEY);
};