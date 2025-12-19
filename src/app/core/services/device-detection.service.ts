import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class DeviceDetectionService {
  isMobile(): boolean {
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;

    const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    const isMobileDevice = mobileRegex.test(userAgent);

    const isSmallScreen = window.innerWidth <= 768;

    return isMobileDevice || isSmallScreen;
  }

  isAndroid(): boolean {
    const userAgent = navigator.userAgent || navigator.vendor;
    return /Android/i.test(userAgent);
  }

  getDeviceType(): 'mobile' | 'desktop' {
    return this.isMobile() ? 'mobile' : 'desktop';
  }
}
