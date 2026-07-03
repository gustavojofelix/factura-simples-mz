import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProductService } from './product.service';
import { ClientService } from './client.service';

// ─── Action Types ────────────────────────────────────────────────────────────

export type AIActionType =
  | 'CREATE_PRODUCTS'
  | 'CREATE_CLIENTS'
  | 'NAVIGATE'
  | 'FILTER_DATA'
  | 'GENERATE_REPORT';

export interface AIActionItem {
  type: AIActionType;
  payload: any;              // action-specific data
  label: string;             // human-readable e.g. "Criar 12 produtos de electrónica"
  requiresConfirmation: boolean;
  status?: 'pending' | 'executing' | 'done' | 'error';
  result?: any;
}

// ─── Payload Shapes (for documentation / strong-typing internally) ────────────

interface CreateProductPayloadItem {
  name: string;
  description?: string;
  price: number;
  type: 'produto' | 'servico';
  unit?: string;
  code?: string;
  stock?: number;
  is_active?: boolean;
}

interface CreateClientPayloadItem {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  industry?: string;
  nuit?: string;
  client_code?: string;
  is_active?: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({
  providedIn: 'root'
})
export class AiActionsService {

  private productService = inject(ProductService);
  private clientService  = inject(ClientService);
  private router         = inject(Router);
  private snackBar       = inject(MatSnackBar);

  /** Actions that are waiting for user confirmation before execution. */
  pendingActions = signal<AIActionItem[]>([]);

  /** True while any action is being executed. */
  isExecuting = signal<boolean>(false);

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Replace the pending actions queue with a new set from the AI. */
  setPendingActions(actions: AIActionItem[]): void {
    const initialised = actions.map(a => ({ ...a, status: 'pending' as const }));
    this.pendingActions.set(initialised);
  }

  /** Dismiss all pending actions without executing them. */
  clearPendingActions(): void {
    this.pendingActions.set([]);
  }

  /**
   * Execute all currently pending actions.
   * Convenience wrapper around `executeActions`.
   */
  async executeAll(): Promise<string> {
    return this.executeActions(this.pendingActions());
  }

  /**
   * Execute the supplied action items in sequence, updating status signals
   * as each action transitions through executing → done | error.
   *
   * @returns A human-readable summary of what was accomplished.
   */
  async executeActions(actions: AIActionItem[]): Promise<string> {
    if (actions.length === 0) return 'Nenhuma acção para executar.';

    this.isExecuting.set(true);
    const summaryParts: string[] = [];

    for (const action of actions) {
      // Mark as executing in the pending list
      this._updateActionStatus(action, 'executing');

      try {
        const result = await this._dispatchAction(action);
        action.result = result;
        this._updateActionStatus(action, 'done');
        summaryParts.push(result);
      } catch (err: any) {
        console.error(`[AiActionsService] Erro ao executar acção ${action.type}:`, err);
        action.result = err?.message ?? 'Erro desconhecido';
        this._updateActionStatus(action, 'error');
        summaryParts.push(`❌ ${action.label}: ${action.result}`);
      }
    }

    this.isExecuting.set(false);

    const summary = summaryParts.join('\n');
    return summary;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Route an action to the correct handler. */
  private async _dispatchAction(action: AIActionItem): Promise<string> {
    switch (action.type) {

      case 'CREATE_PRODUCTS':
        return this._createProducts(action);

      case 'CREATE_CLIENTS':
        return this._createClients(action);

      case 'NAVIGATE':
        return this._navigate(action);

      case 'FILTER_DATA':
        // FILTER_DATA is informational — the chatbot component handles actual UI
        // filtering via query params or service state; here we just acknowledge.
        return `🔍 Filtro aplicado: ${action.label}`;

      case 'GENERATE_REPORT':
        // GENERATE_REPORT navigates to the reports section with context payload
        this.router.navigate(['/reports'], { queryParams: action.payload ?? {} });
        return `📊 Relatório solicitado: ${action.label}`;

      default:
        throw new Error(`Tipo de acção desconhecido: ${(action as any).type}`);
    }
  }

  /** CREATE_PRODUCTS — create each item in payload.products[] */
  private async _createProducts(action: AIActionItem): Promise<string> {
    const products: CreateProductPayloadItem[] = action.payload?.products ?? [];
    if (products.length === 0) throw new Error('Nenhum produto na lista.');

    let successCount = 0;
    let errorCount   = 0;

    for (const p of products) {
      const created = await this.productService.createProduct({
        code:       p.code        ?? '',   // DB trigger assigns real code
        name:       p.name,
        description: p.description,
        price:      p.price       ?? 0,
        type:       p.type        ?? 'produto',
        unit:       p.unit,
        stock:      p.stock,
        is_active:  p.is_active   ?? true
      });

      if (created) {
        successCount++;
      } else {
        errorCount++;
      }
    }

    const parts: string[] = [];
    if (successCount > 0) parts.push(`✅ ${successCount} produto(s) criado(s)`);
    if (errorCount   > 0) parts.push(`❌ ${errorCount} produto(s) com erro`);
    return parts.join(', ');
  }

  /** CREATE_CLIENTS — create each item in payload.clients[] */
  private async _createClients(action: AIActionItem): Promise<string> {
    const clients: CreateClientPayloadItem[] = action.payload?.clients ?? [];
    if (clients.length === 0) throw new Error('Nenhum cliente na lista.');

    let successCount = 0;
    let errorCount   = 0;

    for (const c of clients) {
      const created = await this.clientService.createClient({
        client_code: c.client_code ?? '',   // DB trigger assigns real code
        name:        c.name,
        email:       c.email,
        phone:       c.phone,
        address:     c.address,
        industry:    c.industry,
        nuit:        c.nuit,
        is_active:   c.is_active ?? true
      });

      if (created) {
        successCount++;
      } else {
        errorCount++;
      }
    }

    const parts: string[] = [];
    if (successCount > 0) parts.push(`✅ ${successCount} cliente(s) criado(s)`);
    if (errorCount   > 0) parts.push(`❌ ${errorCount} cliente(s) com erro`);
    return parts.join(', ');
  }

  /** NAVIGATE — route to a page */
  private async _navigate(action: AIActionItem): Promise<string> {
    const route: string = action.payload?.route ?? '/';
    await this.router.navigate([route]);
    return `🧭 Navegado para ${route}`;
  }

  /**
   * Mutate the status of a specific action inside the `pendingActions` signal.
   * We match by reference (object identity) since actions live in-memory.
   */
  private _updateActionStatus(
    target: AIActionItem,
    status: AIActionItem['status']
  ): void {
    target.status = status;
    // Trigger signal update by spreading into a new array
    this.pendingActions.update(list =>
      list.map(a => (a === target ? { ...a, status } : a))
    );
  }
}
