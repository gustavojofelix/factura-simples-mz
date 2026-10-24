import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../services/supabase.service';
import { AppLanguage, LANGUAGES, currentLanguage, isAppLanguage, storeLanguage } from './i18n';

/**
 * Língua da interface, por utilizador: guardada no browser e, com sessão
 * iniciada, em profiles.language (para acompanhar o utilizador entre dispositivos
 * e para os e-mails que lhe são enviados).
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private supabase = inject(SupabaseService);

  readonly languages = LANGUAGES;

  get current(): AppLanguage {
    return currentLanguage();
  }

  /** Muda a língua escolhida no seletor e recarrega a página. */
  async setLanguage(code: AppLanguage): Promise<void> {
    if (!storeLanguage(code)) return;
    await this.saveToProfile(code);
    window.location.reload();
  }

  /**
   * Após o login: adopta a língua guardada no perfil (recarregando se for diferente)
   * ou, se o perfil ainda não tiver língua, grava a actual.
   */
  async syncWithProfile(userId: string, profileLanguage: unknown): Promise<void> {
    if (isAppLanguage(profileLanguage)) {
      if (storeLanguage(profileLanguage)) window.location.reload();
      return;
    }
    await this.saveToProfile(this.current, userId);
  }

  private async saveToProfile(code: AppLanguage, userId?: string): Promise<void> {
    try {
      const id = userId ?? (await this.supabase.auth.getSession()).data.session?.user.id;
      if (!id) return;
      const { error } = await this.supabase.db.from('profiles').update({ language: code }).eq('id', id);
      if (error) throw error;
    } catch (error) {
      console.warn('Não foi possível gravar a língua no perfil:', error);
    }
  }
}
