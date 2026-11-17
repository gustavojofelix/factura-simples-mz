import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NativeAppService } from './core/services/native-app.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>'
})
export class AppComponent {
  constructor() {
    inject(NativeAppService).init();
  }
}
