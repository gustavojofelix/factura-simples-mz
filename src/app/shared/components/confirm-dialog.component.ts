import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (dialog.dialogState().open) {
      <div class="fixed inset-0 z-[9998] flex items-center justify-center p-4">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" (click)="dialog.resolve(false)"></div>
        <!-- Dialog -->
        <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
          <div class="p-6">
            <!-- Icon -->
            <div class="flex items-center gap-4 mb-4">
              <div class="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                   [class]="dialog.dialogState().danger ? 'bg-rose-100' : 'bg-blue-100'">
                @if (dialog.dialogState().danger) {
                  <svg class="w-6 h-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                  </svg>
                } @else {
                  <svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                }
              </div>
              <div>
                <h3 class="text-lg font-bold text-gray-900">{{ dialog.dialogState().title }}</h3>
              </div>
            </div>
            <p class="text-sm text-gray-600 ml-16">{{ dialog.dialogState().message }}</p>
          </div>
          <div class="px-6 pb-6 flex gap-3">
            <button
              (click)="dialog.resolve(false)"
              class="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors">
              {{ dialog.dialogState().cancelLabel || 'Cancelar' }}
            </button>
            <button
              (click)="dialog.resolve(true)"
              class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-colors shadow-lg"
              [class]="dialog.dialogState().danger ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'">
              {{ dialog.dialogState().confirmLabel || 'Confirmar' }}
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class ConfirmDialogComponent {
  dialog = inject(ConfirmDialogService);
}
