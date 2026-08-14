import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  template: `
    <div class="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-slate-950 py-12 px-4 sm:px-6 lg:px-8">
      <!-- Ambient background mesh orbs - Harmonized Executive Blue Theme -->
      <div class="absolute w-[350px] h-[350px] sm:w-[500px] sm:h-[500px] bg-gradient-to-tr from-blue-600/15 via-indigo-600/20 to-cyan-500/10 rounded-full blur-[100px] sm:blur-[140px] -top-24 -left-24 animate-pulse pointer-events-none"></div>
      <div class="absolute w-[350px] h-[350px] sm:w-[500px] sm:h-[500px] bg-gradient-to-bl from-indigo-700/15 via-blue-500/15 to-teal-500/10 rounded-full blur-[100px] sm:blur-[140px] -bottom-24 -right-24 animate-pulse pointer-events-none"></div>

      <div class="max-w-md w-full relative z-10 flex flex-col gap-6">
        <!-- Logo & Title Header Section -->
        <div class="text-center mb-1 animate-fade-in flex flex-col items-center">
          <!-- Admin Area Badge -->
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-400/30 text-blue-300 text-[11px] font-bold uppercase tracking-wider mb-4 shadow-sm backdrop-blur-md">
            <mat-icon class="!text-sm !w-4 !h-4 !text-blue-400">shield</mat-icon>
            Área Reservada • Admin LTS
          </span>

          <!-- Crisp High-Visibility Logo Wrapper -->
          <div class="p-3.5 sm:p-4 bg-white/95 backdrop-blur-md rounded-2xl border border-white/40 shadow-xl shadow-blue-500/10 ring-4 ring-white/10 mb-4 transition-transform hover:scale-[1.02] flex items-center justify-center">
            <img src="assets/ISPC.png" alt="ISPC Fácil" class="h-12 sm:h-14 w-auto object-contain">
          </div>

          <h2 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Painel Administrativo</h2>
          <p class="text-xs sm:text-sm text-slate-400 mt-1.5 font-medium max-w-xs">Autenticação de alta segurança para a gestão da plataforma</p>
        </div>

        <!-- Login Form Card -->
        <div class="bg-slate-900/80 backdrop-blur-2xl border border-slate-800/90 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-blue-950/40">
          <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="space-y-5">
            <!-- Email Field -->
            <div class="flex flex-col gap-1.5">
              <mat-form-field appearance="outline" class="w-full !m-0 custom-dark-form-field">
                <mat-label class="!text-slate-300">Email Administrativo</mat-label>
                <input matInput type="email" formControlName="email" placeholder="nome@empresa.com" class="!text-white">
                <mat-icon matPrefix class="!text-blue-400">admin_panel_settings</mat-icon>
                @if (getErrorMessage('email')) {
                  <mat-error class="!text-rose-400 font-semibold">{{ getErrorMessage('email') }}</mat-error>
                }
              </mat-form-field>
            </div>

            <!-- Password Field -->
            <div class="flex flex-col gap-1.5">
              <mat-form-field appearance="outline" class="w-full !m-0 custom-dark-form-field">
                <mat-label class="!text-slate-300">Palavra-passe</mat-label>
                <input matInput [type]="hidePassword() ? 'password' : 'text'" formControlName="password" placeholder="" class="!text-white">
                <mat-icon matPrefix class="!text-blue-400">lock</mat-icon>
                <button mat-icon-button matSuffix type="button" (click)="hidePassword.set(!hidePassword())"
                  [attr.aria-label]="'Mostrar palavra-passe'" [attr.aria-pressed]="!hidePassword()" class="!text-slate-400 hover:!text-slate-200">
                  <mat-icon>{{ hidePassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
                @if (getErrorMessage('password')) {
                  <mat-error class="!text-rose-400 font-semibold">{{ getErrorMessage('password') }}</mat-error>
                }
              </mat-form-field>
            </div>

            <!-- Submit Button -->
            <button mat-raised-button type="submit"
              class="w-full !h-12 !bg-gradient-to-r !from-blue-600 !via-indigo-600 !to-blue-600 hover:!from-blue-500 hover:!to-indigo-500 !text-white !text-sm !font-bold !rounded-xl !shadow-lg !shadow-blue-600/30 hover:!shadow-blue-500/40 active:scale-[0.98] transition-all flex items-center justify-center"
              [disabled]="isLoading()">
              @if (isLoading()) {
                <div class="flex items-center gap-2">
                  <mat-spinner diameter="18" class="!text-white white-spinner"></mat-spinner>
                  <span>A autenticar...</span>
                </div>
              } @else {
                <span class="flex items-center justify-center gap-2">
                  Entrar no Painel <mat-icon class="!text-sm !w-4 !h-4 flex items-center justify-center">login</mat-icon>
                </span>
              }
            </button>
          </form>
        </div>

        <!-- Back to Client Site Link -->
        <div class="text-center">
          <a routerLink="/" class="inline-flex items-center text-xs font-semibold text-slate-400 hover:text-white transition-all bg-slate-900/60 hover:bg-slate-800/80 py-2.5 px-4 rounded-xl border border-slate-800 shadow-sm">
            <mat-icon class="!text-sm mr-1.5 !text-blue-400">arrow_back</mat-icon>
            Voltar ao site principal
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      ::ng-deep .success-snackbar {
        background-color: #10B981;
        color: white;
      }
      ::ng-deep .error-snackbar {
        background-color: #EF4444;
        color: white;
      }
      ::ng-deep .custom-dark-form-field .mdc-text-field--outlined {
        --mdc-outlined-text-field-container-color: rgba(15, 23, 42, 0.6) !important;
        --mdc-outlined-text-field-outline-color: rgba(51, 65, 85, 0.8) !important;
        --mdc-outlined-text-field-hover-outline-color: rgba(96, 165, 250, 0.5) !important;
        --mdc-outlined-text-field-focus-outline-color: #3b82f6 !important;
      }
      ::ng-deep .custom-dark-form-field .mat-mdc-form-field-flex {
        border-radius: 0.75rem !important;
      }
      ::ng-deep .custom-dark-form-field .mat-mdc-form-field-outline {
        border-radius: 0.75rem !important;
      }
      ::ng-deep .white-spinner circle {
        stroke: white !important;
      }
      ::ng-deep .mat-mdc-form-field-error {
        color: #f87171 !important;
      }
    `
  ]
})
export class AdminLoginComponent {
  loginForm: FormGroup;
  isLoading = signal(false);
  hidePassword = signal(true);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  async onSubmit() {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);

    const { email, password } = this.loginForm.value;
    const result = await this.authService.signIn(email, password);

    if (result.success) {
      const cleanEmail = (email || '').trim().toLowerCase();
      const isAdmin = cleanEmail === 'gustavojofelix@gmail.com' || await this.authService.isAdmin();
      if (isAdmin) {
        this.snackBar.open('Painel Administrativo acedido com sucesso!', 'Fechar', {
          duration: 3000,
          panelClass: ['success-snackbar']
        });
        this.router.navigate(['/admin']);
      } else {
        await this.authService.signOut();
        this.snackBar.open('Acesso recusado. Esta área é restrita a administradores.', 'Fechar', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    } else {
      this.snackBar.open(result.error || 'Erro ao entrar', 'Fechar', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }

    this.isLoading.set(false);
  }

  getErrorMessage(field: string): string {
    const control = this.loginForm.get(field);
    if (!control || !control.touched) return '';

    if (control.hasError('required')) {
      return 'Este campo é obrigatório';
    }
    if (control.hasError('email')) {
      return 'Email inválido';
    }
    if (control.hasError('minlength')) {
      return 'A palavra-passe deve ter pelo menos 6 caracteres';
    }
    return '';
  }
}
