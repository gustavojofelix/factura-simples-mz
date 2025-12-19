import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-mobile-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, RouterModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Criar Conta</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="register-container">
        <div class="logo-section">
          <ion-icon name="receipt-outline" size="large" color="primary"></ion-icon>
          <h2>Bem-vindo ao InvoiceHub</h2>
          <p>Crie sua conta para começar</p>
        </div>

        <form [formGroup]="registerForm" (ngSubmit)="onSubmit()">
          <ion-item>
            <ion-label position="floating">Nome Completo</ion-label>
            <ion-input
              type="text"
              formControlName="fullName"
              placeholder="Digite seu nome completo">
            </ion-input>
          </ion-item>
          <div class="error-message" *ngIf="registerForm.get('fullName')?.invalid && registerForm.get('fullName')?.touched">
            <ion-text color="danger">
              <small>Nome é obrigatório</small>
            </ion-text>
          </div>

          <ion-item>
            <ion-label position="floating">Email</ion-label>
            <ion-input
              type="email"
              formControlName="email"
              placeholder="seu@email.com">
            </ion-input>
          </ion-item>
          <div class="error-message" *ngIf="registerForm.get('email')?.invalid && registerForm.get('email')?.touched">
            <ion-text color="danger">
              <small>Email válido é obrigatório</small>
            </ion-text>
          </div>

          <ion-item>
            <ion-label position="floating">Telefone</ion-label>
            <ion-input
              type="tel"
              formControlName="phone"
              placeholder="+258 84 123 4567">
            </ion-input>
          </ion-item>
          <div class="error-message" *ngIf="registerForm.get('phone')?.invalid && registerForm.get('phone')?.touched">
            <ion-text color="danger">
              <small>Telefone é obrigatório</small>
            </ion-text>
          </div>

          <ion-item>
            <ion-label position="floating">NUIT</ion-label>
            <ion-input
              type="text"
              formControlName="nuit"
              placeholder="123456789">
            </ion-input>
          </ion-item>
          <div class="error-message" *ngIf="registerForm.get('nuit')?.invalid && registerForm.get('nuit')?.touched">
            <ion-text color="danger">
              <small>NUIT deve ter 9 dígitos</small>
            </ion-text>
          </div>

          <ion-item>
            <ion-label position="floating">Senha</ion-label>
            <ion-input
              type="password"
              formControlName="password"
              placeholder="Mínimo 6 caracteres">
            </ion-input>
          </ion-item>
          <div class="error-message" *ngIf="registerForm.get('password')?.invalid && registerForm.get('password')?.touched">
            <ion-text color="danger">
              <small>Senha deve ter no mínimo 6 caracteres</small>
            </ion-text>
          </div>

          <ion-item>
            <ion-label position="floating">Confirmar Senha</ion-label>
            <ion-input
              type="password"
              formControlName="confirmPassword"
              placeholder="Digite a senha novamente">
            </ion-input>
          </ion-item>
          <div class="error-message" *ngIf="registerForm.hasError('passwordMismatch') && registerForm.get('confirmPassword')?.touched">
            <ion-text color="danger">
              <small>As senhas não coincidem</small>
            </ion-text>
          </div>

          <ion-button
            expand="block"
            type="submit"
            [disabled]="registerForm.invalid || loading"
            class="submit-button">
            <ion-spinner *ngIf="loading" name="crescent"></ion-spinner>
            <span *ngIf="!loading">Criar Conta</span>
          </ion-button>
        </form>

        <div class="login-link">
          <ion-text>
            Já tem uma conta?
            <a routerLink="/mobile/login">Entrar</a>
          </ion-text>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .register-container {
      max-width: 500px;
      margin: 0 auto;
    }

    .logo-section {
      text-align: center;
      margin: 2rem 0 3rem;
    }

    .logo-section ion-icon {
      font-size: 64px;
      margin-bottom: 1rem;
    }

    .logo-section h2 {
      margin: 0.5rem 0;
      color: var(--ion-color-primary);
      font-weight: 600;
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

    .login-link {
      text-align: center;
      margin-top: 2rem;
    }

    .login-link a {
      color: var(--ion-color-primary);
      font-weight: 600;
      text-decoration: none;
      margin-left: 0.5rem;
    }
  `]
})
export class MobileRegisterComponent {
  registerForm: FormGroup;
  loading = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private toastController: ToastController
  ) {
    this.registerForm = this.fb.group({
      fullName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', Validators.required],
      nuit: ['', [Validators.required, Validators.pattern(/^\d{9}$/)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required]
    }, { validators: this.passwordMatchValidator });
  }

  passwordMatchValidator(g: FormGroup) {
    return g.get('password')?.value === g.get('confirmPassword')?.value
      ? null : { passwordMismatch: true };
  }

  async onSubmit() {
    if (this.registerForm.invalid) return;

    this.loading = true;

    try {
      const { confirmPassword, ...userData } = this.registerForm.value;

      const result = await this.authService.signUp(
        userData.email,
        userData.password,
        userData.fullName,
        userData.phone
      );

      if (!result.success) {
        throw new Error(result.error);
      }

      const toast = await this.toastController.create({
        message: 'Conta criada com sucesso!',
        duration: 2000,
        color: 'success',
        position: 'top'
      });
      await toast.present();

      this.router.navigate(['/mobile/company-setup']);
    } catch (error: any) {
      const toast = await this.toastController.create({
        message: error.message || 'Erro ao criar conta',
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
