import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface ExtractedCompanyData {
  nuit?: string;
  tradeName?: string;
  address?: string;
  province?: string;
  district?: string;
  administrativePost?: string;
}

export interface DocumentUploadResult {
  url: string;
  extractedData?: ExtractedCompanyData;
}

export interface CompanyDocument {
  id: string;
  company_id: string;
  type: string;
  url: string;
  file_name: string;
  created_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class DocumentProcessingService {
  private readonly BUCKET_NAME = 'company-documents';

  constructor(private supabase: SupabaseService) {}

  async uploadDocument(
    file: File,
    companyId: string,
    documentType: 'nuit' | 'activity_start' | 'commercial_activity' | 'registration_certificate'
  ): Promise<DocumentUploadResult> {
    const fileExt = file.name.split('.').pop();
    const fileName = `${companyId}/${documentType}_${Date.now()}.${fileExt}`;

    const { data, error } = await this.supabase.client.storage
      .from(this.BUCKET_NAME)
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      if (error.message === 'Bucket not found') {
        throw new Error('O sistema de arquivos (bucket) "company-documents" não existe no Supabase. Por favor, crie-o no Dashboard.');
      }
      throw new Error(`Erro ao fazer upload: ${error.message}`);
    }

    const { data: urlData } = this.supabase.client.storage
      .from(this.BUCKET_NAME)
      .getPublicUrl(fileName);

    let extractedData: ExtractedCompanyData | undefined;

    if (documentType === 'nuit' || documentType === 'activity_start' || documentType === 'commercial_activity') {
      extractedData = await this.extractDataFromDocument(file, documentType);
    }

    return {
      url: urlData.publicUrl,
      extractedData
    };
  }

  private async extractDataFromDocument(
    file: File,
    documentType: 'nuit' | 'activity_start' | 'commercial_activity'
  ): Promise<ExtractedCompanyData> {
    try {
      const base64 = await this.fileToBase64(file);

      const response = await this.supabase.client.functions.invoke('process-document', {
        body: {
          document: base64,
          documentType,
          mimeType: file.type
        }
      });

      if (response.error) {
        console.error('Error processing document:', response.error);
        return {};
      }

      return response.data?.extractedData || {};
    } catch (error) {
      console.error('Error extracting data:', error);
      return {};
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  }

  async getCompanyDocuments(companyId: string): Promise<CompanyDocument[]> {
    const { data, error } = await this.supabase.client
      .from('company_documents')
      .select('*')
      .eq('company_id', companyId)
      .order('type', { ascending: true });

    if (error) {
      console.error('Error fetching company documents:', error);
      return [];
    }

    return data || [];
  }

  async saveDocument(companyId: string, type: string, url: string, fileName: string): Promise<CompanyDocument | null> {
    const { data, error } = await this.supabase.client
      .from('company_documents')
      .upsert({
        company_id: companyId,
        type,
        url,
        file_name: fileName,
        updated_at: new Date().toISOString()
      }, { onConflict: 'company_id, type' })
      .select()
      .single();

    if (error) {
      console.error('Error saving document info:', error);
      throw error;
    }

    return data;
  }

  async deleteCompanyDocument(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('company_documents')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting document info:', error);
      throw error;
    }
  }

  async deleteDocument(url: string): Promise<void> {
    try {
      const path = url.split('/').slice(-2).join('/');
      const { error } = await this.supabase.client.storage
        .from(this.BUCKET_NAME)
        .remove([path]);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  }

  async updateCompanyDocuments(
    companyId: string,
    documents: {
      nuit_document_url?: string;
      activity_start_document_url?: string;
      commercial_activity_document_url?: string;
      registration_certificate_url?: string;
      documents_metadata?: any;
    }
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('companies')
      .update(documents)
      .eq('id', companyId);

    if (error) {
      throw new Error(`Erro ao atualizar documentos: ${error.message}`);
    }
  }

  async getSignedUrl(urlOrPath: string): Promise<string> {
    try {
      // Se já for uma URL assinada ou segura (tokens), retornamos
      if (urlOrPath.includes('token=')) return urlOrPath;

      // Extrair o caminho relativo se for uma URL completa
      let path = urlOrPath;
      if (urlOrPath.includes(this.BUCKET_NAME)) {
        path = urlOrPath.split(`${this.BUCKET_NAME}/`)[1];
      }

      const { data, error } = await this.supabase.client.storage
        .from(this.BUCKET_NAME)
        .createSignedUrl(path, 3600); // 1 hora de validade

      if (error) throw error;
      return data.signedUrl;
    } catch (error) {
      console.error('Erro ao gerar URL assinada:', error);
      return urlOrPath; // Fallback para a URL original
    }
  }
}
