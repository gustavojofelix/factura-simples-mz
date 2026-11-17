import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ispcfacilmz.app',
  appName: 'ISPC Fácil',
  webDir: 'dist/ispc-facil/browser',
  plugins: {
    SystemBars: {
      // Ícones escuros nas barras do sistema (a app tem fundo claro).
      style: 'LIGHT',
      initialViewportFitValueHint: 'contain'
    }
  }
};

export default config;
