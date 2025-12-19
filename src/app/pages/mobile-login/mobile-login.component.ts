import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-mobile-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, RouterModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Entrar</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="login-container">
        <div class="logo-section">
          <ion-icon name="receipt-outline" size="large" color="primary"></ion-icon>
          <h2>InvoiceHub</h2>
          <p>Gestão de Facturas Simplificada</p>
        </div>

        <form [formGroup]="loginForm" (ngSubmit)="onSubmit()">
          <ion-item>
            <ion-label position="floating">Email</ion-label>
            <ion-input
              type="email"
              formControlName="email"
              placeholder="seu@email.com"
              autocomplete="email">
            </ion-input>
          </ion-item>
          <div class="error-message" *ngIf="loginForm.get('email')?.invalid && loginForm.get('email')?.touched">
            <ion-text color="danger">
              <small>Email válido é obrigatório</small>
            </ion-text>
          </div>

          <ion-item>
            <ion-label position="floating">Senha</ion-label>
            <ion-input
              type="password"
              formControlName="password"
              placeholder="Digite sua senha"
              autocomplete="current-password">
            </ion-input>
          </ion-item>
          <div class="error-message" *ngIf="loginForm.get('password')?.invalid && loginForm.get('password')?.touched">
            <ion-text color="danger">
              <small>Senha é obrigatória</small>
            </ion-text>
          </div>

          <ion-button
            expand="block"
            type="submit"
            [disabled]="loginForm.invalid || loading"
            class="submit-button">
            <ion-spinner *ngIf="loading" name="crescent"></ion-spinner>
            <span *ngIf="!loading">Entrar</span>
          </ion-button>
        </form>

        <div class="register-link">
          <ion-text>
            Não tem uma conta?
            <a routerLink="/mobile/register">Criar conta</a>
          </ion-text>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .login-container {
      max-width: 500px;
      margin: 0 auto;
      padding-top: 2rem;
    }

    .logo-section {
      text-align: center;
      margin: 2rem 0 3rem;
    }

    .logo-section ion-icon {
      font-size: 80px;
      margin-bottom: 1rem;
    }

    .logo-section h2 {
      margin: 0.5rem 0;
      color: var(--ion-color-primary);
      font-weight: 700;
      font-size: 2rem;
    }

    .logo-section p {
      color: var(--ion-color-medium);
      margin: 0.5rem 0 0;
    }

    ion-item {
      --padding-start: 0;
      --inner-padding-end: 0;
      margin-bottom: 0.5rem;
    }

    .error-message {
      padding: 0.25rem 0 0.5rem;
    }

    .submit-button {
      margin-top: 2rem;
      height: 48px;
      font-weight: 600;
    }

    .register-link {
      text-align: center;
      margin-top: 2rem;
    }

    .register-link a {
      color: var(--ion-color-primary);
      font-weight: 600;
      text-decoration: none;
      margin-left: 0.5rem;
    }
  `]
})
export class MobileLoginComponent {
  loginForm: FormGroup;
  loading = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private toastController: ToastController
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required]
    });
  }

  async onSubmit() {
    if (this.loginForm.invalid) return;

    this.loading = true;

    try {
      await this.authService.signIn(
        this.loginForm.value.email,
        this.loginForm.value.password
      );

      const toast = await this.toastController.create({
        message: 'Login realizado com sucesso!',
        duration: 2000,
        color: 'success',
        position: 'top'
      });
      await toast.present();

      this.router.navigate(['/mobile/dashboard']);
    } catch (error: any) {
      const toast = await this.toastController.create({
        message: error.message || 'Erro ao fazer login',
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    } finally {
      this.loading = false;
    }
  }
}
