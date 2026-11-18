import { ComponentType } from '@angular/cdk/portal';
import { Injectable, inject } from '@angular/core';
import { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';
import { isCompactViewport } from '../utils/viewport';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const DESKTOP_WIDTHS: Record<DialogSize, string> = {
  sm: '480px',
  md: '640px',
  lg: '900px',
  xl: '1100px'
};

export interface ResponsiveDialogConfig<D> extends MatDialogConfig<D> {
  /** Largura no desktop. No telemóvel o diálogo ocupa sempre o ecrã inteiro. */
  size?: DialogSize;
}

/**
 * Abre diálogos que se adaptam ao ecrã:
 * - telemóvel: ecrã inteiro (sem cantos, sem margens), como um ecrã nativo;
 * - desktop: centrado, com a largura do `size` escolhido.
 *
 * Usar em conjunto com <app-dialog-shell> no componente do diálogo, que trata
 * do cabeçalho, do corpo com scroll e da barra de acções fixa em baixo.
 * `width`, `maxWidth` e `maxHeight` do config são ignorados (definidos aqui);
 * `height` só se aplica no desktop.
 */
@Injectable({ providedIn: 'root' })
export class ResponsiveDialogService {
  private readonly dialog = inject(MatDialog);

  open<T, D = unknown, R = any>(
    component: ComponentType<T>,
    config: ResponsiveDialogConfig<D> = {}
  ): MatDialogRef<T, R> {
    const { size = 'md', panelClass, width: _w, maxWidth: _mw, maxHeight: _mh, ...rest } = config;
    const extraClasses = Array.isArray(panelClass) ? panelClass : panelClass ? [panelClass] : [];

    if (isCompactViewport()) {
      return this.dialog.open<T, D, R>(component, {
        autoFocus: 'dialog',
        ...rest,
        width: '100vw',
        maxWidth: '100vw',
        height: '100%',
        maxHeight: '100%',
        panelClass: ['app-dialog', 'app-dialog-fullscreen', ...extraClasses]
      });
    }

    return this.dialog.open<T, D, R>(component, {
      ...rest,
      width: DESKTOP_WIDTHS[size],
      maxWidth: '95vw',
      maxHeight: '90vh',
      panelClass: ['app-dialog', ...extraClasses]
    });
  }
}
