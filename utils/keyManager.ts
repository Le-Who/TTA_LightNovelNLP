/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface KeyState {
  key: string;
  isJailed: boolean;
  jailedUntil: number;
  remainingCooldown: number;
}

export class KeyManager {
  private keys: string[];
  private currentIndex: number = 0;
  private jailedUntil: Map<string, number> = new Map();

  // Fallback keys from your provided file, ensuring app works even if .env is misplaced
  private static FALLBACK_KEYS = "AIzaSyDmEImJBVuUvw0NKH2KWlArA2qN4_MWFvk,AIzaSyBuN4r6271T0bp88jGDjEs7Xvg0BP-UPdk";

  constructor(envString: string | undefined) {
    let rawKeys = envString;

    // Detection for bad env injection (common build issue)
    if (!rawKeys || rawKeys === 'API_KEY' || rawKeys.includes('undefined')) {
      console.warn("Invalid process.env.API_KEY detected. Using fallback keys.");
      rawKeys = KeyManager.FALLBACK_KEYS;
    }

    this.keys = rawKeys
      .split(',')
      .map(k => k.trim())
      // Filter out empty strings and quotes
      .map(k => k.replace(/['"]/g, ''))
      .filter(k => k.length > 10); // Basic validation length check

    if (this.keys.length === 0) {
      console.error("No valid API keys found!");
    } else {
      console.log(`[KeyManager] Loaded ${this.keys.length} API keys.`);
    }
  }

  get activeKeyCount() {
    return this.keys.length;
  }

  // Helper to check if a specific key index is usable
  private isUsable(index: number): boolean {
    const key = this.keys[index];
    if (!this.jailedUntil.has(key)) return true;
    return this.jailedUntil.get(key)! < Date.now();
  }

  getWorkingKey(): string {
    if (this.keys.length === 0) return '';

    // 1. Check if current is usable
    if (this.isUsable(this.currentIndex)) {
      return this.keys[this.currentIndex];
    }

    // 2. Search for ANY usable key
    for (let i = 1; i < this.keys.length; i++) {
      const ptr = (this.currentIndex + i) % this.keys.length;
      if (this.isUsable(ptr)) {
        this.currentIndex = ptr;
        return this.keys[ptr];
      }
    }

    // 3. All are jailed. Return current and let it fail or wait.
    return this.keys[this.currentIndex]; 
  }

  jailCurrentKey(durationMs: number = 60000) {
    if (this.keys.length === 0) return;
    
    const key = this.keys[this.currentIndex];
    const expiry = Date.now() + durationMs;
    this.jailedUntil.set(key, expiry);
    console.warn(`[KeyManager] Jailing key ...${key.slice(-4)} for ${durationMs/1000}s`);
    
    // Immediately try to find a new usable key
    for (let i = 1; i < this.keys.length; i++) {
        const ptr = (this.currentIndex + i) % this.keys.length;
        if (this.isUsable(ptr)) {
            this.currentIndex = ptr;
            return;
        }
    }
    
    // If all jailed, rotate anyway
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
  }

  allKeysJailed(): boolean {
    return this.keys.every((_, index) => !this.isUsable(index));
  }

  // Debug method to get full state
  getKeyStates(): KeyState[] {
    const now = Date.now();
    return this.keys.map((key, index) => {
      const until = this.jailedUntil.get(key) || 0;
      const isJailed = until > now;
      return {
        key: `...${key.slice(-4)}`,
        isJailed,
        jailedUntil: until,
        remainingCooldown: isJailed ? Math.ceil((until - now) / 1000) : 0
      };
    });
  }
}

// Export a singleton instance initialized with the process.env.API_KEY
export const keyManager = new KeyManager(process.env.API_KEY);