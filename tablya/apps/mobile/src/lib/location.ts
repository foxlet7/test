import * as Location from 'expo-location';
import { create } from 'zustand';

interface Coords {
  lat: number;
  lng: number;
}
export const useLocation = create<{ coords: Coords | null; set(c: Coords | null): void }>(
  (set) => ({ coords: null, set: (coords) => set({ coords }) }),
);

/** Requests foreground permission (only when the user asks) and resolves the current position. */
export async function requestLocation(): Promise<Coords | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return null;
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const c = { lat: p.coords.latitude, lng: p.coords.longitude };
  useLocation.getState().set(c);
  return c;
}
