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
      <!-- Soft glowing background orbs - Blue Theme for Admin -->
      <div class="absolute w-[300px] h-[300px] sm:w-[450px] sm:h-[450px] bg-gradient-to-tr from-blue-600/20 to-indigo-600/30 rounded-full blur-[80px] sm:blur-[120px] -top-20 -left-20 animate-pulse pointer-events-none"></div>
      <div class="absolute w-[300px] h-[300px] sm:w-[450px] sm:h-[450px] bg-gradient-to-bl from-blue-500/20 to-cyan-500/20 rounded-full blur-[80px] sm:blur-[120px] -bottom-20 -right-20 animate-pulse pointer-events-none"></div>

      <div class="max-w-md w-full relative z-10 flex flex-col gap-6">
        <!-- Logo Section -->
        <div class="text-center mb-2 animate-fade-in">
          <div class="inline-flex p-3.5 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 shadow-inner mb-4">
            <img src="assets/ISPC.png" alt="ISPC Fácil" class="h-14 sm:h-16 w-auto">
          </div>
          <h2 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Painel Administrativo</h2>
          <p class="text-sm text-slate-400 mt-1.5 font-medium">Autenticação exclusiva para administradores</p>
        </div>

        <!-- Login Form -->
        <div class="bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="space-y-5">
            <!-- Email Field -->
            <div class="flex flex-col gap-1.5">
              <mat-form-field appearance="outline" class="w-full !m-0 custom-dark-form-field">
                <mat-label class="!text-slate-400">Email Administrativo</mat-label>
                <input matInput type="email" formControlName="email" placeholder="nome@empresa.com" class="!text-white">
                <mat-icon matPrefix class="!text-slate-400">admin_panel_settings</mat-icon>
                @if (getErrorMessage('email')) {
                  <mat-error class="!text-rose-400 font-semibold">{{ getErrorMessage('email') }}</mat-error>
                }
              </mat-form-field>
            </div>

            <!-- Password Field -->
            <div class="flex flex-col gap-1.5">
              <mat-form-field appearance="outline" class="w-full !m-0 custom-dark-form-field">
                <mat-label class="!text-slate-400">Palavra-passe</mat-label>
                <input matInput [type]="hidePassword() ? 'password' : 'text'" formControlName="password" placeholder="" class="!text-white">
                <mat-icon matPrefix class="!text-slate-400">lock</mat-icon>
                <button mat-icon-button matSuffix type="button" (click)="hidePassword.set(!hidePassword())"
                  [attr.aria-label]="'Mostrar palavra-passe'" [attr.aria-pressed]="!hidePassword()" class="!text-slate-400">
                  <mat-icon>{{ hidePassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
                @if (getErrorMessage('password')) {
                  <mat-error class="!text-rose-400 font-semibold">{{ getErrorMessage('password') }}</mat-error>
                }
              </mat-form-field>
            </div>

            <!-- Submit Button -->
            <button mat-raised-button type="submit"
              class="w-full !h-12 !bg-gradient-to-r !from-blue-600 !to-indigo-600 !text-white !text-sm !font-bold !rounded-xl hover:!from-blue-700 hover:!to-blue-600 !shadow-lg hover:!shadow-blue-500/20 active:scale-[0.98] transition-all flex items-center justify-center"
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

        <!-- Back to Client Site -->
        <div class="text-center">
          <a routerLink="/" class="inline-flex items-center text-xs font-semibold text-slate-400 hover:text-white transition-all bg-white/5 hover:bg-white/10 py-2.5 px-4 rounded-xl border border-white/10 backdrop-blur-sm shadow-sm">
            <mat-icon class="!text-sm mr-1.5">arrow_back</mat-icon>
            Voltar ao site do cliente
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
        --mdc-outlined-text-field-container-color: rgba(255, 255, 255, 0.03) !important;
        --mdc-outlined-text-field-outline-color: rgba(255, 255, 255, 0.12) !important;
        --mdc-outlined-text-field-hover-outline-color: rgba(255, 255, 255, 0.25) !important;
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
      const isAdmin = await this.authService.isAdmin();
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
