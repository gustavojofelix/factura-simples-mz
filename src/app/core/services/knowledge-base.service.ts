import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export type KnowledgeStatus = 'publicado' | 'revisao_pendente' | 'arquivado';
export type KnowledgeGapStatus = 'aberta' | 'resolvida' | 'ignorada';

export interface KnowledgeArticle {
  id: string;
  slug: string;
  title: string;
  category: string;
  question_variants: string[];
  body: string;
  legal_reference: string | null;
  status: KnowledgeStatus;
  company_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  company?: { name: string } | null;
}

export type KnowledgeArticleInput = Pick<KnowledgeArticle,
  'slug' | 'title' | 'category' | 'question_variants' | 'body' | 'legal_reference' | 'status' | 'company_id' | 'sort_order'>;

/** Artigo devolvido pelo painel "Testar pergunta". */
export interface KnowledgeSearchHit {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: KnowledgeStatus;
  company_id: string | null;
  relevancia: number;
  tentativa: 'estrita' | 'qualquer_palavra';
}

/** Pergunta sem resposta, agrupada pela forma normalizada. */
export interface KnowledgeGap {
  query_norm: string;
  exemplo: string;
  variantes: string[];
  ocorrencias: number;
  empresas: number;
  primeira: string;
  ultima: string;
  resolved_article_id: string | null;
}

export const KNOWLEDGE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'ispc', label: 'ISPC' },
  { value: 'modelo_30', label: 'Modelo 30' },
  { value: 'prazos', label: 'Prazos' },
  { value: 'facturacao', label: 'Facturação' },
  { value: 'aplicacao', label: 'Aplicação' }
];

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  publicado: 'Publicado',
  revisao_pendente: 'Em revisão',
  arquivado: 'Arquivado'
};

/**
 * Base de conhecimento fiscal do Assistente Virtual (ai_knowledge_articles).
 * Só os artigos publicados chegam à IA; o resto do fluxo editorial vive no
 * backoffice. O acesso é garantido pelas políticas RLS de admin.
 */
@Injectable({ providedIn: 'root' })
export class KnowledgeBaseService {
  constructor(private supabase: SupabaseService) {}

  async list(): Promise<KnowledgeArticle[]> {
    const { data, error } = await this.supabase.db
      .from('ai_knowledge_articles')
      .select('id, slug, title, category, question_variants, body, legal_reference, status, company_id, sort_order, created_at, updated_at, created_by, updated_by, reviewed_by, reviewed_at, company:companies(name)')
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data || []) as unknown as KnowledgeArticle[];
  }

  async create(article: KnowledgeArticleInput): Promise<KnowledgeArticle> {
    const { data, error } = await this.supabase.db
      .from('ai_knowledge_articles').insert(article).select().single();
    if (error) throw error;
    return data as KnowledgeArticle;
  }

  async update(id: string, updates: Partial<KnowledgeArticleInput>): Promise<KnowledgeArticle> {
    const { data, error } = await this.supabase.db
      .from('ai_knowledge_articles').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data as KnowledgeArticle;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.db.from('ai_knowledge_articles').delete().eq('id', id);
    if (error) throw error;
  }

  async testSearch(query: string, includeDrafts: boolean, companyId: string | null): Promise<KnowledgeSearchHit[]> {
    const { data, error } = await this.supabase.db.rpc('ai_admin_test_knowledge_search', {
      p_query: query,
      p_include_drafts: includeDrafts,
      p_company_id: companyId,
      p_limit: 6
    });
    if (error) throw error;
    return (data || []) as KnowledgeSearchHit[];
  }

  async listGaps(status: KnowledgeGapStatus): Promise<KnowledgeGap[]> {
    const { data, error } = await this.supabase.db.rpc('ai_admin_knowledge_gaps', { p_status: status });
    if (error) throw error;
    return (data || []) as KnowledgeGap[];
  }

  async setGapStatus(queryNorm: string, status: KnowledgeGapStatus, articleId: string | null = null): Promise<number> {
    const { data, error } = await this.supabase.db.rpc('ai_admin_resolve_knowledge_gap', {
      p_query_norm: queryNorm,
      p_status: status,
      p_article_id: articleId
    });
    if (error) throw error;
    return (data as number) ?? 0;
  }

  async listCompanies(): Promise<{ id: string; name: string }[]> {
    const { data, error } = await this.supabase.db
      .from('companies').select('id, name').order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  }
}
