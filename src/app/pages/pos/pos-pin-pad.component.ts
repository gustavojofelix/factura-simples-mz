import { Component, HostListener, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

const PIN_LENGTH = 4;

/** Teclado numérico de PIN, pensado para ecrã tátil (e teclado físico). */
@Component({
  selector: 'app-pos-pin-pad',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="flex justify-center gap-4 mb-6" [class.pin-shake]="shake()" aria-live="polite">
      @for (i of slots; track i) {
        <span class="w-4 h-4 rounded-full border-2 transition-colors"
          [class.bg-slate-900]="value().length > i" [class.border-slate-900]="value().length > i"
          [class.border-slate-300]="value().length <= i"
          [class.!bg-rose-500]="shake()" [class.!border-rose-500]="shake()"></span>
      }
    </div>
    <div class="grid grid-cols-3 gap-3 max-w-[300px] mx-auto">
      @for (key of keys; track key) {
        <button type="button" class="pin-key" (click)="press(key)">{{ key }}</button>
      }
      <button type="button" class="pin-key !text-base !text-slate-500" (click)="clear()" [attr.aria-label]="'pos.pin.clear' | t">C</button>
      <button type="button" class="pin-key" (click)="press('0')">0</button>
      <button type="button" class="pin-key !text-slate-500" (click)="back()" [attr.aria-label]="'pos.pin.back' | t">
        <i class="fa-solid fa-delete-left" aria-hidden="true"></i>
      </button>
    </div>
  `,
  styles: [`
    .pin-key {
      height: 64px; border-radius: 18px; background: #fff; border: 1px solid #e2e8f0;
      font-size: 24px; font-weight: 700; color: #0f172a; touch-action: manipulation;
      transition: background .12s ease, transform .08s ease;
    }
    .pin-key:active { background: #fff1ea; transform: scale(.96); }
    .pin-shake { animation: shake .4s ease; }
    @keyframes shake { 0%,100% { transform: none; } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
  `]
})
export class PosPinPadComponent {
  /** Emite o PIN completo; o pai valida e chama reject() se estiver errado. */
  completed = output<string>();
  disabled = input(false);

  readonly slots = Array.from({ length: PIN_LENGTH }, (_, i) => i);
  readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  value = signal('');
  shake = signal(false);

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent) {
    if (this.disabled()) return;
    if (/^\d$/.test(event.key)) this.press(event.key);
    else if (event.key === 'Backspace') this.back();
  }

  press(digit: string) {
    if (this.disabled() || this.value().length >= PIN_LENGTH) return;
    this.value.update(v => v + digit);
    if (this.value().length === PIN_LENGTH) {
      const pin = this.value();
      setTimeout(() => this.completed.emit(pin), 120);
    }
  }

  back() {
    this.value.update(v => v.slice(0, -1));
  }

  clear() {
    this.value.set('');
  }

  reject() {
    this.shake.set(true);
    setTimeout(() => { this.shake.set(false); this.value.set(''); }, 450);
  }
}
