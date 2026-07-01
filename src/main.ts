import { bootstrapApplication } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

if (environment.production) {
  document.write(
    '<script async src="//pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>'
  );
  document.write(
    '<script>(adsbygoogle = window.adsbygoogle || []).push({ google_ad_client: "ca-pub-7000744132425449", enable_page_level_ads: true });</script>'
  );
}

bootstrapApplication(AppComponent, {
  providers: [provideNoopAnimations()]
}).catch(err => console.error(err));
