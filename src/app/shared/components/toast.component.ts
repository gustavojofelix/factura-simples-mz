import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, ToastMessage } from '../../core/services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed top-4 right-4 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none" aria-live="polite">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-start gap-3 p-4 rounded-xl shadow-xl border backdrop-blur-sm animate-in slide-in-from-right-4 duration-300"
          [class]="getClasses(toast)">
          <!-- Icon -->
          <div class="flex-shrink-0 mt-0.5">
            @if (toast.type === 'success') {
              <svg class="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            }
            @if (toast.type === 'error') {
              <svg class="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            }
            @if (toast.type === 'warning') {
              <svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
            }
            @if (toast.type === 'info') {
              <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            }
          </div>
          <!-- Content -->
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold" [class]="getTitleClass(toast)">{{ toast.title }}</p>
            @if (toast.message) {
              <p class="text-xs mt-0.5 opacity-80">{{ toast.message }}</p>
            }
          </div>
          <!-- Dismiss -->
          <button (click)="toastService.dismiss(toast.id)" class="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      }
    </div>
  `
})
export class ToastComponent {
  toastService = inject(ToastService);

  getClasses(toast: ToastMessage): string {
    const map: Record<string, string> = {
      success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
      error:   'bg-rose-50 border-rose-200 text-rose-900',
      warning: 'bg-amber-50 border-amber-200 text-amber-900',
      info:    'bg-blue-50 border-blue-200 text-blue-900'
    };
    return map[toast.type] ?? map['info'];
  }

  getTitleClass(toast: ToastMessage): string {
    const map: Record<string, string> = {
      success: 'text-emerald-800',
      error:   'text-rose-800',
      warning: 'text-amber-800',
      info:    'text-blue-800'
    };
    return map[toast.type] ?? '';
  }
}
