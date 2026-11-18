/** Tipo de negócio escolhido no registo: decide que dados de demonstração se carregam. */
export type DemoBusinessType = 'restaurant' | 'retail' | 'services';

export const DEMO_BUSINESS_TYPES: { id: DemoBusinessType; icon: string }[] = [
  { id: 'restaurant', icon: 'fa-mug-hot' },
  { id: 'retail', icon: 'fa-basket-shopping' },
  { id: 'services', icon: 'fa-briefcase' }
];

export function asDemoBusinessType(value: unknown): DemoBusinessType {
  return value === 'restaurant' || value === 'retail' ? value : 'services';
}
