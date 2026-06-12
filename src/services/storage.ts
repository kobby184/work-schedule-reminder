import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CalloffEvent, Profile, Shift } from '../types';

const profileKey = 'shiftready:profile';
const shiftsKey = 'shiftready:shifts';
const calloffKey = 'shiftready:calloffs';

export async function loadProfile() {
  return loadJson<Profile | null>(profileKey, null);
}

export async function saveProfile(profile: Profile) {
  await AsyncStorage.setItem(profileKey, JSON.stringify(profile));
}

export async function loadShifts() {
  return loadJson<Shift[]>(shiftsKey, []);
}

export async function saveShifts(shifts: Shift[]) {
  await AsyncStorage.setItem(shiftsKey, JSON.stringify(shifts));
}

export async function loadCalloffEvents() {
  return loadJson<CalloffEvent[]>(calloffKey, []);
}

export async function saveCalloffEvents(events: CalloffEvent[]) {
  await AsyncStorage.setItem(calloffKey, JSON.stringify(events));
}

export async function clearLocalData() {
  await AsyncStorage.multiRemove([profileKey, shiftsKey, calloffKey]);
}

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
