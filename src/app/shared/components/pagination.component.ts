import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface PageChangeEvent {
  page: number;
  pageSize: number;
}

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-3">
      <!-- Info & Page Size Selector -->
      <div class="flex items-center gap-3 text-sm text-gray-600">
        <span class="text-xs text-gray-500 font-medium">
          {{ startItem }}–{{ endItem }} de {{ totalItems }}
        </span>
        <div class="flex items-center gap-2 border-l border-gray-200 pl-3">
          <label for="pageSize" class="text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">
            Registos/página
          </label>
          <select
            id="pageSize"
            [ngModel]="currentPageSize"
            (ngModelChange)="onPageSizeChange($event)"
            class="px-2 py-1 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer hover:border-gray-300 transition-colors">
            <option *ngFor="let opt of pageSizeOptions" [ngValue]="opt">{{ opt }}</option>
          </select>
        </div>
      </div>

      <!-- Navigation Controls -->
      <div class="flex items-center gap-1">
        <!-- First Page -->
        <button
          (click)="goToPage(1)"
          [disabled]="currentPage === 1"
          class="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          title="Primeira página">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>

        <!-- Previous -->
        <button
          (click)="goToPage(currentPage - 1)"
          [disabled]="currentPage === 1"
          class="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          title="Página anterior">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7 7" />
          </svg>
        </button>

        <!-- Page Numbers -->
        <ng-container *ngFor="let p of visiblePages">
          <button
            *ngIf="p !== '...'"
            (click)="goToPage(+p)"
            [class]="currentPage === +p
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-200'
              : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-800'"
            class="min-w-[32px] h-8 px-2 rounded-lg border text-sm font-semibold transition-all">
            {{ p }}
          </button>
          <span *ngIf="p === '...'" class="min-w-[32px] h-8 flex items-center justify-center text-gray-400 text-sm select-none">
            …
          </span>
        </ng-container>

        <!-- Next -->
        <button
          (click)="goToPage(currentPage + 1)"
          [disabled]="currentPage === totalPages"
          class="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          title="Próxima página">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Last Page -->
        <button
          (click)="goToPage(totalPages)"
          [disabled]="currentPage === totalPages"
          class="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          title="Última página">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  `
})
export class PaginationComponent implements OnInit, OnChanges {
  @Input() totalItems = 0;
  @Input() pageSizeOptions: number[] = [10, 20, 50];
  @Input() defaultPageSize = 10;

  @Output() pageChange = new EventEmitter<PageChangeEvent>();

  currentPage = 1;
  currentPageSize = 10;
  totalPages = 1;
  visiblePages: (number | string)[] = [];

  get startItem(): number {
    if (this.totalItems === 0) return 0;
    return (this.currentPage - 1) * this.currentPageSize + 1;
  }

  get endItem(): number {
    return Math.min(this.currentPage * this.currentPageSize, this.totalItems);
  }

  ngOnInit(): void {
    this.currentPageSize = this.defaultPageSize;
    this.recalculate();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['totalItems'] || changes['defaultPageSize']) {
      if (changes['defaultPageSize'] && !changes['defaultPageSize'].firstChange) {
        this.currentPageSize = changes['defaultPageSize'].currentValue;
      }
      this.recalculate();
    }
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.currentPage = page;
    this.buildVisiblePages();
    this.emitChange();
  }

  onPageSizeChange(newSize: number): void {
    this.currentPageSize = newSize;
    this.currentPage = 1;
    this.recalculate();
    this.emitChange();
  }

  private recalculate(): void {
    this.totalPages = Math.max(1, Math.ceil(this.totalItems / this.currentPageSize));
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
    this.buildVisiblePages();
  }

  private buildVisiblePages(): void {
    const pages: (number | string)[] = [];
    const total = this.totalPages;
    const current = this.currentPage;

    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (current > 3) pages.push('...');

      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);
      for (let i = start; i <= end; i++) pages.push(i);

      if (current < total - 2) pages.push('...');
      pages.push(total);
    }

    this.visiblePages = pages;
  }

  private emitChange(): void {
    this.pageChange.emit({
      page: this.currentPage,
      pageSize: this.currentPageSize
    });
  }
}
