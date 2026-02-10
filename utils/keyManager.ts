/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface KeyState {
  key: string;
  isJailed: boolean;
  jailedUntil: number;
  remainingCooldown: number;
  requestsInLastMinute: number;
}

export class KeyManager {
  private keys: string[];
  private currentIndex: number = 0;
  private jailedUntil: Map<string, number> = new Map();
  private requestCounts: Map<string, number> = new Map();
  private lastResetTime: number = Date.now();

  // Rate Limiting Config
  private static MAX_RPM = 12; // Conservative limit for Gemini Free
  private static RESET_INTERVAL = 60000; // 1 minute

  // Fallback keys from your provided file
  private static FALLBACK_KEYS = "AIzaSyDmEImJBVuUvw0NKH2KWlArA2qN4_MWFvk,AIzaSyBuN4r6271T0bp88jGDjEs7Xvg0BP-UPdk";

  constructor(envString: string | undefined) {
    let rawKeys = envString;

    if (!rawKeys || rawKeys === 'API_KEY' || rawKeys.includes('undefined')) {
      console.warn("Invalid process.env.API_KEY detected. Using fallback keys.");
      rawKeys = KeyManager.FALLBACK_KEYS;
    }

    this.keys = rawKeys
      .split(',')
      .map(k => k.trim())
      .map(k => k.replace(/['"]/g, ''))
      .filter(k => k.length > 10);

    if (this.keys.length === 0) {
      console.error("No valid API keys found!");
    } else {
      console.log(`[KeyManager] Loaded ${this.keys.length} API keys.`);
      this.keys.forEach(key => this.requestCounts.set(key, 0));
    }
  }

  get activeKeyCount() {
    return this.keys.length;
  }

  private checkReset() {
    const now = Date.now();
    if (now - this.lastResetTime > KeyManager.RESET_INTERVAL) {
      this.keys.forEach(key => this.requestCounts.set(key, 0));
      this.lastResetTime = now;
      console.log("[KeyManager] Rate limit counters reset.");
    }
  }

  private isUsable(index: number): boolean {
    const key = this.keys[index];
    this.checkReset();

    // 1. Check Jail
    if (this.jailedUntil.has(key) && this.jailedUntil.get(key)! > Date.now()) {
        return false;
    }

    // 2. Check Rate Limit
    const count = this.requestCounts.get(key) || 0;
    return count < KeyManager.MAX_RPM;
  }

  // Proactive Key Reservation
  reserveKey(): string | null {
    this.checkReset();

    // 1. Check current
    if (this.isUsable(this.currentIndex)) {
      const key = this.keys[this.currentIndex];
      this.incrementCount(key);
      return key;
    }

    // 2. Search others
    for (let i = 1; i < this.keys.length; i++) {
      const ptr = (this.currentIndex + i) % this.keys.length;
      if (this.isUsable(ptr)) {
        this.currentIndex = ptr;
        const key = this.keys[ptr];
        this.incrementCount(key);
        return key;
      }
    }

    return null; // All keys busy or jailed
  }

  private incrementCount(key: string) {
    const current = this.requestCounts.get(key) || 0;
    this.requestCounts.set(key, current + 1);
  }

  // Legacy method kept for compatibility, but delegates to reserveKey or returns best effort
  getWorkingKey(): string {
     const reserved = this.reserveKey();
     if (reserved) return reserved;
     
     // Fallback: Return current even if over limit (for non-critical ops)
     return this.keys[this.currentIndex];
  }

  jailCurrentKey(durationMs: number = 60000) {
    if (this.keys.length === 0) return;
    
    const key = this.keys[this.currentIndex];
    const expiry = Date.now() + durationMs;
    this.jailedUntil.set(key, expiry);
    console.warn(`[KeyManager] Jailing key ...${key.slice(-4)} for ${durationMs/1000}s`);
    
    // Find next usable
    for (let i = 1; i < this.keys.length; i++) {
        const ptr = (this.currentIndex + i) % this.keys.length;
        if (this.isUsable(ptr)) {
            this.currentIndex = ptr;
            return;
        }
    }
    
    // If all jailed, just rotate to spread the pain
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
  }

  allKeysJailed(): boolean {
    return this.keys.every((_, index) => !this.isUsable(index));
  }

  getKeyStates(): KeyState[] {
    const now = Date.now();
    return this.keys.map((key) => {
      const until = this.jailedUntil.get(key) || 0;
      const isJailed = until > now;
      return {
        key: `...${key.slice(-4)}`,
        isJailed,
        jailedUntil: until,
        remainingCooldown: isJailed ? Math.ceil((until - now) / 1000) : 0,
        requestsInLastMinute: this.requestCounts.get(key) || 0
      };
    });
  }
}

export const keyManager = new KeyManager(process.env.API_KEY);