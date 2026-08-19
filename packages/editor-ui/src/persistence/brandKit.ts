import { deleteMediaBlob, loadMediaBlob, saveMediaBlob } from "./db.js";

export interface BrandKit {
  primaryColor: string;
  secondaryColor: string;
  hasLogo: boolean;
}

const STORAGE_KEY = "reel-studio-brand-kit";
export const BRAND_LOGO_BLOB_ID = "brand-kit-logo";

const DEFAULT_BRAND_KIT: BrandKit = { primaryColor: "#5b7cff", secondaryColor: "#ffffff", hasLogo: false };

export function loadBrandKit(): BrandKit {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BRAND_KIT;
    return { ...DEFAULT_BRAND_KIT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_BRAND_KIT;
  }
}

export function saveBrandKit(kit: BrandKit): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(kit));
}

export async function saveBrandLogo(file: File): Promise<void> {
  await saveMediaBlob(BRAND_LOGO_BLOB_ID, file);
  saveBrandKit({ ...loadBrandKit(), hasLogo: true });
}

export async function loadBrandLogoBlob(): Promise<Blob | null> {
  return loadMediaBlob(BRAND_LOGO_BLOB_ID);
}

export async function clearBrandLogo(): Promise<void> {
  await deleteMediaBlob(BRAND_LOGO_BLOB_ID);
  saveBrandKit({ ...loadBrandKit(), hasLogo: false });
}
