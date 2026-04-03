# Restoration Instructions

## Files to copy into your repo

Run these commands from your `eggs/` project root:

### 1. Components (new files)
```
cp eggs-restore/eggs-frontend/src/components/ShoppingListInput.tsx eggs-frontend/src/components/
cp eggs-restore/eggs-frontend/src/components/ClarificationModal.tsx eggs-frontend/src/components/
cp eggs-restore/eggs-frontend/src/components/LoadingState.tsx eggs-frontend/src/components/
cp eggs-restore/eggs-frontend/src/components/SettingsPanel.tsx eggs-frontend/src/components/
cp eggs-restore/eggs-frontend/src/components/PlanResult.tsx eggs-frontend/src/components/
```

### 2. Service (new file)
```
cp eggs-restore/eggs-frontend/src/services/storageService.ts eggs-frontend/src/services/
```

### 3. New page
```
cp eggs-restore/eggs-frontend/src/pages/Plan.tsx eggs-frontend/src/pages/
```

### 4. Replace App.tsx
```
cp eggs-restore/eggs-frontend/src/App.tsx eggs-frontend/src/App.tsx
```

### 5. Install recharts if not present
```
cd eggs-frontend && npm install recharts
```

## Notes

- The `/plan` route is the restored original flow: chef enters their own list,
  clarification step, then Kroger + AI pricing.
- The `/events/*` routes are untouched — event planning remains separate.
- Color scheme is original slate-900 dark blue + amber-400 gold throughout.
- `storageService.ts` uses localStorage for shopping history — works in browser,
  no server needed.
- The Plan page converts `ShoppingItem[]` to `IngredientLine[]` before calling
  `/api/clarify` and `/api/price-plan` — no recipe scaling step, chef owns their list.
