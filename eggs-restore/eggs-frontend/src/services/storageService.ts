import { ShoppingItem } from '../types'

const HISTORY_KEY = 'eggs_shopping_history_v2'

export const saveToHistory = (items: ShoppingItem[]) => {
  try {
    const existingJson = localStorage.getItem(HISTORY_KEY)
    const existingHistory: ShoppingItem[] = existingJson ? JSON.parse(existingJson) : []
    const historyMap = new Map(existingHistory.map(i => [(i.clarifiedName || i.name).toLowerCase(), i]))
    items.forEach(item => {
      const key = (item.clarifiedName || item.name).toLowerCase()
      historyMap.set(key, { ...item, lastPurchased: new Date().toISOString() })
    })
    const updatedHistory = Array.from(historyMap.values()).sort((a, b) =>
      new Date(b.lastPurchased || 0).getTime() - new Date(a.lastPurchased || 0).getTime()
    )
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory))
  } catch (e) {
    console.error('Failed to save history', e)
  }
}

export const getHistory = (): ShoppingItem[] => {
  try {
    const json = localStorage.getItem(HISTORY_KEY)
    return json ? JSON.parse(json) : []
  } catch {
    return []
  }
}

export const removeFromHistory = (itemId: string): ShoppingItem[] => {
  try {
    const history = getHistory()
    const updated = history.filter(h => h.id !== itemId)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
    return updated
  } catch {
    return []
  }
}
