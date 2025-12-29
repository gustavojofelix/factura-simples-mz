import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface ExtractedCompanyData {
  nuit?: string;
  tradeName?: string;
  address?: string;
  province?: string;
  district?: string;
  administrativePost?: string;
  mainActivity?: string;
}

export interface DocumentUploadResult {
  url: string;
  extractedData?: ExtractedCompanyData;
}

@Injectable({
  providedIn: 'root'
})
export class DocumentProcessingService {
  private readonly BUCKET_NAME = 'company-documents';

  constructor(private supabase: SupabaseService) {
    this.initializeBucket();
  }

  private async initializeBucket() {
    try {
      const { data: buckets } = await this.supabase.client.storage.listBuckets();
      const bucketExists = buckets?.some(b => b.name === this.BUCKET_NAME);

      if (!bucketExists) {
        await this.supabase.client.storage.createBucket(this.BUCKET_NAME, {
          public: false,
          fileSizeLimit: 10485760
        });
      }
    } catch (error) {
      console.error('Error initializing bucket:', error);
    }
  }

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
      throw new Error(`Erro ao fazer upload: ${error.message}`);
    }

    const { data: urlData } = this.supabase.client.storage
      .from(this.BUCKET_NAME)
      .getPublicUrl(fileName);

    let extractedData: ExtractedCompanyData | undefined;

    if (documentType === 'nuit' || documentType === 'activity_start') {
      extractedData = await this.extractDataFromDocument(file, documentType);
    }

    return {
      url: urlData.publicUrl,
      extractedData
    };
  }

  private async extractDataFromDocument(
    file: File,
    documentType: 'nuit' | 'activity_start'
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
}
