import { Component, signal, OnInit, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { ToastComponent } from '../../../shared/components/toast.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog.component';
import { filter } from 'rxjs/operators';

interface NavItem {
  path: string;
  label: string;
  exact?: boolean;
  icon: string;
}

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, ToastComponent, ConfirmDialogComponent],
  template: `
    <div class="min-h-screen bg-gray-50 flex">
      <!-- Mobile Overlay -->
      @if (isSidebarOpen()) {
        <div class="fixed inset-0 bg-black/50 z-20 lg:hidden" (click)="isSidebarOpen.set(false)"></div>
      }

      <!-- Sidebar -->
      <aside
        class="fixed lg:static inset-y-0 left-0 z-30 flex flex-col bg-slate-900 text-white transition-all duration-300"
        [class]="isSidebarOpen() ? 'w-64 translate-x-0' : 'w-64 -translate-x-full lg:translate-x-0'"
        [class.lg:w-64]="!isSidebarCollapsed()"
        [class.lg:w-16]="isSidebarCollapsed()">

        <!-- Logo -->
        <div class="h-16 flex items-center px-4 border-b border-slate-800 flex-shrink-0 overflow-hidden">
          <div class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">A</div>
          @if (!isSidebarCollapsed()) {
            <span class="ml-3 text-base font-bold tracking-tight whitespace-nowrap overflow-hidden">
              ISPC <span class="text-blue-400">Fácil</span> Admin
            </span>
          }
        </div>

        <!-- Nav -->
        <nav class="flex-1 py-4 space-y-1 px-2 overflow-y-auto overflow-x-hidden">
          @for (item of navItems; track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="bg-slate-700 text-white"
              [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
              [title]="isSidebarCollapsed() ? item.label : ''"
              class="flex items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors group"
              [class]="isSidebarCollapsed() ? 'justify-center p-3' : 'space-x-3 px-4 py-3'">
              <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" [attr.d]="item.icon"/>
              </svg>
              @if (!isSidebarCollapsed()) {
                <span class="text-sm font-medium whitespace-nowrap">{{ item.label }}</span>
              }
            </a>
          }

          <div class="border-t border-slate-800 my-2"></div>

          <a
            routerLink="/painel"
            [title]="isSidebarCollapsed() ? 'Voltar ao App' : ''"
            class="flex items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            [class]="isSidebarCollapsed() ? 'justify-center p-3' : 'space-x-3 px-4 py-3'">
            <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
            </svg>
            @if (!isSidebarCollapsed()) {
              <span class="text-sm font-medium">Voltar ao App</span>
            }
          </a>
        </nav>

        <!-- User / Logout -->
        <div class="border-t border-slate-800 p-3 flex-shrink-0">
          @if (!isSidebarCollapsed()) {
            <div class="flex items-center gap-3 mb-2 px-2 py-1.5">
              <div class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {{ adminInitials() }}
              </div>
              <div class="min-w-0">
                <p class="text-xs font-semibold text-slate-200 truncate">{{ adminName() }}</p>
                <p class="text-[10px] text-slate-500 truncate">Administrador</p>
              </div>
            </div>
          }
          <button
            (click)="logout()"
            [title]="isSidebarCollapsed() ? 'Sair' : ''"
            class="w-full flex items-center rounded-lg text-slate-400 hover:bg-rose-900/30 hover:text-rose-400 transition-colors"
            [class]="isSidebarCollapsed() ? 'justify-center p-3' : 'space-x-3 px-4 py-3'">
            <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
            </svg>
            @if (!isSidebarCollapsed()) {
              <span class="text-sm font-medium">Sair</span>
            }
          </button>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <!-- Top Bar -->
        <header class="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-8 flex-shrink-0 gap-4">
          <div class="flex items-center gap-3">
            <!-- Mobile hamburger -->
            <button (click)="isSidebarOpen.set(!isSidebarOpen())" class="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
            </button>
            <!-- Desktop collapse toggle -->
            <button (click)="toggleCollapsed()" class="hidden lg:flex p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
            </button>
            <div>
              <h1 class="text-base font-bold text-gray-900">{{ currentPageTitle() }}</h1>
              <p class="text-[10px] text-gray-400 uppercase tracking-wider font-medium hidden sm:block">Painel Administrativo</p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="hidden sm:flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5">
              <div class="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold">
                {{ adminInitials() }}
              </div>
              <span class="text-xs font-semibold text-gray-700">{{ adminName() }}</span>
            </div>
          </div>
        </header>

        <div class="flex-1 overflow-y-auto p-4 lg:p-8">
          <router-outlet></router-outlet>
        </div>
      </main>

      <!-- Global Toast Notifications -->
      <app-toast></app-toast>
      <!-- Global Confirm Dialog -->
      <app-confirm-dialog></app-confirm-dialog>
    </div>
  `
})
export class AdminLayoutComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);

  isSidebarCollapsed = signal(false);
  isSidebarOpen = signal(false); // Mobile sidebar toggle
  adminName = signal('Administrador');
  adminInitials = signal('A');
  currentPageTitle = signal('Dashboard');

  navItems: NavItem[] = [
    { path: '/admin', label: 'Dashboard', exact: true, icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
    { path: '/admin/subscritores', label: 'Subscritores', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
    { path: '/admin/empresas', label: 'Contribuintes', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
    { path: '/admin/actividades', label: 'Actividades', icon: 'M4 6h16M4 12h16M4 18h10' },
    { path: '/admin/financeiro', label: 'Financeiro', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { path: '/admin/planos', label: 'Planos', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    { path: '/admin/vouchers', label: 'Vouchers', icon: 'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z' },
    { path: '/admin/conteudo', label: 'Gestão do Site', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
    { path: '/admin/acessos', label: 'Acessos', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
    { path: '/admin/auditoria', label: 'Auditoria', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' }
  ];

  private pageTitles: Record<string, string> = {
    '/admin': 'Dashboard',
    '/admin/subscritores': 'Subscritores',
    '/admin/empresas': 'Contribuintes',
    '/admin/actividades': 'Actividades',
    '/admin/financeiro': 'Financeiro',
    '/admin/planos': 'Planos de Subscrição',
    '/admin/vouchers': 'Gestão de Vouchers',
    '/admin/conteudo': 'Gestão do Site',
    '/admin/acessos': 'Gestão de Acessos',
    '/admin/auditoria': 'Auditoria'
  };

  async ngOnInit() {
    // Load admin profile
    const profile = await this.authService.getCurrentProfile();
    if (profile?.full_name) {
      this.adminName.set(profile.full_name);
      const parts = profile.full_name.trim().split(' ');
      const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : parts[0].substring(0, 2).toUpperCase();
      this.adminInitials.set(initials);
    }

    // Set initial page title
    this.updatePageTitle(this.router.url);

    // Update title on navigation
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe(e => {
      this.updatePageTitle((e as NavigationEnd).urlAfterRedirects);
      this.isSidebarOpen.set(false); // Close mobile sidebar on navigate
    });
  }

  private updatePageTitle(url: string): void {
    const path = url.split('?')[0];
    this.currentPageTitle.set(this.pageTitles[path] ?? 'Painel Administrativo');
  }

  toggleCollapsed(): void {
    this.isSidebarCollapsed.set(!this.isSidebarCollapsed());
  }

  async logout() {
    await this.authService.signOut();
  }
}
