import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { LegalDialogComponent } from '../../shared/components/legal-dialog.component';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule
  ],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {
  registerForm: FormGroup;
  isLoading = signal(false);
  hidePassword = signal(true);
  hideConfirmPassword = signal(true);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {
    this.registerForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.pattern(/^\+?258\s?\d{2}\s?\d{3}\s?\d{4}$/)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      acceptTerms: [false, [Validators.requiredTrue]]
    }, {
      validators: this.passwordMatchValidator
    });
  }

  private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password');
    const confirmPassword = control.get('confirmPassword');

    if (!password || !confirmPassword) {
      return null;
    }

    return password.value === confirmPassword.value ? null : { passwordMismatch: true };
  }

  async onSubmit() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);

    const { fullName, email, phone, password } = this.registerForm.value;
    const result = await this.authService.signUp(email, password, fullName, phone);

    this.isLoading.set(false);

    if (result.success) {
      this.snackBar.open('Conta criada com sucesso!', 'Fechar', {
        duration: 3000,
        panelClass: ['success-snackbar']
      });

      this.router.navigate(['/configurar-empresa']);
    } else {
      this.snackBar.open(result.error || 'Erro ao criar conta', 'Fechar', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }

  formatPhone() {
    const phoneControl = this.registerForm.get('phone');
    if (!phoneControl) return;

    let value = phoneControl.value.replace(/\D/g, '');

    if (value.startsWith('258')) {
      value = value.substring(3);
    }

    if (value.length <= 2) {
      phoneControl.setValue(value ? `+258 ${value}` : '');
    } else if (value.length <= 5) {
      phoneControl.setValue(`+258 ${value.substring(0, 2)} ${value.substring(2)}`);
    } else if (value.length <= 9) {
      phoneControl.setValue(`+258 ${value.substring(0, 2)} ${value.substring(2, 5)} ${value.substring(5)}`);
    } else {
      phoneControl.setValue(`+258 ${value.substring(0, 2)} ${value.substring(2, 5)} ${value.substring(5, 9)}`);
    }
  }

  getErrorMessage(field: string): string {
    const control = this.registerForm.get(field);
    if (!control || !control.touched) return '';

    if (control.hasError('required')) {
      return 'Este campo é obrigatório';
    }
    if (control.hasError('email')) {
      return 'Email inválido';
    }
    if (control.hasError('minlength')) {
      const minLength = control.getError('minlength').requiredLength;
      return `Mínimo de ${minLength} caracteres`;
    }
    if (control.hasError('pattern') && field === 'phone') {
      return 'Formato: +258 XX XXX XXXX';
    }
    if (field === 'confirmPassword' && this.registerForm.hasError('passwordMismatch')) {
      return 'As palavras-passe não coincidem';
    }
    return '';
  }

  openTerms(event: Event) {
    event.preventDefault();
    this.dialog.open(LegalDialogComponent, {
      width: '100vw',
      maxWidth: '100vw',
      height: '100vh',
      panelClass: 'full-screen-dialog',
      data: {
        title: 'Termos de Uso',
        content: `
          <h1>Termos e Condições de Uso</h1>
          <p>Bem-vindo ao Factura Simples MZ. Ao utilizar nossa plataforma, você concorda com os seguintes termos:</p>
          
          <h2>1. Aceitação dos Termos</h2>
          <p>Ao se cadastrar e utilizar nossos serviços, você aceita integralmente as condições aqui estabelecidas.</p>
          
          <h2>2. Descrição do Serviço</h2>
          <p>O Factura Simples MZ é uma ferramenta de gestão de facturação e impostos (ISPC) para pequenas empresas e empreendedores em Moçambique.</p>
          
          <h2>3. Responsabilidades do Usuário</h2>
          <ul>
            <li>Fornecer informações verdadeiras e actualizadas.</li>
            <li>Manter a confidencialidade de suas credenciais de acesso.</li>
            <li>Utilizar o sistema em conformidade com as leis moçambicanas.</li>
          </ul>

          <h2>4. Limitação de Responsabilidade</h2>
          <p>O sistema é uma ferramenta de auxílio. A responsabilidade final pela veracidade das declarações fiscais e pagamentos é do contribuinte.</p>

          <h2>5. Alterações nos Termos</h2>
          <p>Reservamo-nos o direito de alterar estes termos a qualquer momento, notificando os usuários através da plataforma.</p>
        `
      }
    });
  }

  openPrivacy(event: Event) {
    event.preventDefault();
    this.dialog.open(LegalDialogComponent, {
      width: '100vw',
      maxWidth: '100vw',
      height: '100vh',
      panelClass: 'full-screen-dialog',
      data: {
        title: 'Política de Privacidade',
        content: `
          <h1>Política de Privacidade</h1>
          <p>A sua privacidade é importante para nós. Esta política explica como recolhemos e protegemos os seus dados.</p>
          
          <h2>1. Recolha de Dados</h2>
          <p>Recolhemos dados como nome, email, telefone e dados da sua empresa para fins de facturação e gestão fiscal.</p>
          
          <h2>2. Uso das Informações</h2>
          <p>As informações são utilizadas para:</p>
          <ul>
            <li>Processar sua facturação.</li>
            <li>Calcular seus impostos (ISPC).</li>
            <li>Comunicação sobre a sua conta.</li>
          </ul>

          <h2>3. Proteção de Dados</h2>
          <p>Implementamos medidas de segurança técnicas para proteger os seus dados contra acessos não autorizados.</p>

          <h2>4. Compartilhamento de Informações</h2>
          <p>Não compartilhamos os seus dados pessoais ou empresariais com terceiros, excepto quando exigido por lei (Autoridade Tributária).</p>

          <h2>5. Seus Direitos</h2>
          <p>Você tem o direito de aceder, rectificar ou solicitar a eliminação dos seus dados a qualquer momento através das definições da sua conta.</p>
        `
      }
    });
  }
}
