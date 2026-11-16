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

export interface KnowledgeCategory {
  code: string;
  label: string;
  sort_order: number;
}

/** Ficheiro da base legal ligado a um artigo (lei, regulamento…). */
export interface KnowledgeAttachment {
  id: string;
  article_id: string;
  file_name: string;
  storage_path: string;
  public_url: string;
  mime_type: string | null;
  size_bytes: number | null;
  /** Texto que a IA lê (extraído ao carregar; editável). */
  content_text: string | null;
  use_in_ai: boolean;
  created_at: string;
}

/** Excerto de um anexo devolvido pelo painel "Testar pergunta". */
export interface KnowledgeExcerptHit {
  attachment_id: string;
  article_id: string;
  article_title: string;
  article_status: KnowledgeStatus;
  file_name: string;
  public_url: string;
  content: string;
  relevancia: number;
}

const ATTACHMENTS_BUCKET = 'ai-knowledge';

/** Categorias por omissão, usadas só se a tabela ainda não existir (migração por aplicar). */
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

  // -------------------------------------------------------------------
  // Categorias
  // -------------------------------------------------------------------

  async listCategories(): Promise<KnowledgeCategory[]> {
    const { data, error } = await this.supabase.db
      .from('ai_knowledge_categories')
      .select('code, label, sort_order')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true });
    if (error) {
      return KNOWLEDGE_CATEGORIES.map((c, i) => ({ code: c.value, label: c.label, sort_order: (i + 1) * 10 }));
    }
    return (data || []) as KnowledgeCategory[];
  }

  async saveCategory(category: KnowledgeCategory): Promise<void> {
    const { error } = await this.supabase.db
      .from('ai_knowledge_categories')
      .upsert({ ...category, updated_at: new Date().toISOString() }, { onConflict: 'code' });
    if (error) throw error;
  }

  async removeCategory(code: string): Promise<void> {
    const { error } = await this.supabase.db.from('ai_knowledge_categories').delete().eq('code', code);
    if (error) throw error;
  }

  // -------------------------------------------------------------------
  // Anexos
  // -------------------------------------------------------------------

  /** Todos os anexos (sem o texto), para contar e pesquisar na lista de artigos. */
  async listAllAttachments(): Promise<Pick<KnowledgeAttachment, 'id' | 'article_id' | 'file_name'>[]> {
    const { data, error } = await this.supabase.db
      .from('ai_knowledge_attachments')
      .select('id, article_id, file_name');
    if (error) return [];
    return data || [];
  }

  async listAttachments(articleId: string): Promise<KnowledgeAttachment[]> {
    const { data, error } = await this.supabase.db
      .from('ai_knowledge_attachments')
      .select('*')
      .eq('article_id', articleId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []) as KnowledgeAttachment[];
  }

  /** Carrega o ficheiro para o bucket público e regista o anexo com o texto extraído. */
  async uploadAttachment(articleId: string, file: File, contentText: string): Promise<KnowledgeAttachment> {
    const dot = file.name.lastIndexOf('.');
    const base = dot > 0 ? file.name.slice(0, dot) : file.name;
    const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const safe = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'documento';
    const path = `${articleId}/${Date.now()}-${safe}${ext ? '.' + ext : ''}`;

    const storage = this.supabase.client.storage.from(ATTACHMENTS_BUCKET);
    const { error: uploadError } = await storage.upload(path, file, {
      contentType: file.type || undefined,
      upsert: false
    });
    if (uploadError) throw uploadError;

    const publicUrl = storage.getPublicUrl(path).data.publicUrl;
    const { data, error } = await this.supabase.db
      .from('ai_knowledge_attachments')
      .insert({
        article_id: articleId,
        file_name: file.name,
        storage_path: path,
        public_url: publicUrl,
        mime_type: file.type || null,
        size_bytes: file.size,
        content_text: contentText.trim() || null
      })
      .select()
      .single();
    if (error) {
      await storage.remove([path]);
      throw error;
    }
    return data as KnowledgeAttachment;
  }

  async updateAttachment(id: string, updates: Partial<Pick<KnowledgeAttachment, 'content_text' | 'use_in_ai' | 'file_name'>>): Promise<void> {
    const { error } = await this.supabase.db
      .from('ai_knowledge_attachments')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async removeAttachment(attachment: KnowledgeAttachment): Promise<void> {
    const { error } = await this.supabase.db.from('ai_knowledge_attachments').delete().eq('id', attachment.id);
    if (error) throw error;
    // O registo já saiu; um ficheiro órfão no bucket não é grave.
    await this.supabase.client.storage.from(ATTACHMENTS_BUCKET).remove([attachment.storage_path]);
  }

  async testExcerpts(query: string, includeDrafts: boolean, companyId: string | null): Promise<KnowledgeExcerptHit[]> {
    const { data, error } = await this.supabase.db.rpc('ai_admin_test_knowledge_excerpts', {
      p_query: query,
      p_include_drafts: includeDrafts,
      p_company_id: companyId,
      p_limit: 3
    });
    if (error) return [];
    return (data || []) as KnowledgeExcerptHit[];
  }

  async listCompanies(): Promise<{ id: string; name: string }[]> {
    const { data, error } = await this.supabase.db
      .from('companies').select('id, name').order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  }
}
