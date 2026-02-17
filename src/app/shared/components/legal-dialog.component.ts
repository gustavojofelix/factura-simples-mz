import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-legal-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="flex flex-col h-screen w-screen overflow-hidden bg-white">
      <div class="flex justify-between items-center p-4 border-b bg-gray-50 flex-none">
        <h2 class="text-xl font-bold">{{ data.title }}</h2>
        <button mat-icon-button (click)="dialogRef.close()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-8 prose max-w-4xl mx-auto w-full">
        <div [innerHTML]="data.content"></div>
      </div>

      <div class="p-4 border-t bg-gray-50 flex justify-end flex-none">
        <button mat-raised-button color="primary" (click)="dialogRef.close()" class="!bg-ispc-orange !text-white">
          Fechar
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100vh;
      width: 100vw;
    }
    
    .prose h1 { @apply text-2xl font-bold mb-4 mt-6; }
    .prose h2 { @apply text-xl font-bold mb-3 mt-5; }
    .prose p { @apply mb-4 text-gray-700 leading-relaxed; }
    .prose ul { @apply list-disc ml-6 mb-4 space-y-2; }
    .prose ol { @apply list-decimal ml-6 mb-4 space-y-2; }
  `]
})
export class LegalDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<LegalDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { title: string, content: string }
  ) {}
}
