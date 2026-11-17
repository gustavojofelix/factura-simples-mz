import { Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { environment } from '../../../environments/environment';
import { parseAccountSlug } from '../utils/tenant.util';
import { offlineMode } from '../offline/offline-fetch';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';

/** Rotas onde o botão "voltar" do Android sai da app (minimiza) em vez de recuar. */
const ROOT_ROUTES = new Set(['/', '/painel', '/entrar', '/escolher-conta', '/pos']);

/**
 * Integração com o Android: botão "voltar", App Links (links https://<conta>.ispcfacil.com
 * que abrem a app) e regresso da ligação à internet. Não faz nada na web.
 */
@Injectable({ providedIn: 'root' })
export class NativeAppService {
  private router = inject(Router);
  private zone = inject(NgZone);
  private dialog = inject(MatDialog);
  private supabase = inject(SupabaseService);
  private authService = inject(AuthService);
  private accountService = inject(AccountService);

  init() {
    if (!Capacitor.isNativePlatform()) return;

    App.addListener('backButton', ({ canGoBack }) => this.zone.run(() => this.onBack(canGoBack)));
    App.addListener('appUrlOpen', ({ url }) => this.zone.run(() => void this.openUrl(url)));
    // A app pode ter sido aberta por um link (arranque a frio).
    App.getLaunchUrl().then(launch => {
      if (launch?.url) this.zone.run(() => void this.openUrl(launch.url));
    });

    // O aviso "sem internet" some quando a rede volta (o pedido seguinte confirma).
    window.addEventListener('online', () => this.zone.run(() => offlineMode.set(false)));
  }

  private onBack(canGoBack: boolean) {
    const dialogs = this.dialog.openDialogs;
    if (dialogs.length > 0) {
      dialogs[dialogs.length - 1].close();
      return;
    }
    const path = this.router.url.split(/[?#]/)[0];
    if (canGoBack && !ROOT_ROUTES.has(path)) {
      window.history.back();
    } else {
      void App.minimizeApp();
    }
  }

  /**
   * Abre na app um link https://[<conta>.]ispcfacil.com/#/<rota>.
   * Links de autenticação (redefinir senha) trazem os tokens no fragmento:
   * a sessão é criada antes de navegar. Com um subdomínio, activa essa conta
   * se o utilizador lhe tiver acesso.
   */
  async openUrl(rawUrl: string) {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return;
    }
    const root = environment.rootDomain;
    const host = url.hostname.toLowerCase();
    if (host !== root && !host.endsWith(`.${root}`)) return;

    // "#/resetar-senha#access_token=..." → rota "/resetar-senha" + parâmetros de auth.
    const hash = url.hash.replace(/^#/, '');
    const authStart = hash.search(/(^|#)(access_token|error)=/);
    const routePart = authStart >= 0 ? hash.slice(0, authStart) : hash;
    const authPart = authStart >= 0 ? hash.slice(authStart).replace(/^#/, '') : '';

    if (authPart) {
      const params = new URLSearchParams(authPart);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        await this.supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      }
    }

    const slug = parseAccountSlug(host, root);
    if (slug && this.authService.isAuthenticated()) {
      await this.accountService.ensureLoaded();
      const account = this.accountService.accounts().find(a => a.slug === slug);
      if (account && account.id !== this.accountService.activeAccount()?.id) {
        this.accountService.switchAccount(account);
      }
    }

    const route = routePart.startsWith('/') && routePart.length > 1 ? routePart : '/painel';
    await this.router.navigateByUrl(route);
  }
}
