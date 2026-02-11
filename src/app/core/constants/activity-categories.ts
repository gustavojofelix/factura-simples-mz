export interface CategoryHierarchy {
  [key: string]: {
    label: string;
    subcategories?: {
      [key: string]: {
        label: string;
        subcategories?: string[];
      };
    };
  };
}

export const ACTIVITY_HIERARCHY: CategoryHierarchy = {
  'silvicola': { label: 'Silvícola' },
  'pesqueira': { label: 'Pesqueira' },
  'pecuaria': { label: 'Pecuária' },
  'agricola': { label: 'Agrícola' },
  'avicola': { label: 'Avícola' },
  'apicola': { label: 'Apícola' },
  'industrial': { label: 'Industrial' },
  'comercial': {
    label: 'Comercial',
    subcategories: {
      'comercializacao_agricola': { label: 'Comercialização agrícola' },
      'comercio_ambulante': { label: 'Comércio ambulante' },
      'comercio_geral': { label: 'Comércio geral' },
      'a_retalho_e_misto': { label: 'A retalho e misto' },
      'incluindo_em_bancas': { label: 'Incluindo em bancas' },
      'barracas': { label: 'Barracas' },
      'quiosques': { label: 'Quiosques' },
      'cantinas': { label: 'Cantinas' },
      'artesanato': { label: 'Artesanato' },
      'lojas': { label: 'Lojas' },
      'tendas': { label: 'Tendas' },
      'servicos_nao_liberais': {
        label: 'Prestação de serviços não liberais',
        subcategories: [
          'Canalização',
          'Carpintaria',
          'Pedreiro',
          'Electricista',
          'Barbearia',
          'Jardinagem',
          'Mecânica'
        ]
      },
      'servicos_liberais': {
        label: 'Prestação de serviços liberais',
        subcategories: [
          'Advogados',
          'Economistas',
          'Geólogos',
          'Engenheiros',
          'Contabilistas'
        ]
      }
    }
  }
};
