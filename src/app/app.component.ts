import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: #07070d;
      color: #e8e8f0;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    }
  `],
})
export class AppComponent {}