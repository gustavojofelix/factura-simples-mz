import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.css']
})
export class LandingComponent {
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

  async onLoginSubmit() {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);

    const { email, password } = this.loginForm.value;
    const result = await this.authService.signIn(email, password);

    this.isLoading.set(false);

    if (result.success) {
      this.snackBar.open('Bem-vindo de volta!', 'Fechar', {
        duration: 3000,
        panelClass: ['success-snackbar']
      });

      const companies = await this.authService.getUserCompanies();
      if (companies.length === 0) {
        this.router.navigate(['/configurar-empresa']);
      } else {
        this.router.navigate(['/painel']);
      }
    } else {
      this.snackBar.open(result.error || 'Erro ao entrar', 'Fechar', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
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
  features = [
    {
      icon: 'flash_on',
      title: 'Facturação Rápida',
      description: 'Crie facturas em menos de 60 segundos com o nosso sistema de 2 cliques.'
    },
    {
      icon: 'calculate',
      title: 'Cálculo Automático de ISPC',
      description: 'Sistema calcula automaticamente o imposto ISPC baseado nas categorias moçambicanas.'
    },
    {
      icon: 'people',
      title: 'Gestão de Clientes',
      description: 'Mantenha todos os seus clientes organizados com pesquisa inteligente.'
    },
    {
      icon: 'inventory_2',
      title: 'Catálogo de Produtos',
      description: 'Adicione produtos uma vez e reutilize em todas as suas facturas.'
    },
    {
      icon: 'email',
      title: 'Envio Automático',
      description: 'Emita e envie facturas por email automaticamente.'
    },
    {
      icon: 'business',
      title: 'Múltiplas Empresas',
      description: 'Gerencie várias empresas numa única conta.'
    }
  ];

  plans = [
    {
      name: 'Essencial',
      price: '2.500',
      currency: 'MZN',
      period: 'mês',
      features: [
        'Até 100 facturas/mês',
        'Gestão de clientes ilimitada',
        'Cálculo automático de ISPC',
        'Envio de facturas por email',
        '1 empresa',
        'Suporte por email'
      ],
      highlighted: false
    },
    {
      name: 'Profissional',
      price: '5.000',
      currency: 'MZN',
      period: 'mês',
      features: [
        'Facturas ilimitadas',
        'Gestão de clientes ilimitada',
        'Cálculo automático de ISPC',
        'Envio de facturas por email',
        'Até 5 empresas',
        'Relatórios avançados',
        'Suporte prioritário'
      ],
      highlighted: true
    }
  ];
}
