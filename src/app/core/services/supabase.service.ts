import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, User, Session } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { createSharedCookieStorage, withLocalStorageMigration } from '../utils/cookie-storage';
import { sharedCookieDomain } from '../utils/tenant.util';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    // Na web em produção a sessão vive em cookies de .<rootDomain>, partilhados
    // pelos subdomínios das contas. Em dev (localhost) e na app nativa usa localStorage.
    const cookieDomain = Capacitor.isNativePlatform()
      ? null
      : sharedCookieDomain(window.location.hostname, environment.rootDomain);
    const storage = cookieDomain
      ? withLocalStorageMigration(createSharedCookieStorage(cookieDomain))
      : undefined;

    this.supabase = createClient(
      environment.supabaseUrl,
      environment.supabaseKey,
      {
        auth: {
          storage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => {
            return await fn();
          }
        }
      }
    );
  }

  get client() {
    return this.supabase;
  }

  get auth() {
    return this.supabase.auth;
  }

  get db() {
    return this.supabase;
  }
}
