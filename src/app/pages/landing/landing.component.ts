import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatIconModule, MatCardModule],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.css']
})
export class LandingComponent {
  features = [
    {
      icon: 'flash_on',
      title: 'Facturação Rápida',
      description: 'Crie facturas em menos de 60 segundos com o nosso sistema de 2 cliques.'
    },
    {
      icon: 'calculate',
      title: 'Cálculo Automático de ISPC',
      description: 'Sistema calcula automaticamente o imposto ISPC baseado nas categorias moçambicanas.'
    },
    {
      icon: 'people',
      title: 'Gestão de Clientes',
      description: 'Mantenha todos os seus clientes organizados com pesquisa inteligente.'
    },
    {
      icon: 'inventory_2',
      title: 'Catálogo de Produtos',
      description: 'Adicione produtos uma vez e reutilize em todas as suas facturas.'
    },
    {
      icon: 'email',
      title: 'Envio Automático',
      description: 'Emita e envie facturas por email automaticamente.'
    },
    {
      icon: 'business',
      title: 'Múltiplas Empresas',
      description: 'Gerencie várias empresas numa única conta.'
    }
  ];

  plans = [
    {
      name: 'Essencial',
      price: '2.500',
      currency: 'MZN',
      period: 'mês',
      features: [
        'Até 100 facturas/mês',
        'Gestão de clientes ilimitada',
        'Cálculo automático de ISPC',
        'Envio de facturas por email',
        '1 empresa',
        'Suporte por email'
      ],
      highlighted: false
    },
    {
      name: 'Profissional',
      price: '5.000',
      currency: 'MZN',
      period: 'mês',
      features: [
        'Facturas ilimitadas',
        'Gestão de clientes ilimitada',
        'Cálculo automático de ISPC',
        'Envio de facturas por email',
        'Até 5 empresas',
        'Relatórios avançados',
        'Suporte prioritário'
      ],
      highlighted: true
    }
  ];
}
