import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../core/services/auth.service';

@Component({
    selector: 'app-profile',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        MatCardModule,
        MatProgressSpinnerModule,
        MatSnackBarModule
    ],
    templateUrl: './profile.component.html'
})
export class ProfileComponent implements OnInit {
    profileForm: FormGroup;
    isLoading = signal(false);
    hideCurrentPassword = signal(true);
    hidePassword = signal(true);
    hideConfirmPassword = signal(true);

    constructor(
        private fb: FormBuilder,
        private authService: AuthService,
        private snackBar: MatSnackBar
    ) {
        this.profileForm = this.fb.group({
            fullName: ['', [Validators.required, Validators.minLength(3)]],
            email: [{ value: '', disabled: true }, [Validators.required, Validators.email]],
            phone: ['', [Validators.pattern(/^\+?258\s?\d{2}\s?\d{3}\s?\d{4}$/)]],
            currentPassword: [''],
            password: ['', [Validators.minLength(6)]],
            confirmPassword: ['']
        }, {
            validators: this.passwordMatchValidator
        });
    }

    ngOnInit() {
        this.loadUserData();
    }

    private loadUserData() {
        const user = this.authService.currentUser();
        if (user) {
            this.profileForm.patchValue({
                fullName: user.user_metadata?.['fullName'] || '',
                email: user.email,
                phone: user.user_metadata?.['phone'] || ''
            });
        }
    }

    private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
        const currentPassword = control.get('currentPassword');
        const password = control.get('password');
        const confirmPassword = control.get('confirmPassword');

        if (password?.value && !currentPassword?.value) {
            return { currentPasswordRequired: true };
        }

        if (!password || !confirmPassword) {
            return null;
        }

        if (password.value && password.value !== confirmPassword.value) {
            return { passwordMismatch: true };
        }

        return null;
    }

    formatPhone() {
        const phoneControl = this.profileForm.get('phone');
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
        const control = this.profileForm.get(field);
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
        if (field === 'currentPassword' && this.profileForm.hasError('currentPasswordRequired')) {
            return 'Precisa informar a palavra-passe atual para definir uma nova';
        }
        if (field === 'confirmPassword' && this.profileForm.hasError('passwordMismatch')) {
            return 'As palavras-passe não coincidem';
        }
        return '';
    }

    async onSubmit() {
        if (this.profileForm.invalid) {
            this.profileForm.markAllAsTouched();
            return;
        }

        this.isLoading.set(true);

        // Obter apenas os dados que devem ser atualizados (ignorando os que não mudaram ou são nulos/vazios)
        const { fullName, phone, currentPassword, password } = this.profileForm.value;

        try {
            // TODO: Implement user profile update in AuthService
            // await this.authService.updateUserProfile({ fullName, phone });

            if (password && currentPassword) {
                // TODO: Implement password update in AuthService
                // await this.authService.updateUserPassword(currentPassword, password);
            }

            this.snackBar.open('Perfil atualizado com sucesso!', 'Fechar', {
                duration: 3000,
                panelClass: ['success-snackbar']
            });

            // Resetar o campo de senha após atualização com sucesso
            this.profileForm.patchValue({
                currentPassword: '',
                password: '',
                confirmPassword: ''
            });
            this.profileForm.get('currentPassword')?.markAsUntouched();
            this.profileForm.get('password')?.markAsUntouched();
            this.profileForm.get('confirmPassword')?.markAsUntouched();

        } catch (error: any) {
            console.error('Erro ao atualizar perfil', error);
            this.snackBar.open(error.message || 'Erro ao atualizar perfil', 'Fechar', {
                duration: 5000,
                panelClass: ['error-snackbar']
            });
        } finally {
            this.isLoading.set(false);
        }
    }
}
