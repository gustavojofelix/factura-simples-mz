import { Component, OnDestroy, computed, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { POS_COUNTER_CART, PosService } from '../../core/services/pos.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatPosMoney } from './pos-format';

/** Planta de mesas por zona: livres, ocupadas (com total, tempo e empregado) e por enviar. */
@Component({
  selector: 'app-pos-tables',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="h-full overflow-y-auto custom-scrollbar px-4 sm:px-6 py-4 pb-8">
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <button type="button" class="pos-chip" [class.pos-chip-active]="zone() === 'all'" (click)="zone.set('all')">
          <i class="fa-solid fa-border-all" aria-hidden="true"></i> {{ 'pos.tables.allZones' | t }}
        </button>
        @for (z of pos.zones(); track z.id) {
          <button type="button" class="pos-chip" [class.pos-chip-active]="zone() === z.id" (click)="zone.set(z.id)">
            <i class="fa-solid {{ z.icon }}" aria-hidden="true"></i> {{ z.name }}
          </button>
        }
        <span class="ml-auto flex items-center gap-3 text-xs text-slate-500">
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>{{ 'pos.tables.free' | t }} {{ freeCount() }}</span>
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-ispc-orange"></span>{{ 'pos.tables.busy' | t }} {{ busyCount() }}</span>
        </span>
      </div>

      <div class="tables-grid">
        <!-- Balcão / take-away -->
        <button type="button" class="table-card counter" (click)="open.emit(counter)">
          <i class="fa-solid fa-bag-shopping text-2xl" aria-hidden="true"></i>
          <span class="font-bold">{{ 'pos.tables.counter' | t }}</span>
          <span class="text-xs opacity-80">{{ 'pos.tables.counterHint' | t }}</span>
        </button>

        @for (table of visible(); track table.id) {
          @let order = pos.tableOrders()[table.id];
          @let unsent = unsentFor(table.id);
          <button type="button" class="table-card" [class.busy]="order" (click)="open.emit(table.id)">
            <span class="flex items-start justify-between w-full">
              <span class="text-2xl font-extrabold leading-none">{{ table.name }}</span>
              <span class="text-[11px] font-semibold opacity-70"><i class="fa-solid fa-chair" aria-hidden="true"></i> {{ order?.covers ?? table.seats }}</span>
            </span>
            @if (order) {
              <span class="mt-auto font-bold">{{ money(pos.tableTotal(table.id)) }}</span>
              <span class="text-[11px] opacity-80 flex items-center gap-1 w-full">
                <i class="fa-regular fa-clock" aria-hidden="true"></i> {{ elapsed(order.opened_at) }}
                <span class="truncate">· {{ firstName(order.waiter_id) }}</span>
              </span>
              @if (unsent > 0) {
                <span class="unsent">{{ 'pos.tables.unsent' | t: { count: unsent } }}</span>
              }
            } @else {
              <span class="mt-auto text-xs font-semibold text-emerald-700">{{ 'pos.tables.free' | t }}</span>
            }
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .tables-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; }
    .table-card {
      position: relative; min-height: 124px; padding: 14px; border-radius: 20px; text-align: left;
      display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
      background: #fff; border: 2px solid #d1fae5; color: #0f172a; touch-action: manipulation;
      transition: transform .08s ease, box-shadow .15s ease;
    }
    .table-card:active { transform: scale(.97); }
    .table-card:hover { box-shadow: 0 10px 24px -14px rgb(15 23 42 / .4); }
    .table-card.busy { background: #fff4ee; border-color: #f16c39; }
    .table-card.counter { background: #0f172a; border-color: #0f172a; color: #fff; justify-content: center; align-items: center; text-align: center; }
    .unsent {
      position: absolute; top: -8px; right: -6px; padding: 2px 8px; border-radius: 999px;
      background: #e11d48; color: #fff; font-size: 10px; font-weight: 800; box-shadow: 0 4px 10px -4px #e11d48;
    }
  `]
})
export class PosTablesComponent implements OnDestroy {
  open = output<string>();
  readonly counter = POS_COUNTER_CART;
  zone = signal<string>('all');
  /** Relógio para o tempo de ocupação das mesas. */
  private now = signal(Date.now());
  private timer = setInterval(() => this.now.set(Date.now()), 30_000);

  visible = computed(() => this.pos.tables().filter(t => this.zone() === 'all' || t.zone_id === this.zone()));
  busyCount = computed(() => this.visible().filter(t => this.pos.tableOrders()[t.id]).length);
  freeCount = computed(() => this.visible().length - this.busyCount());

  constructor(public pos: PosService) {}

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  money(v: number) { return formatPosMoney(v); }

  firstName(id: string) {
    return this.pos.seller(id)?.name.split(' ')[0] ?? '';
  }

  unsentFor(tableId: string): number {
    return (this.pos.carts()[tableId] ?? []).reduce((sum, l) => sum + Math.max(0, l.quantity - (l.sent ?? 0)), 0);
  }

  elapsed(iso: string): string {
    const minutes = Math.max(0, Math.round((this.now() - new Date(iso).getTime()) / 60_000));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
  }
}
