import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuditLogService } from './audit-log.service';
import { DocumentProcessingService } from './document-processing.service';
import type { Company } from './company.service';

export interface CompanyBankAccount {
  id?: string;
  company_id?: string;
  bank_name: string;
  account_holder?: string | null;
  account_number?: string | null;
  nib?: string | null;
  iban?: string | null;
  swift?: string | null;
  currency: string;
  is_default: boolean;
  show_on_invoice: boolean;
  sort_order: number;
  document_path?: string | null;
  document_file_name?: string | null;
}

/** Principais bancos a operar em Moçambique. 'Outro' permite texto livre. */
export const MOZAMBIQUE_BANKS: string[] = [
  'BCI',
  'Millennium bim',
  'Standard Bank',
  'Absa',
  'Moza Banco',
  'FNB',
  'Nedbank',
  'Access Bank (ex-Banco Único)',
  'Letshego',
  'Ecobank',
  'First Capital Bank',
  'Socremo',
  'UBA',
  'Banco Société Générale',
  'BayPort',
  'Banco Mais',
  'MyBucks',
  'Banco Nacional de Investimento (BNI)'
];

export const BANK_OTHER_OPTION = 'Outro';

/** A partir de quantas contas visíveis o rodapé da factura pode ficar apertado. */
export const MAX_RECOMMENDED_INVOICE_BANKS = 4;

/** Avisos (não bloqueantes) sobre o formato do NIB. Devolve null se estiver bem ou vazio. */
export function nibWarning(value: string | null | undefined): string | null {
  const digits = (value || '').replace(/\s/g, '');
  if (!digits) return null;
  if (!/^\d+$/.test(digits)) return 'O NIB deve conter apenas dígitos.';
  if (digits.length !== 21) return `O NIB moçambicano tem 21 dígitos (tem ${digits.length}).`;
  return null;
}

/** Avisos (não bloqueantes) sobre o formato do IBAN. Devolve null se estiver bem ou vazio. */
export function ibanWarning(value: string | null | undefined): string | null {
  const iban = (value || '').replace(/\s/g, '').toUpperCase();
  if (!iban) return null;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return 'Formato de IBAN inválido (ex.: MZ59 0001 ...).';
  if (iban.startsWith('MZ') && iban.length !== 25) return `O IBAN moçambicano tem 25 caracteres (tem ${iban.length}).`;
  if (iban.length < 15 || iban.length > 34) return 'O IBAN parece ter um comprimento inválido.';
  return null;
}

/** Avisos (não bloqueantes) sobre o formato do SWIFT/BIC. */
export function swiftWarning(value: string | null | undefined): string | null {
  const swift = (value || '').replace(/\s/g, '').toUpperCase();
  if (!swift) return null;
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift)) return 'O SWIFT/BIC tem 8 ou 11 caracteres (ex.: BCIMMZMA).';
  return null;
}

/** Contas a mostrar nos documentos: só as visíveis, a conta por omissão primeiro. */
export function invoiceBankAccounts(accounts: CompanyBankAccount[] | null | undefined): CompanyBankAccount[] {
  return (accounts || [])
    .filter(account => account.show_on_invoice)
    .slice()
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * Contas a desenhar no bloco "Coordenadas bancárias" de um documento. Usa a
 * nova tabela sempre que a leitura teve sucesso (mesmo vazia); só quando as
 * contas não estão disponíveis (null: ainda a carregar, leitura falhou ou
 * migração por aplicar) recorre às colunas antigas (obsoletas) de companies.
 */
export function documentBankAccounts(
  company: Company | null | undefined,
  accounts: CompanyBankAccount[] | null | undefined
): CompanyBankAccount[] {
  if (Array.isArray(accounts)) return invoiceBankAccounts(accounts);
  if (!company) return [];
  const legacy = [company.bank_name, company.bank_account, company.bank_iban, company.bank_swift, company.nib]
    .some(value => !!value?.trim());
  if (!legacy) return [];
  return [{
    bank_name: company.bank_name?.trim() || '',
    account_number: company.bank_account || null,
    iban: company.bank_iban || null,
    swift: company.bank_swift || null,
    nib: company.nib || null,
    currency: company.currency || 'MZN',
    is_default: true,
    show_on_invoice: true,
    sort_order: 0
  }];
}

@Injectable({
  providedIn: 'root'
})
export class CompanyBankAccountService {
  /** Contas já lidas, por empresa. */
  private cache = signal<Record<string, CompanyBankAccount[]>>({});

  /** Pedidos em curso, para não repetir a mesma leitura em paralelo. */
  private pending = new Map<string, Promise<CompanyBankAccount[] | null>>();

  constructor(
    private supabase: SupabaseService,
    private auditLogService: AuditLogService,
    private documentService: DocumentProcessingService
  ) {}

  /**
   * Contas em memória (síncrono). null enquanto a leitura não terminar ou se
   * falhar: os documentos usam então o banco antigo de companies.
   */
  accountsFor(companyId: string | null | undefined): CompanyBankAccount[] | null {
    if (!companyId) return null;
    return this.cache()[companyId] ?? null;
  }

  /**
   * Contas de uma empresa (com cache). Devolve null se a leitura falhar, para
   * distinguir "sem contas" de "não foi possível ler".
   */
  async list(companyId: string): Promise<CompanyBankAccount[] | null> {
    if (!companyId) return null;

    const cached = this.cache()[companyId];
    if (cached) return cached;

    const inFlight = this.pending.get(companyId);
    if (inFlight) return inFlight;

    const request = this.fetch(companyId);
    this.pending.set(companyId, request);

    try {
      return await request;
    } finally {
      this.pending.delete(companyId);
    }
  }

  /**
   * Leitura para edição: ao contrário de list(), lança o erro em vez de devolver
   * uma lista vazia, para que uma falha de leitura nunca leve a gravar "zero
   * contas" (o que apagaria as existentes).
   */
  async loadForEdit(companyId: string): Promise<CompanyBankAccount[]> {
    const { data, error } = await this.supabase.db
      .from('company_bank_accounts')
      .select('*')
      .eq('company_id', companyId)
      .order('is_default', { ascending: false })
      .order('sort_order', { ascending: true });
    if (error) throw error;
    const accounts = (data || []) as CompanyBankAccount[];
    this.cache.update(current => ({ ...current, [companyId]: accounts }));
    return accounts;
  }

  async reload(companyId: string): Promise<CompanyBankAccount[] | null> {
    this.cache.update(current => {
      const next = { ...current };
      delete next[companyId];
      return next;
    });
    return this.list(companyId);
  }

  private async fetch(companyId: string): Promise<CompanyBankAccount[] | null> {
    try {
      const { data, error } = await this.supabase.db
        .from('company_bank_accounts')
        .select('*')
        .eq('company_id', companyId)
        .order('is_default', { ascending: false })
        .order('sort_order', { ascending: true });

      if (error) throw error;

      const accounts = (data || []) as CompanyBankAccount[];
      this.cache.update(current => ({ ...current, [companyId]: accounts }));
      return accounts;
    } catch (error) {
      console.error('Erro ao carregar as contas bancárias:', error);
      return null;
    }
  }

  /**
   * Grava a lista completa de contas de uma empresa através da RPC
   * save_company_bank_accounts, que numa só transacção apaga as contas que
   * saíram, garante uma única conta por omissão e insere/actualiza as restantes
   * pela ordem recebida. Se algo falhar nada fica gravado. Os comprovativos que
   * deixaram de ser referenciados são removidos do armazenamento depois.
   * Lança o erro em caso de falha.
   */
  async saveForCompany(companyId: string, accounts: CompanyBankAccount[]): Promise<CompanyBankAccount[] | null> {
    const clean = accounts
      .map(account => this.normalize(account))
      .filter(account => !!account.bank_name);

    // Garante exactamente uma conta por omissão quando a lista não está vazia.
    if (clean.length > 0) {
      const defaultIndex = clean.findIndex(account => account.is_default);
      clean.forEach((account, index) => account.is_default = index === (defaultIndex >= 0 ? defaultIndex : 0));
    }

    const { data: existing, error: existingError } = await this.supabase.db
      .from('company_bank_accounts')
      .select('id, document_path')
      .eq('company_id', companyId);
    if (existingError) throw existingError;

    const keptIds = new Set(clean.map(account => account.id).filter(Boolean));
    const removedCount = (existing || []).filter((row: any) => !keptIds.has(row.id)).length;

    // Ficheiros que deixaram de ser referenciados (conta apagada ou documento substituído/removido).
    const keptPaths = new Set(clean.map(account => account.document_path).filter(Boolean) as string[]);
    const orphanPaths = (existing || [])
      .map((row: any) => row.document_path as string | null)
      .filter((path): path is string => !!path && !keptPaths.has(path));

    const payload = clean.map((account, index) => ({
      id: account.id ?? null,
      bank_name: account.bank_name,
      account_holder: account.account_holder,
      account_number: account.account_number,
      nib: account.nib,
      iban: account.iban,
      swift: account.swift,
      currency: account.currency,
      is_default: account.is_default,
      show_on_invoice: account.show_on_invoice,
      sort_order: index,
      document_path: account.document_path,
      document_file_name: account.document_file_name
    }));

    const { error } = await this.supabase.db.rpc('save_company_bank_accounts', {
      p_company_id: companyId,
      p_accounts: payload
    });
    if (error) throw error;

    // Remoção dos ficheiros só depois de os dados estarem gravados.
    for (const path of orphanPaths) {
      try {
        await this.documentService.deleteDocument(path);
      } catch (error) {
        console.warn('Não foi possível remover o comprovativo bancário do armazenamento:', error);
      }
    }

    await this.auditLogService.log(
      'Actualizou Dados Bancários',
      'settings',
      { count: clean.length, removed: removedCount },
      companyId,
      undefined,
      companyId
    );

    return this.reload(companyId);
  }

  private normalize(account: CompanyBankAccount): CompanyBankAccount {
    const text = (value: string | null | undefined) => {
      const trimmed = (value ?? '').trim();
      return trimmed ? trimmed : null;
    };
    return {
      id: account.id || undefined,
      bank_name: (account.bank_name || '').trim(),
      account_holder: text(account.account_holder),
      account_number: text(account.account_number),
      nib: text(account.nib),
      iban: text(account.iban)?.toUpperCase() ?? null,
      swift: text(account.swift)?.toUpperCase() ?? null,
      currency: account.currency || 'MZN',
      is_default: !!account.is_default,
      show_on_invoice: account.show_on_invoice !== false,
      sort_order: account.sort_order ?? 0,
      document_path: text(account.document_path),
      document_file_name: text(account.document_file_name)
    };
  }
}
