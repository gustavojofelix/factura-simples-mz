import { Injectable, signal } from '@angular/core';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ConfirmDialogService {
  private resolveRef!: (value: boolean) => void;

  dialogState = signal<ConfirmDialogOptions & { open: boolean }>({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirmar',
    cancelLabel: 'Cancelar',
    danger: false
  });

  async confirm(options: ConfirmDialogOptions): Promise<boolean> {
    this.dialogState.set({ ...options, open: true });
    return new Promise(resolve => { this.resolveRef = resolve; });
  }

  resolve(value: boolean): void {
    this.dialogState.update(s => ({ ...s, open: false }));
    this.resolveRef?.(value);
  }
}
