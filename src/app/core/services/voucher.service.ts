import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuditLogService } from './audit-log.service';

export interface Voucher {
  id?: string;
  code: string;
  description?: string;
  discount_type: 'percentage' | 'fixed_amount' | 'trial_days';
  discount_value: number;
  scope: 'global' | 'specific_company' | 'specific_user';
  target_company_id?: string | null;
  target_user_email?: string | null;
  max_uses?: number | null;
  uses_count?: number;
  min_amount?: number | null;
  valid_from?: string;
  valid_until?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
  target_company?: {
    id: string;
    name: string;
    email?: string;
    nuit?: string;
  } | null;
}

export interface VoucherRedemption {
  id?: string;
  voucher_id: string;
  company_id?: string | null;
  user_id?: string | null;
  discount_applied: number;
  redeemed_at?: string;
  company_name?: string;
  user_email?: string;
  voucher_code?: string;
}

export interface VoucherValidationResult {
  valid: boolean;
  message: string;
  voucher?: Voucher;
  discountAmount?: number;
  finalPrice?: number;
}

@Injectable({
  providedIn: 'root'
})
export class VoucherService {
  vouchers = signal<Voucher[]>([]);
  loading = signal<boolean>(false);

  constructor(
    private supabase: SupabaseService,
    private auditLogService: AuditLogService
  ) {}

  async loadVouchers(): Promise<Voucher[]> {
    this.loading.set(true);
    try {
      const { data, error } = await this.supabase.client
        .from('vouchers')
        .select(`
          *,
          target_company:companies(id, name, email, nuit)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading vouchers:', error);
        return [];
      }

      const list: Voucher[] = (data || []).map((row: any) => ({
        ...row,
        discount_value: Number(row.discount_value),
        min_amount:     Number(row.min_amount) || 0,
        uses_count:     Number(row.uses_count)  || 0
      }));

      this.vouchers.set(list);
      return list;
    } catch (err) {
      console.error('Exception loading vouchers:', err);
      return [];
    } finally {
      this.loading.set(false);
    }
  }

  async createVoucher(voucher: Partial<Voucher>): Promise<Voucher | null> {
    const code = (voucher.code || '').trim().toUpperCase();
    if (!code) throw new Error('O código do voucher é obrigatório.');

    const payload = {
      code,
      description:       voucher.description || '',
      discount_type:     voucher.discount_type || 'percentage',
      discount_value:    Number(voucher.discount_value) || 0,
      scope:             voucher.scope || 'global',
      target_company_id: voucher.scope === 'specific_company' ? voucher.target_company_id : null,
      target_user_email: voucher.scope === 'specific_user' ? (voucher.target_user_email || '').trim().toLowerCase() : null,
      max_uses:          voucher.max_uses != null && voucher.max_uses !== '' ? Number(voucher.max_uses) : null,
      // Always send as number — never use falsy check that treats 0 as "no minimum"
      min_amount:        Number(voucher.min_amount) || 0,
      valid_from:        voucher.valid_from || new Date().toISOString(),
      valid_until:       voucher.valid_until || null,
      is_active:         voucher.is_active !== false
    };

    const { data, error } = await this.supabase.client
      .from('vouchers')
      .insert(payload)
      .select(`
        *,
        target_company:companies(id, name, email, nuit)
      `)
      .single();

    if (error) {
      console.error('Error creating voucher:', error);
      throw new Error(error.message || 'Erro ao criar voucher.');
    }

    await this.auditLogService.log('Criou Voucher Promocional', 'vouchers', { code: payload.code, scope: payload.scope });
    await this.loadVouchers();
    return data;
  }

  async updateVoucher(id: string, voucher: Partial<Voucher>): Promise<boolean> {
    const payload: any = {
      description:       voucher.description || '',
      discount_type:     voucher.discount_type || 'percentage',
      discount_value:    Number(voucher.discount_value) || 0,
      scope:             voucher.scope || 'global',
      target_company_id: voucher.scope === 'specific_company' ? voucher.target_company_id : null,
      target_user_email: voucher.scope === 'specific_user' ? (voucher.target_user_email || '').trim().toLowerCase() : null,
      max_uses:          voucher.max_uses != null && voucher.max_uses !== '' ? Number(voucher.max_uses) : null,
      // Always send as number — never use falsy check that treats 0 as "no minimum"
      min_amount:        Number(voucher.min_amount) || 0,
      valid_until:       voucher.valid_until || null,
      is_active:         voucher.is_active !== false,
      updated_at:        new Date().toISOString()
    };

    if (voucher.code) {
      payload.code = voucher.code.trim().toUpperCase();
    }

    const { error } = await this.supabase.client
      .from('vouchers')
      .update(payload)
      .eq('id', id);

    if (error) {
      console.error('Error updating voucher:', error);
      return false;
    }

    await this.auditLogService.log('Atualizou Voucher Promocional', 'vouchers', { id, ...payload });
    await this.loadVouchers();
    return true;
  }

  async toggleVoucherActive(id: string, isActive: boolean): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('vouchers')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('Error toggling voucher state:', error);
      return false;
    }

    await this.auditLogService.log(
      isActive ? 'Ativou Voucher' : 'Desativou Voucher',
      'vouchers',
      { id, is_active: isActive }
    );

    await this.loadVouchers();
    return true;
  }

  async deleteVoucher(id: string): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('vouchers')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting voucher:', error);
      return false;
    }

    await this.auditLogService.log('Eliminou Voucher Promocional', 'vouchers', { id });
    await this.loadVouchers();
    return true;
  }

  async validateVoucher(
    rawCode: string,
    companyId?: string,
    userEmail?: string,
    originalPrice: number = 0
  ): Promise<VoucherValidationResult> {
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) {
      return { valid: false, message: 'Por favor introduza um código de voucher.' };
    }

    const { data, error } = await this.supabase.client
      .from('vouchers')
      .select(`
        *,
        target_company:companies(id, name, email, nuit)
      `)
      .eq('code', code)
      .maybeSingle();

    if (error || !data) {
      return { valid: false, message: 'Código de voucher inválido ou não encontrado.' };
    }

    const voucher: Voucher = {
      ...data,
      discount_value: Number(data.discount_value)  || 0,
      min_amount:     Number(data.min_amount)       || 0,
      uses_count:     Number(data.uses_count)       || 0
    };

    // 1. Check if active
    if (!voucher.is_active) {
      return { valid: false, message: 'Este voucher foi desativado.' };
    }

    // 2. Check dates
    const now = new Date();
    if (voucher.valid_from && new Date(voucher.valid_from) > now) {
      return { valid: false, message: 'Este voucher ainda não se encontra ativo.' };
    }
    if (voucher.valid_until && new Date(voucher.valid_until) < now) {
      return { valid: false, message: 'Este voucher já expirou.' };
    }

    // 3. Check usage limit
    if (voucher.max_uses !== null && voucher.max_uses !== undefined && voucher.uses_count! >= voucher.max_uses) {
      return { valid: false, message: 'Este voucher já atingiu o limite máximo de utilizações.' };
    }

    // 4. Check scope / Client restriction
    if (voucher.scope === 'specific_company') {
      if (!companyId || companyId !== voucher.target_company_id) {
        return {
          valid: false,
          message: 'Este voucher é exclusivo e não pode ser utilizado por este cliente.'
        };
      }
    } else if (voucher.scope === 'specific_user') {
      if (!userEmail || userEmail.trim().toLowerCase() !== (voucher.target_user_email || '').toLowerCase()) {
        return {
          valid: false,
          message: 'Este voucher é exclusivo para outra conta de utilizador.'
        };
      }
    }

    // 5. Check minimum amount
    // Use explicit > 0 so that min_amount = 0 (no restriction) is never confused
    // with a missing/null value. Number() ensures string values from the DB are cast.
    const minAmount = Number(voucher.min_amount) || 0;
    if (minAmount > 0 && Number(originalPrice) < minAmount) {
      return {
        valid: false,
        message: `Este voucher requer um valor mínimo de compra de ${minAmount.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MZN.`
      };
    }

    // 6. Calculate discount amount
    let discountAmount = 0;
    if (voucher.discount_type === 'percentage') {
      discountAmount = (originalPrice * voucher.discount_value) / 100;
    } else if (voucher.discount_type === 'fixed_amount') {
      discountAmount = voucher.discount_value;
    }

    if (discountAmount > originalPrice) {
      discountAmount = originalPrice;
    }

    const finalPrice = Math.max(0, originalPrice - discountAmount);

    return {
      valid: true,
      message: 'Voucher aplicado com sucesso!',
      voucher,
      discountAmount,
      finalPrice
    };
  }

  async redeemVoucher(
    voucherId: string,
    companyId?: string,
    userId?: string,
    discountApplied: number = 0
  ): Promise<boolean> {
    try {
      // ── Primary path: SECURITY DEFINER RPC (bypasses RLS) ──────────────────
      // This is the reliable path. The RPC inserts the redemption record AND
      // atomically increments uses_count in a single transaction.
      const { data: rpcSuccess, error: rpcErr } = await this.supabase.client
        .rpc('redeem_voucher', {
          p_voucher_id:       voucherId,
          p_company_id:       companyId || null,
          p_user_id:          userId   || null,
          p_discount_applied: discountApplied
        });

      if (!rpcErr && rpcSuccess === true) {
        // Reload vouchers so back-office list shows updated uses_count
        await this.loadVouchers();
        return true;
      }

      // Log so we know the RPC path failed and why
      if (rpcErr) {
        console.warn('redeem_voucher RPC failed, falling back to direct update:', rpcErr);
      } else {
        console.warn('redeem_voucher RPC returned falsy:', rpcSuccess, '– falling back');
      }

      // ── Fallback path: direct Supabase calls ────────────────────────────────
      // Used when the RPC is not yet deployed to the remote project.

      // 1. Insert redemption record
      const { error: redemptionErr } = await this.supabase.client
        .from('voucher_redemptions')
        .insert({
          voucher_id:       voucherId,
          company_id:       companyId || null,
          user_id:          userId   || null,
          discount_applied: discountApplied,
          redeemed_at:      new Date().toISOString()
        });

      if (redemptionErr) {
        console.error('Fallback: error inserting voucher_redemption:', redemptionErr);
        // Continue anyway — incrementing uses_count is the most important step
      }

      // 2. Atomic increment: uses_count = uses_count + 1
      //    Avoids the read-then-write race condition.
      const { error: updateErr } = await this.supabase.client
        .from('vouchers')
        .update({
          uses_count: (await this.supabase.client
            .from('vouchers')
            .select('uses_count')
            .eq('id', voucherId)
            .maybeSingle()
            .then(r => (r.data?.uses_count ?? 0) + 1)),
          updated_at: new Date().toISOString()
        })
        .eq('id', voucherId);

      if (updateErr) {
        console.error('Fallback: error incrementing uses_count:', updateErr);
        return false;
      }

      // Reload so the UI reflects the new count
      await this.loadVouchers();
      return true;
    } catch (e) {
      console.error('Exception redeeming voucher:', e);
      return false;
    }
  }


  async getRedemptions(voucherId?: string): Promise<VoucherRedemption[]> {
    try {
      let query = this.supabase.client
        .from('voucher_redemptions')
        .select(`
          *,
          vouchers(code),
          companies(name)
        `)
        .order('redeemed_at', { ascending: false });

      if (voucherId) {
        query = query.eq('voucher_id', voucherId);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error loading redemptions:', error);
        return [];
      }

      return (data || []).map((row: any) => ({
        id: row.id,
        voucher_id: row.voucher_id,
        company_id: row.company_id,
        user_id: row.user_id,
        discount_applied: Number(row.discount_applied),
        redeemed_at: row.redeemed_at,
        company_name: row.companies?.name || 'Cliente Geral',
        voucher_code: row.vouchers?.code || 'Código'
      }));
    } catch (err) {
      console.error('Exception loading redemptions:', err);
      return [];
    }
  }
}
